/** Pure, serializable circular alchemy simulation. No browser or wall-clock dependencies. */
export const RELICS = [
  { id: 'lens', name: 'Prismatic Lens', icon: '◈', active: true, description: 'Adjust the incoming ingredient by ±1 (minimum 1). One charge; recharge by consuming 6 pairs.' },
  { id: 'twinned', name: 'Twinned Phial', icon: '⚯', active: true, description: 'Record the incoming rank: the next two ordinary draws become copies. One charge; recharge in 20 placements.' },
  { id: 'bell', name: 'Resonant Bell', icon: '♧', description: 'A reaction of 3+ pairs turns a future ordinary draw into a catalyst. Six ordinary placements between activations.' },
  { id: 'halo', name: 'Glass Halo', icon: '◎', description: 'Capacity becomes 16. Reactions of 3+ pairs earn double base Essence.' },
  { id: 'tongs', name: 'Silver Tongs', icon: '⋔', active: true, description: 'Extract an ingredient, displacing your current draw to the forecast. One charge; recharge by consuming 8 pairs.' },
  { id: 'echo', name: 'Echo Urn', icon: '◉', active: true, description: 'Remember an explicitly extracted rank. Choose to echo it into the next ordinary draw; one pending echo at a time.' },
  { id: 'blood', name: 'Blood Crucible', icon: '◆', description: 'Reactions starting within two pieces of capacity earn +1 Essence per consumed pair.' },
  { id: 'phoenix', name: 'Phoenix Seal', icon: '✧', description: 'Once per run, survive overflow by destroying the highest ingredient. No Essence from destruction.' },
];
export const CONSUMABLES = [
  { id: 'solvent', name: 'Solvent', icon: '⌁', target: true, description: 'Remove a chosen vessel ingredient. No Essence.' },
  { id: 'twin', name: 'Twin Draught', icon: '⚯', target: true, description: 'Copy a vessel ingredient into the next ordinary incoming draw. The source stays.' },
  { id: 'catalyst', name: 'Catalyst Ampoule', icon: '+', description: 'Turn the current ordinary ingredient into a catalyst.' },
];
const RIDS = RELICS.map(r => r.id);
const CIDS = CONSUMABLES.map(r => r.id);
const NAMES = ['Dew', 'Ember', 'Moon Salt', 'Foxglove', 'Sunstone', 'Star Moss', 'Quicksilver', 'Dragon Ash', 'Void Pearl', 'Aether', 'Soulglass', 'Astral Gold'];
const SYMBOLS = ['✦', '△', '☾', '❋', '◇', '✳', '☿', '♜', '◉', '✧', '⬡', '☼'];
const COLORS = ['#86d6ca', '#f09d74', '#b8b0ec', '#c4d68b', '#ebca76', '#88baa4', '#9abfdf', '#d99caf', '#b897e3', '#95d9e1', '#ddc4ee', '#f0d489'];
export function ingredient(rank) {
  const i = (Math.max(1, Math.trunc(rank)) - 1) % NAMES.length;
  return { name: NAMES[i] + (rank > 12 ? ` ${Math.ceil(rank / 12)}` : ''), symbol: SYMBOLS[i], color: COLORS[i] };
}
const clone = value => JSON.parse(JSON.stringify(value));
const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
const active = s => !s.over && !s.pendingReward;
function random(s) {
  let x = s.rng >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.rng = x >>> 0;
  return s.rng / 4294967296;
}
function make(s, kind, rank) {
  const p = { id: `p${s.nextId++}`, kind };
  if (kind === 'ingredient') p.rank = rank;
  return p;
}
function draw(s) {
  const roll = random(s);
  if (s.drawDrought >= 4 || roll < 0.24) {
    s.drawDrought = 0;
    return make(s, 'catalyst');
  }
  s.drawDrought++;
  if (roll < 0.31) return make(s, 'extract');
  const low = Math.max(1, Math.floor(s.highest / 3));
  return make(s, 'ingredient', low + Math.floor(random(s) * Math.min(3, s.highest - low + 1)));
}
function applyEffects(s) {
  for (const p of [s.incoming, ...s.queue]) {
    if (p.kind !== 'ingredient' || p.modified || !s.effects.length) continue;
    const effect = s.effects.shift();
    p.modified = effect.source;
    if (effect.kind === 'catalyst') { p.kind = 'catalyst'; delete p.rank; }
    else p.rank = effect.rank;
  }
}
function pendingSource(s, source) {
  return s.effects.some(e => e.source === source) || [s.incoming, ...s.queue, ...s.deferred].some(p => p.modified === source);
}
function future(s, effect, includeIncoming = true) {
  // Bind to an existing draw identity; collisions continue to the next ordinary draw.
  const draws = includeIncoming ? [s.incoming, ...s.queue] : s.queue;
  for (const p of draws) {
    if (p.kind !== 'ingredient' || p.modified) continue;
    p.modified = effect.source;
    if (effect.kind === 'catalyst') { p.kind = 'catalyst'; delete p.rank; }
    else p.rank = effect.rank;
    return;
  }
  s.effects.push(effect);
}
function nextDraw(s) {
  s.incoming = s.queue.shift();
  s.queue.push(s.deferred.length ? s.deferred.shift() : draw(s));
  applyEffects(s);
  ensurePlayable(s);
}
function ensurePlayable(s) {
  // An extraction tool without any target becomes a catalyst, rather than blocking the run.
  if (s.incoming.kind === 'extract' && !s.ring.some(p => p.kind === 'ingredient')) {
    s.incoming = { id: s.incoming.id, kind: 'catalyst' };
    return true;
  }
  return false;
}
function message(s, value) {
  s.last = { pairs: 0, chains: 0, longest: 0, essence: 0, message: value, removedIds: [] };
}
export function createGame(seed = 1, starter = 'standard', meta) {
  const numericSeed = Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 1;
  const s = {
    version: 1, seed: numericSeed, rng: numericSeed || 0x9e3779b9, nextId: 1,
    ring: [], incoming: null, queue: [], capacity: 18, turns: 0, score: 0,
    essence: 0, rewardThreshold: 6, rewardCount: 0, highest: 2,
    relics: [], relicState: {}, inventory: ['solvent', 'catalyst', null], pendingReward: null,
    over: false, extracted: false, drawDrought: 0, effects: [], deferred: [], starter,
    eligibleRelics: meta?.unlockedRelics?.filter(id => RIDS.includes(id)) ?? RIDS.filter(id => id !== 'phoenix'),
    stats: { pairs: 0, reactions: 0, longest: 0, extractions: 0, consumables: 0 },
  };
  const ranks = starter === 'mirror' ? [3, 2, 1, 1, 2, 3] : [2, 1, 1, 2, 1];
  s.ring = ranks.map(rank => make(s, 'ingredient', rank));
  s.highest = Math.max(...ranks);
  s.incoming = make(s, 'catalyst');
  s.queue = Array.from({ length: 3 }, () => draw(s));
  message(s, 'Insert the catalyst between equal ranks. Build mirrors for longer reactions.');
  return s;
}
function collapse(s, centerId, first) {
  const i = s.ring.findIndex(p => p.id === centerId);
  if (s.ring.length < 3 || i < 0) return false;
  const li = (i + s.ring.length - 1) % s.ring.length, ri = (i + 1) % s.ring.length;
  const left = s.ring[li], right = s.ring[ri], center = s.ring[i];
  if (left.kind !== 'ingredient' || right.kind !== 'ingredient' || left.rank !== right.rank) return false;
  const rank = first ? left.rank + 1 : Math.max(center.rank + 1, left.rank + 2);
  s.last.removedIds.push(left.id, right.id);
  s.ring = s.ring.filter((_, k) => k !== li && k !== ri).map(p => p.id === centerId ? { id: centerId, kind: 'ingredient', rank } : p);
  s.highest = Math.max(s.highest, rank);
  s.score += rank * 10;
  return true;
}
function resolve(s) {
  // Every successful pass removes two physical pieces, bounding the loop by board size.
  for (;;) {
    const center = s.ring.find((p, i, ring) => p.kind === 'catalyst' && ring.length >= 3 &&
      ring[(i + ring.length - 1) % ring.length].kind === 'ingredient' &&
      ring[(i + 1) % ring.length].kind === 'ingredient' &&
      ring[(i + ring.length - 1) % ring.length].rank === ring[(i + 1) % ring.length].rank);
    if (!center) return;
    const occupancy = s.ring.length;
    let pairs = 0;
    while (collapse(s, center.id, pairs === 0)) pairs++;
    const base = pairs + Math.max(0, pairs - 2);
    let essence = base;
    for (const id of s.relics) {
      const r = s.relicState[id];
      if (id === 'halo' && pairs >= 3) essence += base;
      if (id === 'blood' && occupancy >= s.capacity - 2) essence += pairs;
      if ((id === 'lens' || id === 'tongs') && r.charges === 0) {
        r.progress += pairs;
        if (r.progress >= (id === 'lens' ? 6 : 8)) { r.charges = 1; r.progress = 0; }
      }
      if (id === 'bell' && pairs >= 3 && r.progress >= 6 && !pendingSource(s, 'bell')) {
        future(s, { kind: 'catalyst', source: 'bell' }, false);
        r.progress = 0;
      }
    }
    s.last.pairs += pairs; s.last.chains++; s.last.longest = Math.max(s.last.longest, pairs);
    s.last.essence += essence;
    s.stats.pairs += pairs; s.stats.reactions++; s.stats.longest = Math.max(s.stats.longest, pairs);
  }
}
function offer(s) {
  if (s.over || s.pendingReward || s.essence < s.rewardThreshold) return;
  s.essence -= s.rewardThreshold;
  s.rewardCount++;
  s.rewardThreshold = Math.min(18, 6 + Math.floor(s.rewardCount / 3) * 2);
  const relics = s.eligibleRelics.filter(id => !s.relics.includes(id) && (id !== 'halo' || s.ring.length <= 16));
  const pool = [...relics.map(id => ({ type: 'relic', id })), ...CIDS.map(id => ({ type: 'consumable', id }))];
  const options = [];
  // Favor a relic in the first slot while preserving randomized distinct options.
  if (relics.length) {
    const id = relics[Math.floor(random(s) * relics.length)];
    const index = pool.findIndex(o => o.type === 'relic' && o.id === id);
    options.push(pool.splice(index, 1)[0]);
  }
  while (options.length < 3 && pool.length) options.push(pool.splice(Math.floor(random(s) * pool.length), 1)[0]);
  s.pendingReward = { options };
}
export function place(state, gapIndex) {
  if (!active(state) || state.incoming.kind === 'extract' || !int(gapIndex, 0, Math.max(0, state.ring.length - 1))) return state;
  const s = clone(state);
  const placed = s.incoming;
  message(s, 'The vessel settles.');
  s.ring.splice(gapIndex, 0, placed);
  s.turns++; s.extracted = false;
  if (placed.kind === 'ingredient') s.highest = Math.max(s.highest, placed.rank);
  for (const id of s.relics) {
    const r = s.relicState[id];
    if (id === 'twinned' && r.charges === 0 && ++r.progress >= 20) { r.charges = 1; r.progress = 0; }
    if (id === 'bell' && placed.kind === 'ingredient') r.progress = Math.min(6, r.progress + 1);
  }
  resolve(s);
  let rescued = false;
  for (const id of s.relics) {
    if (id !== 'phoenix' || s.relicState[id].used || s.ring.length <= s.capacity) continue;
    const candidates = s.ring.filter(p => p.kind === 'ingredient');
    if (!candidates.length) continue;
    const best = candidates.reduce((a, b) => b.rank > a.rank ? b : a);
    s.ring = s.ring.filter(p => p.id !== best.id);
    s.last.removedIds.push(best.id); s.relicState[id].used = true; rescued = true;
  }
  s.over = s.ring.length > s.capacity;
  s.essence += s.last.essence;
  nextDraw(s);
  s.last.message = s.over ? 'Vessel overflow. This run is complete.' : rescued ? 'Phoenix Seal burned your highest ingredient to prevent overflow.' : s.last.pairs ? `${s.last.pairs} pairs transmuted · +${s.last.essence} Essence` : 'No reaction. Prepare a mirror for your next catalyst.';
  offer(s);
  return s;
}
export function previewPlacement(state, gapIndex) { return place(state, gapIndex); }
function extract(s, targetId, displace) {
  const piece = s.ring.find(p => p.id === targetId && p.kind === 'ingredient');
  if (!piece) return false;
  if (displace) {
    s.deferred.unshift(s.queue.pop());
    s.queue.unshift(s.incoming);
  }
  s.ring = s.ring.filter(p => p.id !== piece.id);
  s.incoming = piece;
  s.extracted = true;
  s.stats.extractions++;
  if (s.relics.includes('echo')) s.relicState.echo.memory = piece.rank;
  message(s, `Extracted rank ${piece.rank}. Reinsert it or transmute it into a catalyst.`);
  return true;
}
export function useRelic(state, relicId, argument) {
  if (!active(state)) return state;
  const s = clone(state);
  if (relicId === 'extract') {
    if (s.incoming.kind !== 'extract' || !extract(s, argument, false)) return state;
    return s;
  }
  if (relicId === 'transmute') {
    if (!(s.extracted && s.incoming.kind === 'ingredient') && !(s.incoming.kind === 'extract' && !s.ring.some(p => p.kind === 'ingredient'))) return state;
    s.incoming = { id: s.incoming.id, kind: 'catalyst' }; s.extracted = false;
    message(s, 'Extracted ingredient transmuted into a catalyst.'); return s;
  }
  if (!s.relics.includes(relicId)) return state;
  const r = s.relicState[relicId];
  if (relicId === 'lens') {
    if (!r.charges || s.incoming.kind !== 'ingredient' || ![1, -1].includes(argument) || s.incoming.rank + argument < 1) return state;
    s.incoming.rank += argument; r.charges = 0; r.progress = 0;
    message(s, `Lens tuned the incoming rank to ${s.incoming.rank}.`);
  } else if (relicId === 'tongs') {
    if (!r.charges || s.extracted || !extract(s, argument, true)) return state;
    r.charges = 0; r.progress = 0;
  } else if (relicId === 'twinned') {
    if (!r.charges || s.incoming.kind !== 'ingredient' || pendingSource(s, 'twinned')) return state;
    const rank = s.incoming.rank;
    future(s, { kind: 'rank', rank, source: 'twinned' }, false);
    future(s, { kind: 'rank', rank, source: 'twinned' }, false);
    r.charges = 0; r.progress = 0;
    message(s, `Phial recorded rank ${rank} for two future ordinary draws.`);
  } else if (relicId === 'echo') {
    if (!r.memory || pendingSource(s, 'echo')) return state;
    if (argument === false) { r.memory = null; message(s, 'Echo memory released.'); }
    else {
      future(s, { kind: 'rank', rank: r.memory, source: 'echo' }, false);
      r.memory = null; message(s, 'Echo bound to the next ordinary draw.');
    }
  } else return state;
  return s;
}
export function useConsumable(state, slotIndex, targetId) {
  if (!active(state) || !int(slotIndex, 0, 2) || !state.inventory[slotIndex]) return state;
  const id = state.inventory[slotIndex], s = clone(state);
  if (id === 'catalyst') {
    if (s.incoming.kind !== 'ingredient') return state;
    s.incoming = { id: s.incoming.id, kind: 'catalyst' }; s.extracted = false;
    message(s, 'Ampoule transformed the incoming ingredient into a catalyst.');
  } else {
    const piece = s.ring.find(p => p.id === targetId && p.kind === 'ingredient');
    if (!piece) return state;
    if (id === 'solvent') { s.ring = s.ring.filter(p => p.id !== piece.id); message(s, 'Solvent dissolved the chosen ingredient.'); }
    else if (id === 'twin') { future(s, { kind: 'rank', rank: piece.rank, source: 'twin' }); message(s, `Twin Draught copied rank ${piece.rank} into the next ordinary draw.`); }
    else return state;
  }
  s.inventory[slotIndex] = null; s.stats.consumables++;
  if (ensurePlayable(s)) s.last.message += ' With no extraction target, the incoming tool became a catalyst.';
  return s;
}
export function chooseReward(state, optionIndex, replaceSlot) {
  if (state.over || !state.pendingReward || !int(optionIndex, -1, state.pendingReward.options.length - 1)) return state;
  const s = clone(state);
  if (optionIndex !== -1) {
    const option = s.pendingReward.options[optionIndex];
    if (option.type === 'relic') {
      if (s.relics.includes(option.id) || (option.id === 'halo' && s.ring.length > 16)) return state;
      s.relics.push(option.id);
      s.relicState[option.id] = ['lens', 'tongs', 'twinned'].includes(option.id) ? { charges: 1, progress: 0 } : option.id === 'bell' ? { progress: 6 } : option.id === 'echo' ? { memory: null } : option.id === 'phoenix' ? { used: false } : {};
      if (option.id === 'halo') s.capacity = 16;
      message(s, `${RELICS.find(r => r.id === option.id).name} acquired for this run.`);
    } else {
      let slot = s.inventory.indexOf(null);
      if (slot === -1) { if (!int(replaceSlot, 0, 2)) return state; slot = replaceSlot; }
      s.inventory[slot] = option.id;
      message(s, `${CONSUMABLES.find(c => c.id === option.id).name} stored.`);
    }
  } else message(s, 'Reward declined. The vessel remains unchanged.');
  s.pendingReward = null;
  offer(s);
  return s;
}
export function createMeta() {
  return { version: 1, bestScore: 0, bestTurns: 0, highest: 0, runs: 0, discoveries: [], unlockedRelics: RIDS.filter(id => id !== 'phoenix'), unlockedStarters: ['standard'], starters: ['standard'], completedSeeds: [] };
}
export function updateMeta(meta, state) {
  const m = { ...createMeta(), ...clone(meta || {}) };
  m.bestScore = Math.max(m.bestScore, state.score); m.bestTurns = Math.max(m.bestTurns, state.turns); m.highest = Math.max(m.highest, state.highest);
  m.discoveries = [...new Set([...m.discoveries, ...Array.from({ length: state.highest }, (_, i) => i + 1)])].sort((a, b) => a - b);
  if (state.highest >= 7 && !m.unlockedRelics.includes('phoenix')) m.unlockedRelics.push('phoenix');
  if (state.turns >= 60 && !m.unlockedStarters.includes('mirror')) m.unlockedStarters.push('mirror');
  m.starters = [...m.unlockedStarters];
  const key = `${state.seed}:${state.starter}`;
  if (state.over && !m.completedSeeds.includes(key)) { m.completedSeeds.push(key); m.runs++; }
  return m;
}
export function validateSave(s) {
  try {
    // Loading must never admit circular or otherwise non-serializable state.
    JSON.stringify(s);
    if (!s || typeof s !== 'object' || s.version !== 1 || !int(s.seed, 0, 0xffffffff) || !int(s.rng, 1, 0xffffffff) || !int(s.nextId, 1)) return false;
    const piece = p => p && typeof p === 'object' && /^p[1-9]\d*$/.test(p.id) && ['ingredient', 'catalyst', 'extract'].includes(p.kind) && (p.kind !== 'ingredient' || int(p.rank, 1, 100000)) && (p.modified === undefined || ['lens', 'twinned', 'bell', 'echo', 'twin'].includes(p.modified));
    if (!Array.isArray(s.ring) || s.ring.length > 100 || !s.ring.every(p => piece(p) && p.kind !== 'extract') || !piece(s.incoming) || !Array.isArray(s.queue) || s.queue.length !== 3 || !s.queue.every(piece) || !Array.isArray(s.deferred) || s.deferred.length > 10 || !s.deferred.every(piece)) return false;
    const pieces = [...s.ring, s.incoming, ...s.queue, ...s.deferred];
    if (new Set(pieces.map(p => p.id)).size !== pieces.length || pieces.some(p => Number(p.id.slice(1)) >= s.nextId)) return false;
    if (![16, 18].includes(s.capacity) || !['turns', 'score', 'essence', 'rewardCount'].every(k => int(s[k])) || !int(s.rewardThreshold, 1, 100) || !int(s.highest, 1, 100000) || !int(s.drawDrought, 0, 4) || typeof s.extracted !== 'boolean' || typeof s.over !== 'boolean') return false;
    if (!s.over && s.ring.length > s.capacity) return false;
    if (!Array.isArray(s.relics) || !s.relics.every(id => RIDS.includes(id)) || new Set(s.relics).size !== s.relics.length || !s.relicState || typeof s.relicState !== 'object' || (s.relics.includes('halo') ? s.capacity !== 16 : s.capacity !== 18)) return false;
    for (const id of s.relics) {
      const r = s.relicState[id]; if (!r || typeof r !== 'object') return false;
      if (['lens', 'tongs', 'twinned'].includes(id) && (!int(r.charges, 0, 1) || !int(r.progress, 0, 20))) return false;
      if (id === 'bell' && !int(r.progress, 0, 6)) return false;
      if (id === 'echo' && r.memory !== null && !int(r.memory, 1, 100000)) return false;
      if (id === 'phoenix' && typeof r.used !== 'boolean') return false;
    }
    if (!Array.isArray(s.eligibleRelics) || !s.eligibleRelics.every(id => RIDS.includes(id)) || !Array.isArray(s.inventory) || s.inventory.length !== 3 || !s.inventory.every(id => id === null || CIDS.includes(id))) return false;
    if (!Array.isArray(s.effects) || s.effects.length > 20 || !s.effects.every(e => e && ['rank', 'catalyst'].includes(e.kind) && ['twinned', 'bell', 'echo', 'twin'].includes(e.source) && (e.kind !== 'rank' || int(e.rank, 1, 100000)))) return false;
    if (!s.stats || !['pairs', 'reactions', 'longest', 'extractions', 'consumables'].every(k => int(s.stats[k])) || !['standard', 'mirror'].includes(s.starter)) return false;
    if (!s.last || !['pairs', 'chains', 'essence'].every(k => int(s.last[k])) || typeof s.last.message !== 'string' || !Array.isArray(s.last.removedIds) || !s.last.removedIds.every(id => typeof id === 'string')) return false;
    if (s.pendingReward !== null) {
      if (s.over || !s.pendingReward || !Array.isArray(s.pendingReward.options) || !int(s.pendingReward.options.length, 1, 3)) return false;
      const options = s.pendingReward.options;
      if (!options.every(o => o && (o.type === 'relic' ? RIDS.includes(o.id) && !s.relics.includes(o.id) && s.eligibleRelics.includes(o.id) : o.type === 'consumable' && CIDS.includes(o.id))) || new Set(options.map(o => `${o.type}:${o.id}`)).size !== options.length) return false;
    }
    return true;
  } catch { return false; }
}
