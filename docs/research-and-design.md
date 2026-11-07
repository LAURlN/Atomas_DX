# Alchemy ring roguelike — research and design brief

Research date: 2026-11-07. Working project name only; no public title chosen.

## Settled direction

The user selected:

- Pure spatial puzzle survival, with no bosses for the current scope and no enemy health or merge-to-deal-damage layer.
- The same vessel persists for the entire run. No chapter or encounter resets.
- Long runs must remain possible; no forced run ending or duration cap.
- Death only occurs when the vessel becomes too full. No quotas, placement-budget failures or countdown deaths.
- Collect both consumables and permanent upgrades during play. Upgrades last until the run ends; death starts a fresh build.
- Between runs, unlock new relics and starting options rather than permanent numerical power.
- Reactions earn progress toward recurring reward drafts throughout survival, including after new ingredient discoveries slow down.
- Keep all acquired relics for the run; there is no equipped-relic slot limit.
- Three consumable slots, one use per slot, with replace-or-decline when full.
- Consumables are used before committing a placement. No manual rescue window after a fatal settled result; preview warns before commitment.
- Alchemy and magical ingredients as the theme.
- A mobile-first web app hosted on GitHub Pages, also playable on desktop.
- The primary agent orchestrates subagents. Never use Astra.

This document retains the research and design exploration. The user subsequently authorized implementation and deployment to GitHub Pages; see the prototype specification and repository README for the implemented scope. Ideas outside that scope remain proposals.

## Research: what Atomas actually offers

Atomas is an endless circular placement puzzle about fusing elements. The original developer listing describes equal elements combining through Plus particles, symmetric arrangements enabling chain reactions, and overcrowding ending the game. Minus particles let players extract/reposition a particle or sacrifice it for a Plus. Discovering elements unlocks lucky charms. The listing advertises four modes, 124 atoms and 12 charms.

