# Working on Athanor

- Never use Astra. The primary agent orchestrates implementation and review.
- Read `docs/prototype-spec.md` for settled game rules. Preserve endless survival, the persistent vessel, overflow-only death, run-long relics and three consumable slots.
- For playtesting, start with `docs/agent-playtesting.md`. Use the seeded engine, CLI traces or isolated browser API rather than editing a player's save.
- `npm test` checks engine and agent action invariants. `npm run build` creates GitHub Pages assets in `dist/`. With `npm start` running, `npm run test:browser` exercises the UI.
- The deployed game is dependency-free browser ES modules. Keep asset URLs relative for the repository subpath.
- Keep previews pure and use the same engine rules for preview, UI, agent actions and headless playtests. Never implement a second set of gameplay rules in a test driver.
