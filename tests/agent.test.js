import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, place, previewPlacement, validateSave } from '../src/engine.js';
import { legalActions, applyAction } from '../src/agent.js';
import { runPlaytest, replayReport } from '../scripts/playtest.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const script = fileURLToPath(new URL('../scripts/playtest.mjs',import.meta.url));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('legal actions are unique, JSON-serializable, effectful, and accurately previewed without mutation', () => {
  const state = freeze(createGame(42));
  const before = JSON.stringify(state);
  const actions = legalActions(state);
  assert.ok(actions.length > 0);
  const keys = actions.map(({label,outcome,...action}) => JSON.stringify(action));
  assert.equal(new Set(keys).size,actions.length);
  for (const action of actions) {
    assert.equal(typeof action.label,'string');
    const next = applyAction(state,JSON.parse(JSON.stringify(action)));
    assert.notDeepEqual(next,state);
    assert.equal(validateSave(next),true);
    assert.deepEqual(action.outcome,{
      over:next.over,occupancy:next.ring.length,pairs:next.last.pairs,
      essence:next.essence,score:next.score,
    });
    if (action.type === 'place') assert.deepEqual(next,previewPlacement(state,action.gap));
  }
  assert.equal(JSON.stringify(state),before);
  assert.deepEqual(legalActions(state),actions);
});

test('invalid action schemas and illegal targets return the original state', () => {
  const state = createGame(4);
  for (const action of [null, [], {}, {type:'unknown'}, {type:'place',gap:-1},
    {type:'place',gap:999}, {type:'place',gap:'1'}, {type:'consumable',slot:0,targetId:'missing'},
    {type:'consumable',slot:0,targetId:3}, {type:'consumable',slot:8},
    {type:'relic',id:'lens',argument:2},{type:'relic',id:'extract',argument:{}},
    {type:'relic',id:'twinned',argument:1},{type:'relic',id:'echo',argument:'yes'},
    {type:'reward',index:0}]) assert.equal(applyAction(state,action),state);
});

test('pending full-inventory rewards expose every replacement and decline while gating other actions', () => {
  const state = {...createGame(2), inventory:['solvent','twin','solvent'],
    pendingReward:{options:[{type:'consumable',id:'catalyst'},{type:'relic',id:'lens'}]}};
  const actions = legalActions(state);
  assert.ok(actions.every(a => a.type === 'reward'));
  const replacements = actions.filter(a => a.index === 0);
  assert.deepEqual(replacements.map(a=>a.replaceSlot),[0,1,2]);
  assert.ok(actions.some(a=>a.index===-1));
  assert.ok(actions.some(a=>a.index===1));
  assert.equal(actions.length,5);
  for (const action of replacements) {
    const next = applyAction(state,action);
    assert.equal(next.inventory[action.replaceSlot],'catalyst');
    assert.equal(next.pendingReward,null);
  }
  assert.equal(applyAction(state,{type:'place',gap:0}),state);
});

test('extraction and transmutation are discoverable through the same agent action interface', () => {
  const state = createGame(8);
  state.incoming = {id:state.incoming.id,kind:'extract'};
  const actions = legalActions(state);
  assert.equal(actions.some(a=>a.type==='place'),false);
  const extraction = actions.find(a=>a.type==='relic' && a.id==='extract');
  assert.ok(extraction);
  const next = applyAction(state,extraction);
  assert.equal(next.extracted,true);
  assert.equal(next.turns,0);
  assert.ok(legalActions(next).some(a=>a.type==='place'));
  const transmutation = legalActions(next).find(a=>a.type==='relic' && a.id==='transmute');
  assert.ok(transmutation);
  assert.equal(applyAction(next,transmutation).incoming.kind,'catalyst');
});

test('fatal placements remain available with an explicit overflow outcome; dead games have no actions', () => {
  const state = createGame(11);
  state.ring = Array.from({length:18},(_,i)=>({id:`p${i+1}`,kind:'ingredient',rank:i+1}));
  state.incoming = {id:'p19',kind:'ingredient',rank:22};
  state.queue = [20,21,22].map(id=>({id:`p${id}`,kind:'catalyst'}));
  state.nextId = 23;
  const fatal = legalActions(state).find(a=>a.type==='place');
  assert.equal(fatal.outcome.over,true);
  assert.equal(fatal.outcome.occupancy,19);
  const next = applyAction(state,fatal);
  assert.deepEqual(legalActions(next),[]);
});

test('greedy and random simulations are deterministic, bounded, valid and exactly replayable', () => {
  for (const policy of ['greedy','random']) {
    const options = {seed:42,turns:80,policy};
    const report = runPlaytest(options);
    assert.deepEqual(runPlaytest(options),report);
    assert.ok(report.trace.length > 0);
    assert.ok(report.trace.length <= report.options.maxActions);
    assert.ok(report.finalState.turns <= options.turns);
    assert.equal(validateSave(report.finalState),true);
    const replay = replayReport(copy(report));
    assert.equal(replay.verified,true);
    assert.deepEqual(replay.finalState,report.finalState);
    let state = report.initialState;
    for (const entry of report.trace) state = applyAction(state,entry.action);
    assert.deepEqual(state,report.finalState);
  }
});

test('action caps bound tool loops and invalid simulation options fail explicitly', () => {
  const report = runPlaytest({seed:9,turns:500,maxActions:1});
  assert.equal(report.trace.length,1);
  assert.equal(report.summary.reason,'action-limit');
  for (const options of [{turns:0},{turns:Infinity},{seed:-1},{seed:'42'},
    {policy:'magical'},{maxActions:0},{maxActions:100001}]) assert.throws(()=>runPlaytest(options));
});

test('tampered replays fail instead of silently claiming reproducibility', () => {
  const report = runPlaytest({seed:12,turns:20});
  const wrongState = copy(report);
  wrongState.finalState.score++;
  assert.throws(()=>replayReport(wrongState),/final state differs/);
  const wrongAction = copy(report);
  wrongAction.trace[0].action={type:'place',gap:-1};
  assert.throws(()=>replayReport(wrongAction),/invalid or has no effect/);
  const wrongTurn = copy(report);
  wrongTurn.trace[0].turn++;
  assert.throws(()=>replayReport(wrongTurn),/turn mismatch/);
});

test('CLI prints JSON without default files and supports explicit report output plus replay', async () => {
  const directory = await mkdtemp(join(tmpdir(),'athanor-agent-'));
  try {
    const invoke = args => spawnSync(process.execPath,[script,...args],{cwd:directory,encoding:'utf8',timeout:30000,maxBuffer:5*1024*1024});
    const printed = invoke(['--seed','42','--turns','12','--policy','random']);
    assert.equal(printed.status,0,printed.stderr);
    const report = JSON.parse(printed.stdout);
    assert.equal(report.options.seed,42);
    assert.equal(report.options.policy,'random');
    assert.deepEqual(await readdir(directory),[]);
    const output = join(directory,'nested','run.json');
    const saved = invoke(['--seed','42','--turns','12','--out',output]);
    assert.equal(saved.status,0,saved.stderr);
    assert.equal(JSON.parse(saved.stdout).report,output);
    const recorded = JSON.parse(await readFile(output,'utf8'));
    assert.equal(recorded.version,1);
    const replayed = invoke(['--replay',output]);
    assert.equal(replayed.status,0,replayed.stderr);
    assert.equal(JSON.parse(replayed.stdout).verified,true);
    const bad = invoke(['--turns','0']);
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/turns must be/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
