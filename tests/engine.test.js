import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELICS, CONSUMABLES, ingredient, createGame, previewPlacement, place,
  useConsumable, useRelic, chooseReward, createMeta, updateMeta, validateSave,
} from '../src/engine.js';

const clone = value => JSON.parse(JSON.stringify(value));
test('reaction events preserve actual pair order and intermediate ranks for animation', () => {
  const before = createGame(42);
  const after = place(before, 2);
  assert.deepEqual(after.last.events, [
    { centerId: before.incoming.id, leftId: before.ring[1].id, rightId: before.ring[2].id, rank: 2 },
    { centerId: before.incoming.id, leftId: before.ring[0].id, rightId: before.ring[3].id, rank: 4 },
  ]);
  assert.deepEqual(previewPlacement(before, 2).last.events, after.last.events);
  assert.deepEqual(before.last.events, []);
});
const atom = (rank, id) => ({ id: String(id), kind: 'ingredient', rank });
const catalyst = id => ({ id: String(id), kind: 'catalyst' });
function fixture(ranks = [], incoming = catalyst('incoming')) {
  return {
    ...createGame(12345),
    ring: ranks.map((rank, i) => rank === '+' ? catalyst(`r${i}`) : atom(rank, `r${i}`)),
    incoming, nextId: 1000, essence: 0, rewardThreshold: 9999,
    pendingReward: null, relics: [], relicState: {}, inventory: [null, null, null],
    over: false,
  };
}
function grant(state, id) {
  return chooseReward({ ...state, pendingReward: { options: [{ type: 'relic', id }] } }, 0);
}
function ranks(state) { return state.ring.map(p => p.kind === 'ingredient' ? p.rank : '+'); }
function assertInvariant(state) {
  assert.equal(validateSave(state), true);
  assert.equal(state.queue.length, 3);
  assert.equal(state.inventory.length, 3);
  assert.ok(Number.isInteger(state.rng));
  assert.ok(state.essence >= 0);
  assert.equal(new Set([...state.ring, state.incoming, ...state.queue].map(p => p.id)).size,
    state.ring.length + 4, 'all physical draw/ring identities must be unique');
  for (const piece of [...state.ring, state.incoming, ...state.queue]) {
    if (piece.kind === 'ingredient') assert.ok(Number.isInteger(piece.rank) && piece.rank > 0);
  }
  if (!state.over) assert.ok(state.ring.length <= state.capacity);
}

test('catalog and ingredient metadata cover the public contract', () => {
  assert.deepEqual(RELICS.map(r => r.id).sort(), ['lens','twinned','bell','halo','tongs','echo','blood','phoenix'].sort());
  assert.deepEqual(CONSUMABLES.map(c => c.id).sort(), ['solvent','twin','catalyst'].sort());
  for (const rank of [1, 8, 50, 200]) {
    const data = ingredient(rank);
    for (const field of ['name','symbol','color']) assert.equal(typeof data[field], 'string');
  }
});

test('a matching pair produces rank +1; mismatched neighbors keep the catalyst dormant', () => {
  const merged = place(fixture([2, 2]), 1);
  assert.deepEqual(ranks(merged), [3]);
  assert.equal(merged.last.pairs, 1);
  assert.equal(merged.last.essence, 1);
  const dormant = place(fixture([2, 3]), 1);
  assert.deepEqual(ranks(dormant), [2, '+', 3]);
  assert.equal(dormant.last.pairs, 0);
});

test('chain arithmetic handles outer ranks above, below and equal to the product', () => {
  for (const [ring, expected] of [
    [[9, 2, 2, 9], 11],
    [[1, 5, 5, 1], 7],
    [[3, 2, 2, 3], 5],
    [[7, 2, 1, 1, 2, 7], 9],
  ]) {
    const next = place(fixture(ring), ring.length / 2);
    assert.deepEqual(ranks(next), [expected], String(ring));
    assert.equal(next.last.pairs, ring.length / 2);
  }
});

test('a chain consumes circular wraparound pairs exactly once', () => {
  const state = fixture([1, 4, 4, 1]);
  const next = place(state, 0);
  assert.deepEqual(ranks(next), [6]);
  assert.equal(next.last.pairs, 2);
  assert.equal(next.last.removedIds.length, new Set(next.last.removedIds).size);
  const single = place(fixture([2]), 0);
  assert.equal(single.last.pairs, 0, 'one physical atom cannot be both matching neighbors');
  assert.equal(single.ring.length, 2);
});

