import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createGame, createMeta, updateMeta, validateSave } from '../src/engine.js';
import { legalActions, applyAction } from '../src/agent.js';

const copy = value => JSON.parse(JSON.stringify(value));
const ACTION_LIMIT = 100_000;
const onlyAction = action => Object.fromEntries(Object.entries(action)
  .filter(([key]) => ['type','gap','slot','targetId','id','argument','index','replaceSlot'].includes(key)));

function optionsFor(options) {
  const seed = options.seed ?? 42;
  const turns = options.turns ?? 500;
  const policy = options.policy ?? 'greedy';
  const maxActions = options.maxActions ?? Math.min(ACTION_LIMIT, turns * 12 + 100);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be an integer from 0 to 4294967295');
  if (!Number.isSafeInteger(turns) || turns < 1 || turns > ACTION_LIMIT) throw new Error(`turns must be from 1 to ${ACTION_LIMIT}`);
  if (!Number.isSafeInteger(maxActions) || maxActions < 1 || maxActions > ACTION_LIMIT) throw new Error(`max-actions must be from 1 to ${ACTION_LIMIT}`);
  if (!['greedy','random'].includes(policy)) throw new Error('policy must be greedy or random');
  return {seed,turns,policy,maxActions};
}

function compare(a,b) {
  return Number(a.outcome.over)-Number(b.outcome.over)
    || a.outcome.occupancy-b.outcome.occupancy
    || b.outcome.pairs-a.outcome.pairs
    || b.outcome.essence-a.outcome.essence
    || b.outcome.score-a.outcome.score;
}
function bestPlacement(actions) { return actions.filter(a => a.type === 'place').sort(compare)[0]; }

function greedy(state, actions, consecutiveTools) {
  if (state.pendingReward) {
    return actions.find(a => a.type === 'reward' && a.index >= 0 && state.pendingReward.options[a.index].type === 'relic')
      ?? actions.find(a => a.type === 'reward' && a.index >= 0)
      ?? actions[0];
  }
  const direct = bestPlacement(actions);
  // Extraction is a necessary input action. Compare the resulting placements so the
  // policy can reposition rather than always picking the first ingredient.
  const forced = !direct;
  if (forced || ((direct.outcome.over || state.ring.length >= state.capacity - 3) && consecutiveTools < 3)) {
    let selected = null;
    let selectedPlacement = null;
    const tools = actions.filter(a => a.type !== 'place' && a.type !== 'reward').slice(0,64);
    for (const action of tools) {
      const next = applyAction(state,action);
      const placement = bestPlacement(legalActions(next));
      if (!placement) continue;
      if ((!direct || compare(placement,direct)<0) && (!selectedPlacement || compare(placement,selectedPlacement)<0)) {
        selected = action;
        selectedPlacement = placement;
      }
    }
    if (selected) return selected;
  }
  return direct ?? actions[0];
}

