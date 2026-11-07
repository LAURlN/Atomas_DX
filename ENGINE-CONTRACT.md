# Engine/UI implementation contract

Buildless ES modules; Node >=22 for tests. All state updates are immutable and JSON serializable.

Exports in `src/engine.js`:
- `RELICS`: array `{id,name,icon,description,active?:boolean}`.
- `CONSUMABLES`: array `{id,name,icon,description,target?:boolean}`.
- `ingredient(rank)`: `{name,symbol,color}` for any positive rank.
- `createGame(seed?, starter?)`: initial state.
- `previewPlacement(state, gapIndex)`: same result as `place(state,gapIndex)`, without mutation.
- `place(state,gapIndex)`: next state, gap 0..ring.length-1 inserts BEFORE ring[index]; empty ring gap 0.
- `useConsumable(state, slotIndex, targetId?)`: next state; targetId ingredient ID when needed. Invalid action returns unchanged state.
- `useRelic(state, relicId, argument?)`: next state. lens argument +1/-1; tongs target ID; twinned no argument; echo boolean or no argument.
- `chooseReward(state, optionIndex, replaceSlot?)`: next state; -1 declines. Full inventory needs replacement index to take a consumable.
- `createMeta()`, `updateMeta(meta,state)`: track unlocks/stats, pure. `createGame(seed,starter)` accepts `standard` or unlocked `mirror`.
- `validateSave(value)`: boolean structural validation for loading state.

State fields:
`{version:1, seed:number, rng:number, nextId:number, ring:Piece[], incoming:Piece, queue:Piece[3], capacity:18, turns:0, score:0, essence:0, rewardThreshold:6, rewardCount:0, highest:1, relics:string[], relicState:{[id]:object}, inventory:(string|null)[3], pendingReward:null|{options:{type:'relic'|'consumable',id:string}[]}, over:false, last:{pairs:0,chains:0,essence:0,message:string,removedIds:[]}, ...internalFields}`.

Piece `{id:string, kind:'ingredient'|'catalyst'|'extract', rank?:number}`. Ingredients display rank. Extract incoming is a tool: UI must select ingredient and call `useRelic(state,'extract',targetId)` to pick it up, placing the extracted ingredient next; UI can convert extracted ingredient to catalyst via `useRelic(state,'transmute')` when engine permits, `state.extracted` flag. No randomness from preview.

Actions disallowed while pendingReward or over, except chooseReward while pending. Relic active status is in relicState: `.charges` for lens/tongs/twinned, `.memory` for echo, `.used` phoenix. Use IDs `lens`, `twinned`, `bell`, `halo`, `tongs`, `echo`, `blood`, `phoenix`; consumables `solvent`, `twin`, `catalyst`.

UI persists state after every confirmed action and meta separately; target selection cancellation costs nothing. Rendering may add local UI state for gap selection/targeting; no direct mutation of engine state.

Other ownership: engine agent owns src/engine.js, may add src/catalog.js. UI owns index.html, src/app.js, src/styles.css, assets. Test agent owns tests/*.test.js. Root owns package.json, tooling, deployment, README, docs.
