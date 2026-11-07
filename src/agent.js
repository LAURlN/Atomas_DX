/** Headless action interface shared by browser automation, CLI players and tests. */
import { place, useConsumable, useRelic, chooseReward, RELICS, CONSUMABLES } from './engine.js';

/** Apply a JSON action with the exact engine rules. Invalid actions return the input identity. */
export function applyAction(state, action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return state;
  if (action.type === 'consumable' && action.targetId !== undefined && typeof action.targetId !== 'string') return state;
  if (action.type === 'relic') {
    const { id, argument } = action;
    if (['extract', 'tongs'].includes(id) && typeof argument !== 'string') return state;
    if (id === 'lens' && argument !== 1 && argument !== -1) return state;
    if (id === 'echo' && argument !== undefined && typeof argument !== 'boolean') return state;
    if (['twinned', 'transmute'].includes(id) && argument !== undefined) return state;
  }
  switch (action.type) {
    case 'place': return place(state, action.gap);
    case 'consumable': return useConsumable(state, action.slot, action.targetId);
    case 'relic': return useRelic(state, action.id, action.argument);
    case 'reward': return chooseReward(state, action.index, action.replaceSlot);
    default: return state;
  }
}

/**
 * Enumerate engine-confirmed actions, including knowingly fatal placements.
 * Outcome essence/score are the resulting stored totals; pairs is the last action's pair count.
 * Each action can be passed straight back to applyAction, including its descriptive metadata.
 */
export function legalActions(state) {
  if (state.over) return [];
  const actions = [];
  const add = (action, label) => {
    const next = applyAction(state, action);
    if (next === state) return;
    actions.push({ ...action, label, outcome: {
      over: next.over, occupancy: next.ring.length, pairs: next.last.pairs,
      essence: next.essence, score: next.score,
    } });
  };
  if (state.pendingReward) {
    state.pendingReward.options.forEach((option, index) => {
      const catalog = option.type === 'relic' ? RELICS : CONSUMABLES;
      const name = catalog.find(item => item.id === option.id)?.name ?? option.id;
      if (option.type === 'consumable' && state.inventory.every(Boolean)) {
        state.inventory.forEach((oldId, replaceSlot) => {
          const oldName = CONSUMABLES.find(item => item.id === oldId)?.name ?? oldId;
          add({ type: 'reward', index, replaceSlot }, `Take ${name}; replace slot ${replaceSlot + 1} (${oldName})`);
        });
      } else add({ type: 'reward', index }, `Take ${name}`);
    });
    add({ type: 'reward', index: -1 }, 'Decline this reward');
    return actions;
  }
  for (let gap = 0; gap < Math.max(1, state.ring.length); gap++) {
    add({ type: 'place', gap }, state.ring.length ? `Place before piece ${state.ring[gap].id} (gap ${gap})` : 'Place in the empty vessel');
  }
  const targets = state.ring.filter(piece => piece.kind === 'ingredient');
  state.inventory.forEach((id, slot) => {
    const item = CONSUMABLES.find(item => item.id === id);
    if (!item) return;
    if (item.target) {
      for (const target of targets) add({ type: 'consumable', slot, targetId: target.id }, `Use ${item.name} from slot ${slot + 1} on ${target.id} (rank ${target.rank})`);
    } else add({ type: 'consumable', slot }, `Use ${item.name} from slot ${slot + 1}`);
  });
  for (const target of targets) {
    add({ type: 'relic', id: 'extract', argument: target.id }, `Extract ${target.id} (rank ${target.rank})`);
    add({ type: 'relic', id: 'tongs', argument: target.id }, `Use Silver Tongs on ${target.id} (rank ${target.rank})`);
  }
  add({ type: 'relic', id: 'transmute' }, 'Transmute the extracted ingredient into a catalyst');
  add({ type: 'relic', id: 'lens', argument: 1 }, 'Use Prismatic Lens: incoming rank +1');
  add({ type: 'relic', id: 'lens', argument: -1 }, 'Use Prismatic Lens: incoming rank −1');
  add({ type: 'relic', id: 'twinned' }, 'Record the incoming rank in Twinned Phial');
  add({ type: 'relic', id: 'echo', argument: true }, 'Use Echo Urn memory on the next ordinary draw');
  add({ type: 'relic', id: 'echo', argument: false }, 'Release Echo Urn memory');
  return actions;
}