test('ordinary insertion can activate a previously dormant catalyst', () => {
  const next = place(fixture([2, '+', 3], atom(2, 'incoming')), 2);
  assert.deepEqual(ranks(next).sort((a,b) => a-b), [3,3]);
  assert.equal(next.last.pairs, 1);
});

test('overflow is evaluated only after the complete reaction settles', () => {
  const cleared = place({ ...fixture([2, 2]), capacity: 2 }, 1);
  assert.equal(cleared.over, false);
  assert.equal(cleared.ring.length, 1);
  const exact = place({ ...fixture([1], atom(2, 'incoming')), capacity: 2 }, 0);
  assert.equal(exact.over, false);
  const dead = place({ ...fixture([1,2], atom(3, 'incoming')), capacity: 2 }, 0);
  assert.equal(dead.over, true);
  assert.equal(dead.ring.length, 3);
});

test('preview predicts the complete committed state without mutation or RNG consumption', () => {
  let state = grant(fixture([9,2,2,9]), 'bell');
  state = grant(state, 'lens');
  const original = clone(state);
  const preview = previewPlacement(state, 2);
  assert.deepEqual(state, original);
  assert.deepEqual(previewPlacement(state, 2), preview);
  assert.deepEqual(place(state, 2), preview);
  assert.equal(state.rng, original.rng);
  assert.deepEqual(state.relicState, original.relicState);
});

test('identical seeds and save/resume preserve all future actions', () => {
  let a = createGame(8080);
  let b = clone(a);
  assert.deepEqual(a, createGame(8080));
  for (let turn = 0; turn < 16 && !a.over; turn++) {
    if (a.pendingReward) {
      a = chooseReward(a, -1); b = chooseReward(b, -1);
    } else if (a.incoming.kind === 'extract') {
      const target = a.ring.find(p => p.kind === 'ingredient');
      a = useRelic(a, 'extract', target?.id); b = useRelic(b, 'extract', target?.id);
    } else {
      a = place(a, turn % Math.max(1, a.ring.length));
      b = place(clone(b), turn % Math.max(1, b.ring.length));
    }
    assert.deepEqual(b, a);
    assert.equal(validateSave(a), true);
  }
});

test('invalid consumable targets cost nothing; valid solvent removes without Essence', () => {
  const state = { ...fixture([2,'+',3], atom(1,'incoming')), inventory: ['solvent','twin','catalyst'] };
  const before = clone(state);
  assert.deepEqual(useConsumable(state, 0, 'absent'), before);
  assert.deepEqual(useConsumable(state, 0, 'r1'), before);
  assert.deepEqual(useConsumable(state, 1, 'absent'), before);
  assert.deepEqual(state, before);
  const next = useConsumable(state, 0, 'r0');
  assert.equal(next.ring.some(p => p.id === 'r0'), false);
  assert.equal(next.inventory[0], null);
  assert.equal(next.essence, state.essence);
  assert.equal(next.turns, state.turns);
});

test('catalyst ampoule only converts ordinary incoming and spends one slot', () => {
  const state = { ...fixture([2,2], atom(4,'incoming')), inventory: ['catalyst',null,null] };
  const next = useConsumable(state, 0);
  assert.equal(next.incoming.kind, 'catalyst');
  assert.equal(next.inventory[0], null);
  assert.equal(next.turns, state.turns);
  const invalid = { ...state, incoming: catalyst('incoming') };
  assert.deepEqual(useConsumable(invalid, 0), invalid);
});

test('Twin Draught binds to an eligible draw without replacing operators or adding actions', () => {
  const state = {...fixture([5,2]), inventory:['twin',null,null],
    queue:[catalyst('q0'),atom(2,'q1'),{id:'q2',kind:'extract'}]};
  const next = useConsumable(state,0,'r0');
  assert.equal(next.ring.find(p => p.id === 'r0').rank,5);
  assert.deepEqual(next.incoming,state.incoming);
  assert.deepEqual(next.queue[0],state.queue[0]);
  assert.deepEqual(next.queue[2],state.queue[2]);
  assert.equal(next.queue[1].id,'q1');
  assert.equal(next.queue[1].rank,5);
  assert.equal(next.inventory[0],null);
  assert.equal(next.turns,state.turns);
  assert.equal(next.essence,state.essence);
  assert.equal(next.rng,state.rng);
});

