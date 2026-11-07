# Athanor

A circular alchemy survival puzzle for touch and desktop. Inspired by the spatial fusion puzzle in Atomas, with an original alchemy theme, run-long relic combinations, consumables, and unlockable starting options.

Play at **https://laurln.github.io/Atomas_DX/** after deployment.

## Play

Tap a gap or the space between two ingredients to place immediately. A catalyst between equal ranks fuses them. Mirrored pairs farther out continue the chain, making a stronger ingredient and opening space. Watch matching pairs flow inward, then the vessel rearrange around the result. Unmatched catalysts stay until their neighbors match.

The same vessel survives throughout a run. Overcrowding is the only loss condition. Reactions earn Essence toward recurring three-way rewards. Keep every acquired relic until the run ends. Store up to three single-use consumables and use them before committing a placement. Extraction tools let you pick up an ingredient to reposition or convert into a catalyst.

Runs save automatically in this browser, including inventories and pending rewards. Clearing browser storage removes local progress. Discover rank 7 to unlock Phoenix Seal for future runs; survive 60 placements to unlock the Mirror starting vessel. Unlocks persist after death; relic power does not.

## Develop

Node.js 24 recommended. The deployed game has no runtime dependencies, external fonts, accounts, or backend.

```sh
npm ci
npm test
npm run build
npm start
```

Open the printed local URL. `npm run build` packages only the game into `dist/`, using relative asset paths compatible with a GitHub Pages project subdirectory.

With the local server running, `npm run test:browser` runs the interaction checks. It uses installed Microsoft Edge on Windows; on other systems install Playwright Chromium with `npx playwright install chromium`. Set `BASE_URL` to test a deployed copy or the local `/dist/` path.

`npm run test:motion` checks real animations, input locking, reload/cancellation safety, reduced motion, direct taps and mobile layouts. Saves commit before animation; animation speed never changes the game rules.

## Deploy

The GitHub Actions workflow tests and builds `main`, then deploys the `dist/` artifact through GitHub Pages. Configure repository **Settings → Pages → Source: GitHub Actions**. The public site is scoped to this repository and does not replace an existing account homepage.

## Design and checks

See [prototype specification](docs/prototype-spec.md), [research brief](docs/research-and-design.md), and [glossary](GLOSSARY.md). Numeric balance is provisional; this is a playable prototype.

The engine is pure and seeded. Tests cover circular reactions, previews, overflow, relics, consumables, reward persistence and save/resume. Browser checks exercise narrow touch and desktop layouts, input flows and reload persistence.

## Agent playtesting

See [agent playtesting](docs/agent-playtesting.md) for the seeded CLI, replayable action reports, isolated `?agent=1&seed=42` browser API, and stable UI controls. Example: `npm run playtest -- --seed 42 --turns 500 --out test-results/run.json`.