Sources: [official developer page](https://sirnic.com/atomas/), [official Google Play listing](https://play.google.com/store/apps/details?id=com.sirnic.atomas&hl=en).

### The tactical structure

The ring is an ordered circular sequence: insertion changes neighboring relationships, rather than occupying a fixed rectangular board cell. A catalyst between equal neighbors initiates a reaction. Further matching pairs can be consumed outward, even when their values differ from the growing central product.

For example, community documentation gives `9, 2, +, 2, 9` becoming `9, 3, 9`, then `11`. The satisfying pattern is a prepared mirror collapsing inward into one ingredient, opening space and advancing progression together.

Community sources disagree on one edge case: whether an outer matched pair equal to the current product gives +1 or +2. They also report a capacity of 18, but the precise overflow timing has not been verified in the live game. Do not represent these details as a tested reproduction of Atomas.

Sources: [community Atommasses rules](https://atomas.fandom.com/wiki/Atommasses), [community additive particle rules](https://atomas.fandom.com/wiki/Additive_Atoms).

### Original tools, charms and modes

The official App Store history documents a copying Neutrino, a Black Plus that can merge unlike neighbors, Antimatter consolidation, Geneva mode's Luxon, Zen mode and an undo feature. The original already has strategically meaningful modifiers: examples in the history include periodic random destruction, a clear-board score reward, and a one-use rearrangement. Names and effects changed across releases; community descriptions are not consistently current.

Source: [official App Store description and version history](https://apps.apple.com/us/app/atomas/id953603155).

### Critical adjacent game: Atomas Neo

The developer already offers Atomas Neo. Its official site explicitly advertises choosing one of three effects that persist for the rest of a run, Swapper and Amplifier operators, up to three equipped tools, and molecular score multipliers.

Consequently, “Atomas with upgrades” overlaps the official successor. Our chosen direction is an alchemical survival puzzle with a persistent vessel, collectible consumables and interacting permanent upgrades. Differentiation should come from the depth of ingredient manipulation and build interactions. Encounters, branching routes and bosses were considered earlier and are outside the current scope. The complete Neo game has not been audited or played here; no claim of unique mechanics is implied.

Source: [official Atomas Neo page](https://sirnic.com/atomasneo/).

## Design interpretation: what to preserve

1. Space is the survival resource. A large reaction advances ingredient progression and buys room.
2. Preparation is visible. Players should recognize the mirror they constructed as it resolves.
3. Placement matters more than passive stat accumulation. A relic should often change where or when the player inserts an ingredient.
4. Rescue tools provide agency without making arrangement irrelevant.
5. Randomness should create decisions players can anticipate. Show upcoming ingredients and test a bounded catalyst drought.
6. A reaction preview must explain the actual outcome after relics and consumables apply.

## Proposed alchemy interpretation

The ring is a transmutation vessel. Numeric atoms become ranked magical ingredients; Plus becomes a Catalyst and Minus becomes extraction. Essence is a candidate reward-progress resource, not a survival quota. These are provisional theme mappings. Ingredient names, visuals and exact progression are open.

Keep the puzzle abstract enough to read quickly on a phone: a prominent rank, a distinct ingredient symbol, and color as supporting information. Magical flavor should not require memorizing a recipe encyclopedia to identify equal pieces.

### Suggested baseline rules to test

- Inserting a Catalyst between equal ranked ingredients consumes the pair into rank +1.
- For an additional outer matched pair of rank `a` around product `c`, use `max(c + 1, a + 2)` as an explicit candidate rule. This intentionally settles the ambiguous equality case for our prototype, subject to approval and playtesting.
- Reactions continue around the ring until the next outer pair fails to match. A physical ingredient can be consumed only once in a reaction.
- Resolve reactions and equipped automatic rescue effects before evaluating overflow. Consumable use happens before committing placement, never in a post-overflow manual rescue window. Exact capacity is prototype tuning, not a verified Atomas rule.
- Show the next three incoming pieces. Random generation and drought protection need explicit tuning before implementation.
- Use no real-time timer, placement budget or mandatory score target. Vessel overflow is the only death condition.

## Survival structure

The run continues as long as the player can keep the same vessel from overflowing. Short sessions and long runs use the same rules. Save/resume must preserve the vessel, queue, inventory, upgrades, random generator and effect counters so a long run can span several sessions.

There are no bosses, chapters, board resets, mandatory quotas, health meters or turn-budget failures in the current scope. Score, highest ingredient rank and placements survived can track accomplishments without ending a run.

Proposed loop: place an ingredient, resolve reactions, collect reward progress, choose or collect a reward when earned, then continue with the same vessel. Reward screens do not change the vessel or reset any charges.

Settled reward model: reactions earn progress toward recurring reward drafts. Proposed pacing: offer a choice of permanent upgrades at major milestones and consumables more frequently. New highest ranks could give bonus rewards, but are not the required reward source; long runs keep earning rewards after easy discoveries are exhausted. Exact progress formula, reward mix and threshold scaling remain tuning proposals.

Use reaction progress without a mandatory placement gate. Earlier independent feedback proposed a placement-plus-fusion gate; that alternative is not selected. A candidate progress formula is one point per consumed matching pair with a bonus for longer chains. Values and thresholds need playtesting; menus, idle time and non-reactive manipulations grant no reaction progress.

Keep all acquired relics for the run, with no equipped loadout limit. Duplicate stacking rules remain prototype tuning; initial recommendation is one copy of each relic. Once all available relics are owned, recurring rewards continue as consumable choices instead of ending progression. Avoid uncapped capacity growth, endlessly increasing catalyst frequency or automatic removal that makes overflow impossible.

Permanent upgrades change the ongoing rules and support a build for the current run. Consumables are collected, stored and spent for a specific intervention. Both reset when the run ends. Between-run progression unlocks new relics and starting options rather than numerical power; these unlocks must persist separately from the active run save.

### Overflow proposal

Only the final settled vessel state can cause death. Resolve a committed placement, its reactions and any already-equipped automatic rescue before checking capacity. The UI must clearly warn about a predicted fatal placement. Consumables can be used before committing; there is no post-overflow manual rescue window. A warning does not forbid knowingly committing a fatal placement.

Candidate boundary: capacity is the maximum stable piece count; a settled count above capacity ends the run. This is our proposed rule, not a verified claim about Atomas. For the first prototype, suppress a capacity-reducing relic offer if accepting it would immediately put the current vessel above its new capacity. Always display the resulting capacity before acceptance. Safe acquisition does not reset or clear the vessel.

### Consumable candidates

- **Solvent:** remove one chosen ordinary ingredient; gives no fusion or extraction rewards.
- **Twin Draught:** replace the next ordinary incoming ingredient with a copy of a chosen vessel ingredient's rank. The source stays in place; the resulting draw is visible.
- **Catalyst Ampoule:** convert the current ordinary incoming ingredient into a Catalyst, giving one chance to trigger a prepared reaction.

Settled inventory: three slots, each holding one use. Duplicate consumables occupy separate slots. Choose to replace an item or decline a pickup when full. Inventory overflow never kills the player.

## Proposed relic families

All names, values and limits below are drafts. Essence is proposed reward progress, not enemy damage or a survival quota. A placement is one committed incoming-piece action. A reaction consumes one or more successive matching pairs. Explicit extraction, fusion and rescue destruction are separate events. Charges use continuous progress, with no encounter resets.

### The Mirror Adept — prepare long symmetric reactions

- **Prismatic Lens:** store one charge to adjust the incoming ranked ingredient by +1 or −1 before insertion; minimum rank 1. Recharge after consuming six matched pairs through reactions after its last use. No charge overflow.
- **Twinned Phial:** store one charge to record an incoming ingredient's rank and replace the next two ordinary ingredient draws with that rank. Operators retain their queue positions. Recharge after 20 committed placements; overlapping recordings are prohibited.
- **Resonant Bell:** after a reaction consuming at least three pairs, convert the next ordinary ingredient draw into a Catalyst. Requires six ordinary ingredient placements between activations, and can queue at most one conversion.
- **Glass Halo:** capacity −2; reactions consuming at least three pairs generate double their base Essence. Short reactions receive no bonus.

Payoff: assemble a mirror, trigger a long collapse, earn the next catalyst. Weakness: limited capacity and commitment to preparation.

### The Grave Distiller — turn obstruction into useful material

- **Silver Tongs:** store one charge to extract a chosen ranked ingredient before placement. Extraction gives no fusion Essence and does not advance the placement counter. Recharge by consuming eight matched pairs after its last use.
- **Echo Urn:** after explicit extraction, optionally replace the next ordinary draw with the extracted rank. At most one pending replacement; it grants no additional draw or action.
- **Ashen Athanor:** every third explicit extraction converts the next ordinary draw into a Catalyst. Can queue at most one conversion.
- **Lead Coffin:** store one charge to mark an ingredient. After three further placements, remove it if it still exists. Fusing it first expires the mark. This removal gives no extraction triggers or Essence. Recharge after 20 committed placements.

Payoff: remove a blocker, reintroduce its rank where it belongs, turn cleanup into a catalyst. Weakness: slow recharge and sacrificing useful material.

### The Forbidden Alchemist — profit from a nearly full vessel

- **Blood Crucible:** a reaction beginning within two pieces of capacity gains +1 Essence per consumed pair. Sample occupancy after insertion and before the reaction begins.
- **Iron Binding:** capacity −3; reactions consuming at least two pairs gain +3 Essence.
- **Suspended Phial:** hold one ordinary ingredient outside the vessel. Before a placement, optionally swap it with the incoming ordinary ingredient. Operators cannot be held; swapping grants no extra draw or placement. Initial storage behavior must be specified before implementation.
- **Phoenix Seal:** once per run, if overflow would otherwise end the run after reactions resolve, destroy the highest-ranked ordinary ingredient and recheck capacity. Ties use a stable visible clockwise order. This gives no Essence or extraction triggers. If still over capacity, the run ends. It does not recharge and is not offered a second time, even after use. This is a proposed automatic relic effect, not manual consumable rescue.

Payoff: deliberately approach capacity for better reactions, with one costly rescue. Weakness: missing a reaction can consume both safety and the best ingredient.

### Synergy boundaries

Relics may create strong, surprising combinations, but effects must terminate and be explainable.

- A generated Catalyst replaces a future draw; it does not grant another free action.
- Relic counters persist continuously across rewards, menus and reloads. Only a new run starts a fresh set.
- Placement-based effects only count committed vessel placements. Opening menus, swapping a held piece or using consumables cannot advance them.
- Free removal must not reliably outpace incoming pieces; test combined extraction, catalyst generation and reward income across long seeded runs. Preserve strong builds without making the puzzle play itself.
- Snapshot reaction starting conditions and settle rewards after the reaction completes.
- Only deliberate extraction activates extraction relics. Fusion, delayed removal and overflow rescue do not.
- Specify conflicts between future-draw replacements before implementation. The UI must show the actual modified queue and allow a player to decline optional replacements.
- Predict the complete modified result before committing placement; show each effect during resolution and permit faster animation afterward.

## Proposed first playable slice

One endless survival mode with a persistent vessel, six to eight relics spanning at least two interacting families, three collectible consumables, and recurring reward choices. Include ordinary ingredients, catalysts, extraction, upcoming-piece preview, reaction prediction, deterministic seeds and local save/resume. No bosses or encounter scaffolding.

Build the reaction engine separately from presentation so we can verify circular wraparound, chain termination, overflow timing, relic ordering and save/resume behavior. Expand content after relic choices change actual placement decisions and long-run progression remains interesting.

### Mobile and desktop requirements

- Static deployable assets compatible with a GitHub Pages project subpath; no required server.
- Touch-first placement preview and deliberate confirmation, with equivalent mouse controls.
- Fit the vessel, incoming piece, forecast, capacity and consumable access on a small portrait screen. Relic details and reward progress can expand on tap.
- Readable symbols/ranks and large touch targets; do not rely on color or hover.
- Save after committed actions and resume an interrupted mobile session. Explain that browser storage is local to that browser/device.
- Test desktop width, narrow mobile width, input cancellation, page reload and reduced-motion behavior.
- Offline installability/PWA support is a later choice, not yet a requirement.

## Prototype handoff

The major design choices are settled. See [prototype specification](./prototype-spec.md) for the first-playable scope, now authorized for implementation and GitHub Pages deployment. Numeric balance, individual relic effects and presentation details remain adjustable through playtesting.

## Research limits

This brief combines public official descriptions, version history, community rule documentation and three independent subagent explorations. It is not a hands-on playtest. Exact spawn rates, scoring, equality cases and version-specific behaviors remain unverified. Proposed content is original design exploration, not a claim of tested balance.