test('Twinned and Bell bind conflicting future effects to distinct draw identities', () => {
  let state = fixture([1,'+',2,3,3,2],atom(1,'incoming'));
  state.queue = [atom(4,'q0'),atom(5,'q1'),atom(6,'q2')];
  state = grant(grant(state,'twinned'),'bell');
  const recorded = useRelic(state,'twinned');
  assert.equal(recorded.queue[0].rank,1);
  assert.equal(recorded.queue[1].rank,1);
  assert.deepEqual(recorded.queue.map(p => p.id),['q0','q1','q2']);
  assert.deepEqual(useRelic(recorded,'twinned'),recorded,'overlapping recordings are disallowed');
  const preview = previewPlacement(recorded,2);
  const next = place(recorded,2);
  assert.deepEqual(next,preview);
  assert.equal(next.last.pairs,3);
  assert.equal(next.incoming.id,'q0');
  assert.equal(next.incoming.rank,1);
  assert.equal(next.queue[0].id,'q1');
  assert.equal(next.queue[0].rank,1);
  assert.equal(next.queue[1].id,'q2');
  assert.equal(next.queue[1].kind,'catalyst');
  assert.equal(next.relicState.bell.progress,0);
  assert.equal(next.turns,state.turns+1,'relic catalysts replace a draw rather than granting a free action');
  assert.equal(next.relicState.twinned.charges,0);
});

test('Tongs preserves the displaced forecast and Echo copies only explicit extractions', () => {
  let state = grant(grant(fixture([5,2],atom(7,'incoming')),'tongs'),'echo');
  const oldDraws = [state.incoming,...state.queue];
  const next = useRelic(state,'tongs','r0');
  assert.equal(next.incoming.id,'r0');
  assert.equal(next.incoming.rank,5);
  assert.equal(next.relicState.echo.memory,5);
  assert.equal(next.relicState.tongs.charges,0);
  assert.deepEqual([...next.queue,...next.deferred],oldDraws);
  assert.equal(next.turns,state.turns);
  assert.equal(next.essence,state.essence);
  const echoed = useRelic(next,'echo');
  assert.equal(echoed.relicState.echo.memory,null);
  assert.equal(echoed.queue[0].id,'incoming');
  assert.equal(echoed.queue[0].rank,5);
  assert.equal(echoed.turns,state.turns);
  const dissolved = useConsumable({...state,inventory:['solvent',null,null]},0,'r0');
  assert.equal(dissolved.relicState.echo.memory,null,'destruction is not an explicit extraction');
});

test('pending reward gates placements, tools and consumables until selection or decline', () => {
  const state = { ...fixture([2,2]), inventory: ['solvent',null,null],
    pendingReward: { options: [{ type:'consumable', id:'catalyst' }] } };
  assert.deepEqual(place(state, 1), state);
  assert.deepEqual(useConsumable(state, 0, 'r0'), state);
  assert.deepEqual(useRelic(state, 'lens', 1), state);
  const declined = chooseReward(state, -1);
  assert.equal(declined.pendingReward, null);
  assert.deepEqual(declined.ring, state.ring);
  assert.deepEqual(declined.inventory, state.inventory);
});

test('full inventory requires an explicit replacement or permits declining', () => {
  const state = { ...fixture(), inventory: ['solvent','twin','solvent'],
    pendingReward: { options: [{ type:'consumable', id:'catalyst' }] } };
  assert.deepEqual(chooseReward(state, 0), state);
  assert.deepEqual(chooseReward(state, 0, 5), state);
  const replaced = chooseReward(state, 0, 1);
  assert.deepEqual(replaced.inventory, ['solvent','catalyst','solvent']);
  assert.equal(replaced.pendingReward, null);
  assert.deepEqual(chooseReward(state,-1).inventory, state.inventory);
});

