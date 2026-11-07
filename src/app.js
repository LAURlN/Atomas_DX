import { RELICS, CONSUMABLES, ingredient, createGame, place, useConsumable, useRelic, chooseReward, createMeta, updateMeta, validateSave } from './engine.js';
import { applyAction, legalActions } from './agent.js';
import { captureScene, animateTransition, cancelMotion } from './motion.js';

const params = new URLSearchParams(location.search);
const agentMode = params.get('agent') === '1';
if (agentMode) { document.title = '[PLAYTEST] ' + document.title; document.body.dataset.agentMode = 'true'; }
const requestedSeed = /^\d+$/.test(params.get('seed') || '') && Number(params.get('seed')) <= 0xffffffff ? Number(params.get('seed')) : undefined;
const SAVE_KEY = agentMode ? 'athanor.playtest.run.v1' : 'athanor.run.v1';
const META_KEY = agentMode ? 'athanor.playtest.archive.v1' : 'athanor.archive.v1';
const app = document.querySelector('#app');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const relicById = id => RELICS.find(r => r.id === id);
const itemById = id => CONSUMABLES.find(r => r.id === id);
let notice = '';
let meta = createMeta();
let state;
let gap = null;
let targeting = null;
let targetId = null;
let modal = null;
let replacement = null;
let busy = false;
let motionEpoch = 0;
let motionPromise = Promise.resolve();
const accents = { solvent:'#52f2d0', twin:'#b497ff', catalyst:'#ffd45c', lens:'#69d4ff', twinned:'#c69aff', bell:'#ff90c6', halo:'#95f3d8', tongs:'#ffb475', echo:'#ae9bff', blood:'#ff7d9b', phoenix:'#ffcc66' };
const accent = id => accents[id] || '#a3c7ff';
function freshSeed() { return globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] || Math.floor(Math.random()*0xffffffff) || 1; }
try {
  const value = JSON.parse(localStorage.getItem(META_KEY));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of ['bestScore','bestTurns','highest','runs']) if(Number.isSafeInteger(value[key]) && value[key]>=0) meta[key]=value[key];
    if(Array.isArray(value.discoveries)) meta.discoveries=value.discoveries.filter(v=>Number.isSafeInteger(v)&&v>=0);
    if(Array.isArray(value.completedSeeds)) meta.completedSeeds=value.completedSeeds.filter(v=>typeof v==='string' && /^\d+:(standard|mirror)$/.test(v));
    if(Array.isArray(value.unlockedRelics)) meta.unlockedRelics=value.unlockedRelics.filter(id=>RELICS.some(r=>r.id===id));
    if(Array.isArray(value.unlockedStarters)) meta.unlockedStarters=[...new Set(['standard',...value.unlockedStarters.filter(id=>id==='mirror')])];
  }
} catch { notice = 'Your archive could not be read. A new archive is ready.'; }
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) { const value = JSON.parse(raw); if (validateSave(value) && (!agentMode || requestedSeed === undefined || value.seed === requestedSeed)) { state = value; } else notice = 'A fresh vessel is ready.'; }
} catch { notice = 'The saved vessel could not be read. A fresh vessel is ready.'; }
if (!state) { state = createGame(agentMode ? requestedSeed ?? 42 : freshSeed(), 'standard', meta); modal = agentMode ? null : 'welcome'; }

