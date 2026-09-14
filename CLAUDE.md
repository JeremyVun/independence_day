# night-flight

Browser night-city flight game (Three.js + TypeScript + Vite). Overview: `docs/project.md`. Look: `docs/styles.md`.

## Commands

- `npm run dev` (serve), `npm run typecheck`, `npm run build`.
- Visual QA: `node tools/shoot.mjs <out-prefix> "<query>" ...` against a running dev server (`BASE=http://127.0.0.1:<port>/`). Uses local Chrome with GPU; asserts viewport; writes `<prefix>-console.log` on errors.
- Play-through: `QUERY="<query>" node tools/play.mjs <out-prefix> '<json steps>'` drives real key presses and screenshots; `window.__game` (`flight`, `world`, `renderer`) and `window.__stats` (draw calls, triangles, CPU ms) exist when `shot` is set.
- Deploy: `tools/deploy.sh` builds and uploads `dist/` as static assets of the Cloudflare Worker `night-flight` (`wrangler.jsonc`). Needs `CLOUDFLARE_API_TOKEN` (Workers Scripts Edit), a clean tree and the `main` branch, because every deploy goes to production.

## Query params

- `scene=title|hangar|flight|jets|city` (default title), `jet=<id>`, `t=<fixed seconds>`, `shot` (set by the tools), `ratio=<pixel ratio>` (fixes the render scale and disables the automatic step-down in `src/core/quality.ts`; `window.__stats.ratio` reports the live value).
- flight: `pos=x,y,z`, `hdg=deg`, `bank=deg`, `freeze`, `cam=chase|cockpit|flyby`, `aggro`, `alienNear`, `canopy` (cockpit frame, a feature flag that is off by default).
- jets: `jet=<id|all>`, `view=az,el,dist`, `throttle`, `boost`. city: `cam=x,y,z,yawDeg,pitchDeg`.

## Where things are

- Contracts: `docs/contracts/` (jets). Copy drafts and approvals: `docs/copy/`.
- World: `src/world/`. Jets: `src/aircraft/`. Gameplay: `src/game/`. Modes: `src/scenes/`. Shared shader code and fog: `src/core/atmosphere.ts`.