test('reward progress comes from reactions and a declined draft cannot be repeated', () => {
  const state = { ...fixture([3,2,2,3]), rewardThreshold: 2 };
  const next = place(state, 2);
  assert.ok(next.pendingReward);
  assert.ok(next.essence < next.last.essence);
  const declined = chooseReward(next, -1);
  const after = chooseReward(declined, -1);
  assert.deepEqual(after, declined);
  assert.equal(after.rewardCount, declined.rewardCount);
});

test('unsafe capacity reduction is excluded from drafts and exhausted relic pools keep rewarding consumables', () => {
  const crowded = { ...fixture([2,2,...Array.from({length:16},(_,i) => i+10)]), rewardThreshold:1 };
  const reward = place(crowded,1);
  assert.equal(reward.over,false);
  assert.equal(reward.ring.length,17);
  assert.ok(reward.pendingReward);
  assert.equal(reward.pendingReward.options.some(o => o.id === 'halo'),false);
  let equipped = fixture([3,2,2,3]);
  for (const relic of RELICS) equipped = grant(equipped,relic.id);
  const next = place({...equipped,rewardThreshold:1},2);
  assert.ok(next.pendingReward);
  assert.ok(next.pendingReward.options.length > 0);
  assert.ok(next.pendingReward.options.every(o => o.type === 'consumable'));
});

test('saved pending drafts preserve their options and excess progress produces sequential rewards', () => {
  const state = { ...fixture([3,2,2,3]), essence:100, rewardThreshold:2 };
  const next = place(state,2);
  assert.ok(next.pendingReward);
  const loaded = clone(next);
  assert.deepEqual(loaded.pendingReward,next.pendingReward);
  const after = chooseReward(next,-1);
  assert.deepEqual(chooseReward(loaded,-1),after);
  assert.ok(after.pendingReward,'remaining earned progress should create the next draft');
  assert.ok(after.essence < next.essence,'each new saved draft must deduct its threshold');
  assert.ok(after.rewardCount > next.rewardCount);
  assert.deepEqual(after.ring,next.ring);
  assert.equal(after.turns,next.turns);
});

test('defeat cannot be rescued through a reward or manual action', () => {
  const state = { ...fixture([1,2], atom(3,'incoming')), capacity:2, inventory:['solvent',null,null] };
  const dead = place(state,0);
  assert.equal(dead.over,true);
  assert.equal(dead.pendingReward,null);
  assert.deepEqual(useConsumable(dead,0,dead.ring[0].id),dead);
  assert.deepEqual(place(dead,0),dead);
});

test('Phoenix rescues overflow once, destroys highest ordinary and does not grant Essence', () => {
  const state = { ...grant(fixture([2,8], atom(3,'incoming')), 'phoenix'), capacity:2 };
  const next = place(state,0);
  assert.equal(next.over,false);
  assert.equal(next.relicState.phoenix.used,true);
  assert.equal(next.ring.some(p => p.rank === 8),false);
  assert.equal(next.essence,0);
  const dead = place({...next, incoming:atom(7,'fresh')},0);
  assert.equal(dead.over,true);
});

test('Lens respects rank floor and does not consume a charge for an invalid adjustment', () => {
  const state = grant(fixture([2],atom(1,'incoming')),'lens');
  const before = clone(state);
  const invalid = useRelic(state,'lens',-1);
  assert.deepEqual(invalid,before);
  const next = useRelic(state,'lens',1);
  assert.equal(next.incoming.rank,2);
  assert.equal(next.relicState.lens.charges,0);
  assert.equal(next.turns,state.turns);
  assert.deepEqual(state,before);
});

test('relic charges recharge through their stated reaction or placement counters only', () => {
  let lens = grant(fixture([],atom(1,'incoming')),'lens');
  lens = useRelic(lens,'lens',1);
  const reacted = place({...lens,
    ring:Array.from({length:12},(_,i) => atom(1,`r${i}`)), incoming:catalyst('reaction')},0);
  assert.equal(reacted.last.pairs,6);
  assert.equal(reacted.relicState.lens.charges,1);
  let phial = grant(fixture([],atom(2,'incoming')),'twinned');
  phial = useRelic(phial,'twinned');
  for (let count=0;count<20;count++) {
    const before = clone(phial);
    assert.deepEqual(useRelic(phial,'twinned'),before);
    phial = place({...phial,ring:[],incoming:atom(1,`placement${count}`)},0);
    assert.equal(phial.relicState.twinned.charges,count===19 ? 1 : 0);
  }
});

