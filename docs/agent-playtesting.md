# Agent playtesting

There are three supported routes: a headless CLI, an isolated browser API, and accessible UI controls. All use the actual game engine and normal rules. No image recognition or manual save editing is required.

## Fastest: headless seeded runs

```sh
npm run playtest -- --seed 42 --turns 500 --policy greedy --out test-results/run-42.json
npm run playtest -- --seed 42 --turns 500 --policy random
npm run playtest -- --replay test-results/run-42.json
```

The report includes the seed, policy, summary, action trace and final state. A turn limit bounds the test; it is not a game loss condition. Policy randomness is seeded too. Replays check the recorded result instead of silently accepting a different outcome. These baseline policies are diagnostic agents, not claims of optimal play.

## Browser agent mode

Open the game at `?agent=1&seed=42`, for example:

`https://laurln.github.io/Atomas_DX/?agent=1&seed=42`

This skips onboarding and uses separate playtest save/archive keys. Normal player progress is untouched. Reload resumes the isolated run; `reset` explicitly starts again. Use browser JavaScript evaluation to call:

```js
window.athanor.snapshot() // {version, phase, state, meta, actions}
window.athanor.actions()  // every currently valid action, with label and outcome
window.athanor.preview({type:'place', gap:2}) // {accepted, state}; no mutation
window.athanor.act({type:'place', gap:2})     // {accepted, ...snapshot}
await window.athanor.whenIdle()             // await presentation before next browser action
window.athanor.reset({seed:42})
```

`phase` is `place`, `extract`, `reward`, `over` or `animating`; `busy` reports presentation in progress. During motion, `actions()` returns no actions and `act` returns `accepted:false, reason:'busy'`. Await `whenIdle()` before the next action. Reduced-motion mode settles immediately; the headless CLI has no animation wait. State is JSON-serializable and contains the vessel in clockwise order, incoming piece, three-piece forecast, occupancy limit, relics/charges, inventory, progress, last reaction and pending rewards. Returned objects are copies, so modifying a snapshot cannot change the live game.

Actions returned by `actions()` can be passed unchanged to `preview` and `act`. They use these fields:

```js
{type:'place', gap:2}                       // insert BEFORE ring[2]
{type:'consumable', slot:0, targetId:'p3'}   // target omitted for Ampoule
{type:'relic', id:'lens', argument:1}
{type:'relic', id:'extract', argument:'p3'}
{type:'relic', id:'transmute'}
{type:'reward', index:0, replaceSlot:1}     // replacement needed only if full
{type:'reward', index:-1}                   // decline
```

Indices are zero-based. Empty vessel insertion uses gap 0. A fatal placement is a valid deliberate action and has `outcome.over === true`; exclude it when searching safe moves. Invalid actions return `accepted:false` without changing the game. Reward phases expose only reward decisions; death exposes no gameplay actions.

Each action's `outcome` reports the complete resulting `occupancy`, `over`, `pairs`, `essence` and `score`. Essence and score are resulting totals, not deltas; compare them with the current snapshot. `preview` returns the full next state, including generated rewards and queue effects.

For a targeted regression fixture, `window.athanor.loadRun(validRunState)` validates and clones a serialized engine state into this isolated session. It rejects invalid saves. This API is available only with `agent=1`; it is not a normal-game menu or a way to change another device's progress.

A minimal browser agent loop:

```js
const before = window.athanor.snapshot();
const placements = before.actions.filter(a => a.type === 'place' && !a.outcome.over);
placements.sort((a,b) => a.outcome.occupancy-b.outcome.occupancy || b.outcome.pairs-a.outcome.pairs);
if (placements.length) {
  window.athanor.act(placements[0]);
  await window.athanor.whenIdle();
}
// For extract/reward phases choose an appropriate action from snapshot.actions.
```

Use an action budget when looping: tools can be valid without advancing the placement counter. Engine state commits immediately, then browser presentation settles through `whenIdle()`; the game has no real-time progression timer.

## UI-only browser agents

Controls have semantic buttons and stable `data-action` attributes:

- `[data-action="gap"][data-index="2"]`: place immediately in a gap; no confirmation.
- Empty space within the vessel's ring annulus also places in the nearest gap.
- `[data-action="consumable"][data-index="0"]:visible`: select a preparation. Mobile/desktop render separate racks, so choose the visible one.
- `[data-action="target"][data-id="p3"]`, then `[data-action="confirm-target"]`: select and confirm an ingredient.
- `[data-action="cancel-target"]`: cancel targeting without spending.
- `[data-action="reward"][data-index="0"]`: choose a reward.
- `[data-action="replace"][data-index="1"]`: choose the inventory slot to replace.
- `[data-action="decline"]`: decline the current draft.

Arrow keys cycle gaps and Enter commits the selected gap. Modal dialogs expose accessible names. Re-observe after each committed action because the DOM is rerendered. Wait for `#app[data-resolving]` to disappear, or use `whenIdle()`, before another browser action.

## Reproduce a bug

Record the game revision, seed, initial unlocks/starter, action trace, expected and actual state, and whether it happens in the engine, browser API or UI. Include a screenshot for a layout/input bug. Keep traces in `test-results/` (ignored by Git). Save reload and normal/playtest storage isolation are important checks.

Run `npm test`, then `npm run build`. With `npm start` running, run `npm run test:browser`; set `BASE_URL` to the deployed URL to exercise the live assets. Playwright uses installed Edge on Windows; elsewhere install its Chromium browser first.
