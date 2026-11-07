/** Presentation only: committed engine states stay authoritative throughout animation. */
import { ingredient } from './engine.js';

const sessions = new WeakMap();
const circle = (rect, index, count) => {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, count);
  return { x: rect.left + rect.width / 2 + rect.width * 145 / 420 * Math.cos(angle), y: rect.top + rect.height / 2 + rect.height * 145 / 420 * Math.sin(angle) };
};

function snapshot(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const node = element.cloneNode(true);
  node.removeAttribute('id');
  node.querySelectorAll('[id]').forEach(child => child.removeAttribute('id'));
  for (const key of ['background', 'border', 'border-radius', 'box-shadow', 'color', 'font-family', 'font-size', 'line-height', 'display', 'align-items', 'justify-content', 'flex-direction']) node.style.setProperty(key, style.getPropertyValue(key));
  node.style.setProperty('--particle-color', style.getPropertyValue('--particle-color'));
  Object.assign(node.style, { width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', position: 'relative', transform: 'none', opacity: '1' });
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, color: style.getPropertyValue('--particle-color').trim() || '#c69aff', node };
}

/** Call immediately before replacing the board DOM. Coordinates are viewport-relative. */
export function captureScene(root) {
  const pieces = {};
  root.querySelectorAll('.ring-piece[data-id]').forEach(button => { pieces[button.dataset.id] = snapshot(button.querySelector('.particle') || button); });
  const vessel = root.querySelector('.vessel')?.getBoundingClientRect();
  return { pieces, incoming: snapshot(root.querySelector('.incoming .particle')), vessel: vessel ? { left: vessel.left, top: vessel.top, width: vessel.width, height: vessel.height } : null };
}

/** Safe to call repeatedly, including during a pending transition. */
export function cancelMotion(root) { sessions.get(root)?.cleanup(); }

export async function animateTransition(root, before, previous, next, { gap, actionType } = {}) {
  cancelMotion(root);
  if (!before?.vessel || document.hidden || typeof Element.prototype.animate !== 'function') return { animated: false };
  const animations = new Set(), hidden = [], ghosts = new Map();
  const layer = document.createElement('div');
  layer.className = 'motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '18', overflow: 'hidden', contain: 'layout style', isolation: 'isolate' });
  document.body.append(layer);
  let cancelled = false, watchdog;
  const session = { cleanup() {
    if (cancelled) return;
    cancelled = true;
    clearTimeout(watchdog);
    for (const animation of animations) animation.cancel();
    for (const [node, opacity] of hidden) node.style.opacity = opacity;
    layer.remove();
    document.removeEventListener('visibilitychange', visibility);
    if (sessions.get(root) === session) sessions.delete(root);
  } };
  const visibility = () => { if (document.hidden) session.cleanup(); };
  sessions.set(root, session);
  document.addEventListener('visibilitychange', visibility);
  // A hard wall-clock bound also releases busy state if a browser suspends animations.
  let timeoutResolve;
  const timeout = new Promise(resolve => { timeoutResolve = resolve; });
  watchdog = setTimeout(() => { session.cleanup(); timeoutResolve(); }, 1250);
  const play = (node, frames, duration, extra = {}) => {
    if (cancelled || !node) return Promise.resolve();
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both', ...extra });
    animations.add(animation);
    // Keep finished animations too: fill:'both' must be canceled on cleanup.
    return animation.finished.catch(() => {});
  };
  const hide = node => { if (node) { hidden.push([node, node.style.opacity]); node.style.opacity = '0'; } };
  const ghost = (data, id) => {
    if (!data) return null;
    const holder = document.createElement('div');
    Object.assign(holder.style, { position: 'absolute', left: '0', top: '0', width: `${data.width}px`, height: `${data.height}px`, margin: '0', transform: `translate(${data.x - data.width / 2}px,${data.y - data.height / 2}px)`, transformOrigin: 'center', filter: `drop-shadow(0 0 9px ${data.color})` });
    holder.append(data.node.cloneNode(true)); layer.append(holder);
    const value = { ...data, holder };
    ghosts.set(id, value); return value;
  };
  const move = async (g, target, duration, { absorb = false } = {}) => {
    if (!g || cancelled) return;
    const start = `translate(${g.x - g.width / 2}px,${g.y - g.height / 2}px)`;
    const end = `translate(${target.x - g.width / 2}px,${target.y - g.height / 2}px)`;
    const scale = absorb ? .12 : target.width ? target.width / g.width : g.scale || 1;
    await play(g.holder, [{ transform: `${start} scale(${g.scale || 1})`, opacity: 1 }, { transform: `${end} scale(${scale})`, opacity: absorb ? 0 : 1 }], duration);
    g.scale = scale;
    g.x = target.x; g.y = target.y;
    if (absorb) g.holder.remove();
  };
  const sparks = (point, color, duration) => {
    for (let i = 0; i < 6 && !cancelled; i++) {
      const dot = document.createElement('span');
      Object.assign(dot.style, { position: 'absolute', left: `${point.x}px`, top: `${point.y}px`, width: '5px', height: '5px', borderRadius: '50%', background: i % 2 ? color : '#fff3b6', boxShadow: `0 0 12px ${color}` });
      layer.append(dot);
      const angle = i * Math.PI / 3;
      void play(dot, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(${Math.cos(angle) * 37}px,${Math.sin(angle) * 37}px) scale(.1)`, opacity: 0 }], duration).then(() => dot.remove());
    }
  };
  const work = async () => {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      await play(root.querySelector('.vessel'), [{ opacity: .88 }, { opacity: 1 }], 65);
      return;
    }
    const after = captureScene(root);
    if (!after.vessel) return;
    const placed = next.turns > previous.turns;
    const events = placed && Array.isArray(next.last.events) ? next.last.events : [];
    root.querySelectorAll('.ring-piece[data-id]').forEach(hide);
    for (const [id, data] of Object.entries(before.pieces)) ghost(data, id);
    if (placed) {
      const inserted = ghost(before.incoming, previous.incoming.id);
      const count = previous.ring.length + 1;
      const insertion = Number.isInteger(gap) ? gap : next.ring.findIndex(piece => piece.id === previous.incoming.id);
      const index = Math.max(0, insertion);
      const insertionPoint = previous.ring.length ? circle(after.vessel, index - .5, previous.ring.length) : circle(after.vessel, 0, 1);
      insertionPoint.width = Object.values(before.pieces)[0]?.width || 47;
      await move(inserted, insertionPoint, 175);
      // A fallback for imported older saves without recorded events: still show a visible collapse.
      if (!events.length && next.last.pairs) {
        const center = inserted || ghosts.values().next().value;
        await Promise.all(next.last.removedIds.map(id => move(ghosts.get(id), center || circle(after.vessel, index, count), 210, { absorb: true })));
      }
      const duration = Math.min(180, Math.floor(720 / Math.max(1, events.length)));
      for (const event of events) {
        if (cancelled) return;
        const center = ghosts.get(event.centerId);
        if (!center) continue;
        await Promise.all([move(ghosts.get(event.leftId), center, duration, { absorb: true }), move(ghosts.get(event.rightId), center, duration, { absorb: true })]);
        const info = ingredient(event.rank);
        const particle = center.holder.firstElementChild;
        particle.classList.remove('catalyst', 'extract'); particle.classList.add('ingredient');
        particle.style.setProperty('--particle-color', info.color); particle.style.color = '#211433';
        particle.style.background = `radial-gradient(circle at 35% 25%, ${info.color}, #252047 80%)`;
        particle.style.borderColor = info.color;
        const symbol = particle.querySelector('.particle-symbol'); if (symbol) symbol.textContent = info.symbol;
        let rank = particle.querySelector('.particle-rank');
        if (!rank) { rank = document.createElement('span'); rank.className = 'particle-rank'; particle.append(rank); }
        rank.textContent = event.rank;
        center.color = info.color;
        sparks(center, info.color, Math.min(190, duration));
        void play(particle, [{ scale: 1, filter: 'brightness(2.1)' }, { scale: 1.23, filter: 'brightness(1.4)', offset: .4 }, { scale: 1, filter: 'brightness(1)' }], Math.min(180, duration));
      }
    } else {
      const removed = [...ghosts].filter(([id]) => !after.pieces[id]);
      await Promise.all(removed.map(([id, g]) => move(g, next.incoming.id === id && after.incoming ? after.incoming : g, 240, { absorb: true })));
    }
    if (cancelled) return;
    const survivors = [];
    for (const [id, g] of ghosts) {
      if (!g.holder.isConnected) continue;
      const target = after.pieces[id];
      if (target) survivors.push(move(g, target, 170));
      else survivors.push(play(g.holder, [{ opacity: 1, scale: 1 }, { opacity: 0, scale: .5 }], 140));
    }
    if (!placed && after.incoming) survivors.push(play(root.querySelector('.incoming .particle'), [{ filter: 'brightness(2)', scale: .88 }, { filter: 'brightness(1)', scale: 1 }], 220));
    if (next.last.essence > 0 && placed) survivors.push(play(root.querySelector('.progress-track'), [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], 170));
    await Promise.all(survivors);
  };
  try { await Promise.race([work(), timeout]); return { animated: !cancelled, actionType }; }
  catch { return { animated: false }; }
  finally { session.cleanup(); }
}