export function runPlaytest(rawOptions = {}) {
  const options = optionsFor(rawOptions);
  let state = createGame(options.seed);
  const initialState = copy(state);
  let meta = createMeta();
  let policyRng = (options.seed ^ 0xa5a5a5a5) >>> 0 || 1;
  let consecutiveTools = 0;
  const trace = [];
  let reason = 'action-limit';
  while (trace.length < options.maxActions) {
    if (state.over) { reason='overflow'; break; }
    if (state.turns >= options.turns) { reason='turn-limit'; break; }
    const actions = legalActions(state);
    if (!actions.length) { reason='no-legal-actions'; break; }
    let chosen;
    if (options.policy === 'random') {
      policyRng ^= policyRng << 13; policyRng ^= policyRng >>> 17; policyRng ^= policyRng << 5;
      policyRng >>>= 0;
      // Even a random policy must progress if optional tools keep being offered.
      const placements = actions.filter(a => a.type === 'place');
      const pool = consecutiveTools >= 6 && placements.length ? placements : actions;
      chosen = pool[Math.floor(policyRng / 4294967296 * pool.length)];
    } else chosen = greedy(state,actions,consecutiveTools);
    const action = onlyAction(chosen);
    const next = applyAction(state,action);
    if (isDeepStrictEqual(next,state)) throw new Error(`legalActions returned a no-op: ${JSON.stringify(action)}`);
    if (!validateSave(next)) throw new Error(`Invalid engine state after action ${trace.length+1}`);
    trace.push({step:trace.length+1,turn:next.turns,action,outcome:copy(chosen.outcome)});
    consecutiveTools = next.turns > state.turns || action.type === 'reward' ? 0 : consecutiveTools+1;
    state = next;
    meta = updateMeta(meta,state);
  }
  if (state.over) reason='overflow';
  else if (state.turns >= options.turns) reason='turn-limit';
  return {
    version:1, options, initialState, trace,
    summary:{reason,policy:options.policy,seed:options.seed,actions:trace.length,turns:state.turns,
      score:state.score,highest:state.highest,occupancy:state.ring.length,capacity:state.capacity,
      over:state.over,pairs:state.stats.pairs,rewards:state.rewardCount,relics:[...state.relics]},
    finalState:state,meta,
  };
}

export function replayReport(report) {
  if (!report || report.version !== 1 || !validateSave(report.initialState)
    || !Array.isArray(report.trace) || report.trace.length > ACTION_LIMIT) throw new Error('Invalid replay report');
  let state = copy(report.initialState);
  let meta = createMeta();
  for (let i=0;i<report.trace.length;i++) {
    const entry = report.trace[i];
    const next = applyAction(state,entry.action);
    if (isDeepStrictEqual(next,state) || !validateSave(next)) throw new Error(`Replay action ${i+1} is invalid or has no effect`);
    if (entry.turn !== next.turns) throw new Error(`Replay turn mismatch at action ${i+1}`);
    state = next;
    meta = updateMeta(meta,state);
  }
  if (!isDeepStrictEqual(state,report.finalState)) throw new Error('Replay final state differs from recording');
  if (!isDeepStrictEqual(meta,report.meta)) throw new Error('Replay meta differs from recording');
  return {verified:true,actions:report.trace.length,turns:state.turns,finalState:state,meta};
}

async function main(args) {
  const opts = {};
  let output;
  let replay;
  for (let i=0;i<args.length;i++) {
    const flag = args[i];
    if (flag === '--help') {
      process.stdout.write('Usage: node scripts/playtest.mjs [--seed 42] [--turns 500] [--policy greedy|random] [--max-actions 1000] [--out report.json]\n       node scripts/playtest.mjs --replay report.json\nWithout --out, prints the complete JSON report and writes no files.\n');
      return;
    }
    if (!['--seed','--turns','--policy','--max-actions','--out','--replay'].includes(flag) || args[i+1] === undefined) throw new Error(`Unknown or incomplete argument: ${flag}`);
    const value = args[++i];
    if (flag === '--out') output=value;
    else if (flag === '--replay') replay=value;
    else if (flag === '--policy') opts.policy=value;
    else opts[flag === '--max-actions' ? 'maxActions' : flag.slice(2)] = Number(value);
  }
  if (replay) {
    if (output || Object.keys(opts).length) throw new Error('--replay must be used alone');
    const result = replayReport(JSON.parse(await readFile(resolve(replay),'utf8')));
    process.stdout.write(JSON.stringify({verified:result.verified,actions:result.actions,turns:result.turns})+'\n');
    return;
  }
  const report = runPlaytest(opts);
  if (output) {
    const file = resolve(output);
    await mkdir(dirname(file),{recursive:true});
    await writeFile(file,JSON.stringify(report,null,2)+'\n');
    process.stdout.write(JSON.stringify({...report.summary,report:file})+'\n');
  } else process.stdout.write(JSON.stringify(report,null,2)+'\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Playtest failed: ${error.message}\n`);
    process.exitCode=1;
  });
}