function persist() {
  meta = updateMeta(meta, state);
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); localStorage.setItem(META_KEY, JSON.stringify(meta)); }
  catch { notice = 'Browser storage is unavailable. Keep this tab open to continue this run.'; }
}
function stopTransition() {
  motionEpoch++;
  cancelMotion(app);
  busy = false;
  motionPromise = Promise.resolve();
}
function commit(next, context = {}) {
  if (busy) return false;
  if (next === state) { targeting = null; targetId = null; notice = 'That action is not available yet.'; render(); return false; }
  const previous = state;
  const scene = captureScene(app);
  const chosenGap = gap;
  const epoch = ++motionEpoch;
  busy = !matchMedia('(prefers-reduced-motion: reduce)').matches && document.visibilityState !== 'hidden';
  state = next; gap = null; targeting = null; targetId = null; replacement = null;
  notice = ''; persist(); render();
  if (busy) {
    motionPromise = Promise.resolve().then(() => epoch === motionEpoch ? animateTransition(app, scene, previous, next, { gap: chosenGap, ...context }) : undefined)
      .catch(() => { if (epoch === motionEpoch) cancelMotion(app); })
      .finally(() => { if (epoch === motionEpoch) { busy = false; render(); } });
  }
  return true;
}
function startRun(starter = 'standard') { stopTransition(); state = createGame(freshSeed(), starter === 'mirror' && mirrorUnlocked() ? 'mirror' : 'standard', meta); modal = null; gap = null; targeting = null; targetId = null; replacement = null; notice = ''; persist(); render(); }
function mirrorUnlocked() {
  return Boolean(meta.unlockedStarters?.includes('mirror') || meta.starters?.includes('mirror') || meta.unlocks?.includes?.('mirror') || meta.unlocks?.mirror || meta.mirrorUnlocked);
}
function format(n) { return Number(n || 0).toLocaleString(); }
function pieceInfo(piece) {
  if (piece.kind === 'catalyst') return {name:'Catalyst', symbol:'✦', color:'#ffd45c', rank:null};
  if (piece.kind === 'extract') return {name:'Extraction', symbol:'−', color:'#6ee7ff', rank:null};
  return {...ingredient(piece.rank), rank:piece.rank};
}
function pieceHTML(piece, className = '') {
  const info = pieceInfo(piece);
  return `<span class="particle ${className} ${piece.kind}" style="--particle-color:${escapeHTML(info.color)}" title="${escapeHTML(info.name)}${info.rank ? ` · rank ${info.rank}` : ''}"><span class="particle-symbol">${escapeHTML(info.symbol)}</span>${info.rank ? `<span class="particle-rank">${info.rank}</span>` : ''}</span>`;
}
function header() {
  return `<header class="masthead"><a class="brand" href="#" data-action="home" aria-label="Athanor home"><img src="./assets/sigil.svg" alt="" width="42" height="42"><span>ATHANOR<small>THE ENDLESS ART</small></span></a><div class="header-actions"><span class="local-save"><i></i> SAVED LOCALLY</span><button class="icon-button" data-action="help" aria-label="How to play">?</button><button class="icon-button" data-action="settings" aria-label="Run and archive">☷</button></div></header>`;
}
function stats() {
  return `<div class="stats"><div><span class="eyebrow">TRANSMUTATION</span><strong>${format(state.score)}</strong></div><div><span class="eyebrow">HIGHEST RANK</span><strong>${state.highest}<small> / ${escapeHTML(ingredient(state.highest).name)}</small></strong></div><div><span class="eyebrow">PLACEMENTS</span><strong>${format(state.turns)}</strong></div></div>`;
}
function vessel() {
  const n = state.ring.length;
  const radius = 145;
  const points = state.ring.map((p,i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / Math.max(n,1);
    return {p, i, x:210 + radius * Math.cos(a), y:210 + radius * Math.sin(a)};
  });
  const removed = new Set();
  const chosen = targetId;
  const targets = targeting || state.incoming.kind === 'extract';
  const gapCount = Math.max(n,1);
  const gapHTML = Array.from({length:gapCount}, (_,i) => {
    const a = -Math.PI / 2 + (i - .5) * Math.PI * 2 / gapCount;
    const x = 210 + 179 * Math.cos(a); const y = 210 + 179 * Math.sin(a);
    return `<button class="gap-target ${gap === i ? 'selected' : ''}" style="left:${x/4.2}%;top:${y/4.2}%" data-action="gap" data-index="${i}" ${targets || state.over || state.pendingReward ? 'disabled' : ''} aria-label="Place in gap ${i+1}" aria-pressed="${gap === i}"><span>${gap === i ? '✦' : '+'}</span></button>`;
  }).join('');
  return `<section class="vessel-section" aria-label="Transmutation vessel"><div class="vessel-topline"><span class="eyebrow">THE VESSEL</span><span class="occupancy ${state.ring.length >= state.capacity-2 ? 'danger' : ''}"><b>${n}</b> / ${state.capacity} <span>occupied</span></span></div><div data-action="vessel-place" class="vessel ${targeting ? 'is-targeting' : ''}"><svg class="vessel-lines" viewBox="0 0 420 420" aria-hidden="true"><defs><radialGradient id="vesselGlow"><stop stop-color="#44695c" stop-opacity=".19"/><stop offset="1" stop-color="#162421" stop-opacity="0"/></radialGradient></defs><circle cx="210" cy="210" r="196" fill="url(#vesselGlow)"/><circle cx="210" cy="210" r="193"/><circle cx="210" cy="210" r="184" class="thin"/><circle cx="210" cy="210" r="145" class="orbit"/><circle cx="210" cy="210" r="87" class="inner-orbit"/><path d="m210 116 81 141H129ZM162 210h96M210 257v28" class="sigil"/>${Array.from({length:60},(_,i)=>{ const a=i*Math.PI/30; const r=i%5===0?187:190;return `<path d="M${210+r*Math.cos(a)} ${210+r*Math.sin(a)} L${210+194*Math.cos(a)} ${210+194*Math.sin(a)}" class="tick"/>`;}).join('')}</svg>${gapHTML}${points.map(({p,x,y})=>`<button class="ring-piece ${removed.has(p.id) ? 'will-react' : ''} ${chosen === p.id ? 'chosen-target' : ''} ${targets && p.kind === 'ingredient' ? 'available-target' : ''}" style="left:${x/4.2}%;top:${y/4.2}%;--piece-size:${n>14?'35px':n>10?'41px':'47px'}" data-action="target" data-id="${escapeHTML(p.id)}" aria-label="${escapeHTML(pieceInfo(p).name)}, ${p.kind==='ingredient'?`rank ${p.rank}`:p.kind}${targets?', select target':''}">${pieceHTML(p)}</button>`).join('')}<div class="incoming"><span class="eyebrow">${state.incoming.kind==='extract'?'CHOOSE AN INGREDIENT':'INCOMING'}</span>${pieceHTML(state.incoming,'large')}<span class="incoming-name">${escapeHTML(pieceInfo(state.incoming).name)}</span>${state.extracted ? '<button class="text-button" data-action="transmute">Transmute to ✦</button>' : '<span class="incoming-hint">'+(state.incoming.kind==='catalyst'?'Kindle a matching pair':state.incoming.kind==='extract'?'Lift it out, then place again':'Choose a gap in the circle')+'</span>'}</div></div><div class="forecast"><span class="eyebrow">COMING NEXT</span><div class="forecast-pieces">${state.queue.map((p,i)=>`<div>${pieceHTML(p,'small')}<span>${i+1}</span></div>`).join('')}<span class="forecast-line">→</span></div></div></section>`;
}
function placementPanel() {
  if (targeting || state.incoming.kind === 'extract') {
    const selected = state.ring.find(p=>p.id===targetId);
    return `<div class="action-panel targeting-panel"><div class="action-copy"><span class="eyebrow">${escapeHTML(targeting?.name || 'EXTRACTION')}</span><p>${selected ? `Selected: ${escapeHTML(pieceInfo(selected).name)} · rank ${selected.rank}` : `${escapeHTML(targeting?.description || 'Lift out an ingredient, then place it again.')} Select a highlighted ingredient.`}</p></div><div class="action-buttons"><button class="button primary" data-action="confirm-target" ${!selected?'disabled':''}>Confirm selection <span>↗</span></button>${targeting?'<button class="button secondary" data-action="cancel-target">Cancel</button>':''}</div></div>`;
  }
  return `<div class="placement-hint" role="status"><span class="placement-spark">✦</span><p>${busy?'The ingredients are finding their next form…':'Tap between ingredients to place.'}<small>${busy?'Let the reaction unfold.':'Build a mirror. Kindle a chain.'}</small></p></div>`;
}
function essence() {
  const percent = Math.min(100,100*state.essence/state.rewardThreshold);
  return `<section class="essence-panel"><div class="section-line"><h2><span>◇</span> Essence</h2><span>${state.essence} <small>/ ${state.rewardThreshold}</small></span></div><div class="progress-track" role="progressbar" aria-label="Essence toward reward" aria-valuenow="${state.essence}" aria-valuemin="0" aria-valuemax="${Math.max(state.rewardThreshold,state.essence)}"><span style="width:${percent}%"></span></div><p>Every reaction brings a new discovery.</p></section>`;
}
function compactInventory() {
  return `<div class="compact-preparations" aria-label="Single-use preparations">${state.inventory.map((id,i)=>{
    const item=itemById(id);
    return item?`<button class="compact-vial" style="--item-color:${accent(id)}" data-action="consumable" data-index="${i}" ${state.over||state.pendingReward||(id==='catalyst'&&state.incoming.kind!=='ingredient')?'disabled':''} title="${escapeHTML(item.description)}" aria-label="Use ${escapeHTML(item.name)}: ${escapeHTML(item.description)}"><span>${escapeHTML(item.icon)}</span><b>${escapeHTML(item.name)}</b></button>`:`<div class="compact-vial empty"><span>♧</span><b>Empty vial</b></div>`;
  }).join('')}</div>`;
}
function inventory() {
  return `<section class="inventory-panel"><div class="section-line"><h2><span>♧</span> Your preparations</h2><span class="eyebrow">SINGLE USE</span></div><div class="inventory">${state.inventory.map((id,i)=>{
    const item=itemById(id);
    return item?`<button class="inventory-slot filled" style="--item-color:${accent(id)}" data-action="consumable" data-index="${i}" ${state.over||state.pendingReward||(id==='catalyst'&&state.incoming.kind!=='ingredient')?'disabled':''} title="${escapeHTML(item.description)}"><span class="slot-number">0${i+1}</span><span class="item-icon">${escapeHTML(item.icon)}</span><b>${escapeHTML(item.name)}</b><span class="item-use">Use preparation ↗</span></button>`:`<div class="inventory-slot empty"><span class="slot-number">0${i+1}</span><span class="empty-symbol">♧</span><span>Empty vial</span></div>`;
  }).join('')}</div><p class="muted">A little foresight. A little intervention.</p></section>`;
}
function relicStatus(id) {
  const rs=state.relicState[id]||{};
  if (id==='phoenix') return rs.used?'Spent · kept in your collection':'Ready · once this run';
  if (id==='echo') return rs.memory ? `Remembering rank ${typeof rs.memory==='object'?rs.memory.rank:rs.memory}` : 'Awaiting an extraction';
  if (['lens','tongs','twinned'].includes(id)) return `${rs.charges||0} charge${rs.charges===1?'':'s'} ready`;
  return 'Always with you';
}
function relics() {
  return `<section class="relic-panel"><div class="section-line"><h2><span>✧</span> Relics of the art</h2><span class="eyebrow">${state.relics.length} COLLECTED</span></div>${state.relics.length?`<div class="relic-list">${state.relics.map(id=>{
    const relic=relicById(id);if(!relic)return '';
    const rs=state.relicState[id]||{};const blocked=state.over||state.pendingReward;
    const controls=id==='lens'?`<button class="mini-button" data-action="relic" data-id="lens" data-arg="-1" ${!rs.charges||blocked||state.incoming.kind!=='ingredient'||state.incoming.rank===1?'disabled':''}>−1</button><button class="mini-button" data-action="relic" data-id="lens" data-arg="1" ${!rs.charges||blocked||state.incoming.kind!=='ingredient'?'disabled':''}>+1</button>`:id==='tongs'||id==='twinned'?`<button class="mini-button" data-action="relic" data-id="${id}" ${!rs.charges||blocked||(id==='twinned'&&state.incoming.kind!=='ingredient')||(id==='tongs'&&state.extracted)?'disabled':''}>Use ↗</button>`:id==='echo'&&rs.memory?`<button class="mini-button" data-action="relic" data-id="echo" ${blocked?'disabled':''}>Recall ↗</button>`:'';
    return `<article class="relic" style="--item-color:${accent(id)}"><div class="relic-icon">${escapeHTML(relic.icon)}</div><div class="relic-copy"><h3>${escapeHTML(relic.name)}</h3><p>${escapeHTML(relic.description)}</p><span class="relic-status">${escapeHTML(relicStatus(id))}</span></div>${controls?`<div class="relic-controls">${controls}</div>`:''}</article>`;
  }).join('')}</div>`:'<div class="empty-relics"><span>✧</span><p>The shelves are quiet.</p><small>Earn Essence through reactions.<br>Your first relic is waiting.</small></div>'}<div class="collection-note"><span>∞</span> All relics stay with you until the vessel falls.</div></section>`;
}
function shell(content, label, extraClass='') { return `<div class="modal-shade"><section class="modal ${extraClass}" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1">${content}</section></div>`; }
function starterButtons() { return `<div class="starter-options"><button class="button primary" data-action="new" data-starter="standard">Kindle a new vessel <span>↗</span></button>${mirrorUnlocked()?'<button class="button secondary" data-action="new" data-starter="mirror">Mirror vessel <span>◇</span></button>':'<p class="locked-option">◇ Mirror vessel · discover through play</p>'}</div>`; }
function overlay() {
  if (busy) return '';
  if(state.pendingReward && !state.over) {
    const options=state.pendingReward.options;
    if(replacement!==null) {
      const option=options[replacement];const item=itemById(option.id);
      return shell(`<span class="modal-kicker">YOUR VIAL RACK IS FULL</span><h2>Make a little room.</h2><p>Choose a preparation to replace with <b>${escapeHTML(item?.name)}</b>.</p><div class="replace-options">${state.inventory.map((id,i)=>`<button class="reward-card" data-action="replace" data-index="${i}"><span>${escapeHTML(itemById(id)?.icon)}</span><b>Replace ${escapeHTML(itemById(id)?.name||'empty slot')}</b><small>${escapeHTML(itemById(id)?.description)}</small></button>`).join('')}</div><button class="button secondary" data-action="back-rewards">Back to discoveries</button>`, 'Replace a consumable');
    }
    return shell(`<span class="modal-kicker">ESSENCE BECOMES POSSIBILITY</span><h2>A discovery.</h2><p>Choose one gift for the work ahead.</p><div class="reward-options">${options.map((option,i)=>{const def=option.type==='relic'?relicById(option.id):itemById(option.id);return `<button class="reward-card" style="--item-color:${accent(option.id)}" data-action="reward" data-index="${i}"><span class="reward-kind">${option.type==='relic'?'RUN RELIC':'SINGLE USE'}</span><span class="reward-icon">${escapeHTML(def?.icon)}</span><b>${escapeHTML(def?.name||option.id)}</b><small>${escapeHTML(def?.description)}</small>${option.id==='halo'?`<em>Vessel capacity: ${state.capacity} → ${state.capacity-2}</em>`:''}<span class="reward-select">Choose discovery ↗</span></button>`;}).join('')}</div><button class="text-button" data-action="decline">Leave these behind</button>`, 'Choose a discovery', 'reward-modal');
  }
  if(state.over && modal!=='help') return shell(`<span class="modal-kicker">THE VESSEL HAS FALLEN SILENT</span><div class="death-sigil">◉</div><h2>Nothing is lost<br>to the art.</h2><p>Your vessel overflowed. The discoveries remain in your archive; the next vessel begins anew.</p><div class="death-stats"><div><b>${format(state.score)}</b><span>Transmutation</span></div><div><b>${state.highest}</b><span>Highest rank</span></div><div><b>${state.turns}</b><span>Placements</span></div></div>${starterButtons()}<button class="text-button" data-action="help">Revisit the principles</button>`, 'Run complete', 'death-modal');
  if(modal==='welcome') return shell(`<span class="modal-kicker">WELCOME TO THE LABORATORY</span><div class="welcome-sigil">♜</div><h2>Great things begin<br>with a small reaction.</h2><p>Arrange a circle of ingredients. Place a catalyst <b>✦ between matching ranks</b> and watch the mirror fold inward.</p><div class="example-reaction"><span>2</span><span>1</span><strong>✦</strong><span>1</span><span>2</span><i>→</i><span class="result">4</span></div><p>Make room. Gather relics. Follow the art for as long as your vessel holds.</p><button class="button primary" data-action="begin">Enter the laboratory <span>↗</span></button><button class="text-button" data-action="help">Read the principles first</button>`, 'Welcome to Athanor', 'welcome-modal');
  if(modal==='help') return shell(`<button class="close-modal" data-action="close" aria-label="Close help">×</button><span class="modal-kicker">A FEW PRINCIPLES</span><h2>The endless art.</h2><ol class="rules"><li><b>Prepare the circle.</b> Tap a gap or the space between two ingredients to place immediately. Arrow keys cycle gaps; Enter places.</li><li><b>Find the mirror.</b> A catalyst ✦ between equal ranks fuses them into the next rank. Matching pairs farther out continue the chain.</li><li><b>Read the reaction.</b> Matching pairs flow into the catalyst in order, then the vessel rearranges around the result. The next three pieces are shown below.</li><li><b>Keep breathing room.</b> Exactly at capacity is safe. A placement that finishes above capacity ends the run. Use your preparations before filling the vessel.</li><li><b>Use your instruments.</b> Extraction − lifts an ingredient to place again; it can instead become a catalyst. Consumables and charged relics intervene before placement.</li><li><b>Let the craft grow.</b> Reactions earn reward choices. Every relic you collect lasts for this run. Three vials hold single-use preparations.</li></ol><p class="save-note">Your vessel saves automatically in this browser. Archive unlocks survive a new run. No account or server required.</p><button class="button primary" data-action="close">Return to the vessel <span>↗</span></button>`, 'How to play');
  if(modal==='settings') return shell(`<button class="close-modal" data-action="close" aria-label="Close archive">×</button><span class="modal-kicker">THE LABORATORY ARCHIVE</span><h2>A continuing practice.</h2><p>This vessel is saved automatically on this device. Starting anew replaces it; your archive stays.</p><div class="archive-data"><span>Seed</span><b>${state.seed}</b><span>Best score</span><b>${format(meta.bestScore || meta.best?.score || 0)}</b><span>Highest discovery</span><b>${meta.highest || meta.highestRank || meta.best?.highest || state.highest}</b></div><button class="button secondary" data-action="close">Continue this vessel</button><button class="button secondary" data-action="confirm-new">Prepare a fresh vessel</button><p class="save-note">Athanor · an endless spatial alchemy puzzle<br>Soundless by design. Motion follows your device preferences.</p>`, 'Run and archive');
  if(modal==='new') return shell(`<span class="modal-kicker">A FRESH BEGINNING</span><h2>Rekindle the art?</h2><p>This replaces the current vessel and its relics. Your archive and unlocked starting options remain.</p>${starterButtons()}<button class="text-button" data-action="close">Keep this vessel</button>`, 'Start a new run');
  if(modal==='item') {const item=itemById(targeting?.itemId);return shell(`<span class="modal-kicker">SINGLE-USE PREPARATION</span><div class="welcome-sigil">${escapeHTML(item?.icon)}</div><h2>${escapeHTML(item?.name)}</h2><p>${escapeHTML(item?.description)}</p><button class="button primary" data-action="confirm-item">Use preparation <span>↗</span></button><button class="text-button" data-action="cancel-item">Keep it for later</button>`, 'Use preparation');}
  return '';
}
function render() {
  app.toggleAttribute('data-resolving', busy);
  app.classList.toggle('is-resolving', busy);
  app.setAttribute('aria-busy', String(busy));
  app.innerHTML=`${header()}<main><div class="page-heading"><div><span class="eyebrow">A PRACTICE IN TRANSFORMATION</span><h1>Keep the fire alive.</h1></div><p>No hurry. Only possibility.</p></div>${stats()}<div class="laboratory"><div class="workbench">${vessel()}${compactInventory()}${placementPanel()}<div class="status-message" aria-live="polite">${escapeHTML(notice || (state.turns?state.last?.message:'Welcome, alchemist. Tap between ingredients to begin.'))}</div></div><aside class="cabinet">${essence()}${inventory()}${relics()}</aside></div><footer><span>✧ &nbsp; FROM SIMPLE THINGS, SOMETHING EXTRAORDINARY.</span><button class="text-button" data-action="help">The principles ↗</button></footer></main>${overlay()}`;
  if (busy) app.querySelectorAll('button').forEach(button => { button.disabled = true; });
  const dialog=app.querySelector('.modal');
  if(dialog) dialog.focus({preventScroll:true});
}
function beginTarget(config) { targeting=config; targetId=null; gap=null; modal=null; render(); requestAnimationFrame(()=>app.querySelector('.vessel-section')?.scrollIntoView({block:'start',behavior:'instant'})); }
app.addEventListener('click', event=>{
  if (busy) return;
  const button=event.target.closest('[data-action]');if(!button || button.disabled)return;
  const action=button.dataset.action;
  if(action==='home'){event.preventDefault();modal='settings';render();}
  else if(action==='help'){modal='help';render();}
  else if(action==='settings'){modal='settings';render();}
  else if(action==='close'){modal=null;targeting=null;render();}
  else if(action==='begin'){modal=null;persist();render();}
  else if(action==='confirm-new'){modal='new';render();}
  else if(action==='new'){startRun(button.dataset.starter);}
  else if(action==='gap'){if(modal||targeting||state.pendingReward||state.over)return;gap=Number(button.dataset.index);commit(place(state,gap),{actionType:'place'});}
  else if(action==='vessel-place'){
    if(modal||targeting||state.pendingReward||state.over||state.incoming.kind==='extract')return;
    const rect=button.getBoundingClientRect(), x=event.clientX-rect.left-rect.width/2, y=event.clientY-rect.top-rect.height/2;
    const radius=Math.hypot(x,y)/rect.width;
    if(radius<.23||radius>.49)return;
    const n=state.ring.length;
    gap=n?((Math.round((Math.atan2(y,x)+Math.PI/2)/(2*Math.PI/n)+.5)%n)+n)%n:0;
    commit(place(state,gap),{actionType:'place'});
  }
  else if(action==='transmute'){commit(useRelic(state,'transmute'));}
  else if(action==='target'){
    const piece=state.ring.find(p=>p.id===button.dataset.id);if(!piece||piece.kind!=='ingredient')return;
    if(targeting||state.incoming.kind==='extract'){targetId=piece.id;render();}
    else {notice=`${pieceInfo(piece).name} · rank ${piece.rank}. Choose a + beside an ingredient to insert.`;render();}
  }
  else if(action==='cancel-target'){targeting=null;targetId=null;render();}
  else if(action==='confirm-target'){
    if(!targetId)return;
    if(targeting?.kind==='consumable')commit(useConsumable(state,targeting.slot,targetId));
    else commit(useRelic(state,targeting?.relicId||'extract',targetId));
  }
  else if(action==='consumable'){
    const slot=Number(button.dataset.index);const item=itemById(state.inventory[slot]);if(!item)return;
    if(item.target || ['solvent','twin'].includes(item.id))beginTarget({kind:'consumable',slot,name:item.name,description:item.description});
    else{targeting={kind:'consumable',slot,itemId:item.id};modal='item';render();}
  }
  else if(action==='confirm-item'){const slot=targeting?.slot;modal=null;commit(useConsumable(state,slot));}
  else if(action==='cancel-item'){modal=null;targeting=null;render();}
  else if(action==='relic'){
    const id=button.dataset.id;
    if(id==='tongs')beginTarget({kind:'relic',relicId:id,name:relicById(id).name,description:relicById(id).description});
    else commit(useRelic(state,id,button.dataset.arg?Number(button.dataset.arg):undefined));
  }
  else if(action==='reward'){
    const i=Number(button.dataset.index);const option=state.pendingReward.options[i];
    if(option.type==='consumable'&&state.inventory.every(Boolean)){replacement=i;render();}
    else commit(chooseReward(state,i));
  }
  else if(action==='replace'){commit(chooseReward(state,replacement,Number(button.dataset.index)));}
  else if(action==='back-rewards'){replacement=null;render();}
  else if(action==='decline'){commit(chooseReward(state,-1));}
});
document.addEventListener('keydown',event=>{
  if(busy)return;
  if(event.key==='Escape') {if(targeting){targeting=null;targetId=null;}if(modal)modal=null;render();return;}
  const dialog=app.querySelector('[role="dialog"]');
  if(dialog&&event.key==='Tab'){
    const focusables=[...dialog.querySelectorAll('button:not(:disabled),a[href]')];const first=focusables[0];const last=focusables.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;
  }
  if(modal||state.pendingReward||state.over||targeting||state.incoming.kind==='extract')return;
  if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const n=Math.max(1,state.ring.length);gap=((gap??(event.key==='ArrowRight'?-1:0))+(event.key==='ArrowRight'?1:-1)+n)%n;render();}
  else if(event.key==='Enter'&&gap!==null&&document.activeElement===document.body){event.preventDefault();commit(place(state,gap),{actionType:'place'});}
});
if (agentMode) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const snapshot = () => ({
    version: 1,
    phase: busy ? 'animating' : state.over ? 'over' : state.pendingReward ? 'reward' : state.incoming.kind === 'extract' ? 'extract' : 'place',
    busy, state: copy(state), meta: copy(meta), actions: busy ? [] : legalActions(state),
  });
  // An explicit isolated playtest mode: uses the same engine actions, commit and save path as the UI.
  window.athanor = Object.freeze({
    version: 1,
    snapshot,
    actions: () => busy ? [] : legalActions(state),
    whenIdle: () => motionPromise.then(() => snapshot()),
    preview(action) {
      const next = applyAction(state, action);
      return { accepted: next !== state, state: copy(next) };
    },
    act(action) {
      if (busy) return { accepted: false, reason: 'busy', ...snapshot() };
      const next = applyAction(state, action);
      if (next === state) return { accepted: false, ...snapshot() };
      modal = null;
      commit(next, { gap: action.type === 'place' ? action.gap : undefined, actionType: action.type });
      return { accepted: true, ...snapshot() };
    },
    reset({ seed = 42, starter = 'standard' } = {}) {
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32.');
      if (!['standard','mirror'].includes(starter) || (starter === 'mirror' && !mirrorUnlocked())) throw new Error('Starting vessel is not unlocked.');
      stopTransition();
      state = createGame(seed, starter, meta);
      modal = null; gap = null; targeting = null; targetId = null; replacement = null;
      persist(); render(); return snapshot();
    },
    loadRun(value) {
      if (!validateSave(value)) throw new Error('Invalid run snapshot.');
      stopTransition();
      state = copy(value); modal = null; gap = null; targeting = null; targetId = null; replacement = null;
      persist(); render(); return snapshot();
    },
  });
  persist();
}
render();