test('explicit extraction has no free turn or Essence and can transmute into a catalyst', () => {
  const state = { ...fixture([2,5]), incoming:{id:'incoming',kind:'extract'} };
  const next = useRelic(state,'extract','r1');
  assert.equal(next.incoming.rank,5);
  assert.equal(next.ring.length,1);
  assert.equal(next.turns,state.turns);
  assert.equal(next.essence,state.essence);
  const converted = useRelic(next,'transmute');
  assert.equal(converted.incoming.kind,'catalyst');
  assert.equal(converted.turns,state.turns);
});

test('extraction without any ordinary target cannot softlock survival', () => {
  const state = {...fixture([1,'+']),incoming:{id:'incoming',kind:'extract'},inventory:['solvent',null,null]};
  const dissolved = useConsumable(state,0,'r0');
  assert.equal(dissolved.incoming.kind,'catalyst');
  assert.equal(dissolved.turns,state.turns);
  assert.equal(place(dissolved,0).turns,state.turns+1);
  const draw = fixture(['+']);
  draw.queue[0] = {id:'next-extract',kind:'extract'};
  const next = place(draw,0);
  assert.equal(next.incoming.id,'next-extract');
  assert.equal(next.incoming.kind,'catalyst');
  assert.equal(next.over,false);
});

test('Halo and Blood award their stated bonuses from reaction starting occupancy', () => {
  let state = fixture([3,2,1,1,2,3,...Array.from({length:10},(_,i)=> i+10)]);
  state = grant(grant(state,'halo'),'blood');
  assert.equal(state.capacity,16);
  const next = place(state,3);
  assert.equal(next.last.pairs,3);
  assert.equal(next.last.essence,11,'base 4, Halo +4, Blood +3');
  assert.equal(next.over,false);
  assert.equal(next.ring.length,11);
});

test('survival continues with the same vessel beyond long placement counts', () => {
  const state = {...fixture([2,2]),turns:100000};
  const next = place(state,1);
  assert.equal(next.turns,100001);
  assert.equal(next.over,false);
  assert.deepEqual(ranks(next),[3]);
  assert.equal(next.ring[0].id,state.incoming.id);
});

test('meta unlocks persist separately while each run starts with a fresh build', () => {
  const meta = updateMeta(createMeta(), {...fixture(), highest:7, turns:60});
  assert.ok(meta.unlockedRelics.includes('phoenix'));
  assert.ok(meta.unlockedStarters.includes('mirror'));
  const fresh = createGame(77,'mirror',meta);
  assert.equal(fresh.over,false);
  assert.equal(fresh.turns,0);
  assert.deepEqual(fresh.inventory,createGame(77).inventory);
  assert.equal(fresh.pendingReward,null);
});

test('malformed saves are rejected rather than accepted as playable state', () => {
  for (const bad of [null, {}, [], {version:1}, {...createGame(1), rng:NaN},
    {...createGame(1), ring:[atom(-1,'bad')]}, {...createGame(1), queue:[]}]) {
    assert.equal(validateSave(bad),false);
  }
});

test('bounded seeded greedy play terminates each action and preserves state invariants', () => {
  for (const seed of [1,42,2026]) {
    let state = createGame(seed);
    for (const relic of RELICS) state = grant(state,relic.id);
    for (let action=0; action<100 && !state.over; action++) {
      if (state.pendingReward) {
        state = chooseReward(state,-1);
      } else if (state.incoming.kind === 'extract') {
        const target = state.ring.find(p => p.kind === 'ingredient');
        assert.ok(target,'extract must have a valid target in reachable play');
        state = useRelic(state,'extract',target.id);
      } else {
        const before = clone(state);
        const candidates = Array.from({length:Math.max(1,state.ring.length)}, (_,gap) => ({gap,next:previewPlacement(state,gap)}));
        candidates.sort((a,b) => Number(a.next.over)-Number(b.next.over) || a.next.ring.length-b.next.ring.length || b.next.last.pairs-a.next.last.pairs);
        assert.deepEqual(state,before);
        state = place(state,candidates[0].gap);
        assert.deepEqual(state,candidates[0].next);
      }
      assertInvariant(state);
    }
  }
});
