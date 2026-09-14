# Night flight

A personal browser game that recreates the feel of the 1997 PlayStation game Jeremy loved as a kid: pick a cool-looking jet in a dark hangar, then fly low between lit skyscrapers in a city at night while a huge alien ship hangs overhead. Atmosphere comes first. Alien fighters patrol, and you can shoot them if you want, but there are no missions, timers or game over. Crashing or being shot down respawns you in the air.

Everything is original: the city, the alien ship, the alien fighter, the prototype jets and the name. Nothing is taken from the film or the original game. Real jets appear as low-poly silhouettes of the real aircraft.

## Decisions (2026-09-14)

- Look: "remembered 90s". Chunky low-poly shapes with modern lighting: thousands of lit windows, bloom, haze, street lamps, searchlights. See `styles.md`.
- Aliens: scenery plus optional fights. Fighters ignore you until you shoot at them or fly very close.
- Jets: seven real jets (F-16, F/A-18, F-14, MiG-29, F-22, F-117, SR-71), three original prototypes and a captured alien fighter. All unlocked.
- Platform: browser, Three.js + TypeScript + Vite. Keyboard and game controller.
- Controls: rolling only rolls; it never turns the jet by itself. You turn by rolling and pulling back, or with the rudder. A gentle auto-level acts only when both roll and pitch are released.
- Weather: periodic rain and drifting low cloud banks, cycling on their own. The first rain arrives within about a minute and a half; `?weather=rain|clear` forces one for testing.
- Handling: against the first build, pitch rate is 61.6%, roll rate 80.5% and yaw rate 70%, with about half a second of angular inertia, so jets feel heavy.
- Weapons: real jets carry cannons and a homing missile. The X-81 fires a four-missile volley at separate targets, the X-82 a charged rail gun that pierces every fighter in line, the X-83 twin rotary cannons and airburst shells, and the captured alien fighter energy guns and a homing energy ball with a large blast.
- Player-facing text is drafted by Astra (`docs/copy/`); Jeremy approves it. `copy-1.json` is Astra's draft; `copy-2.json` added Jeremy's picks (2026-09-14): title "Night flight", prototypes X-81 / X-82 / X-83, "Captured alien fighter". `copy-3.json` added Astra's weapon names, hangar rows and HUD lines. `copy-4.json` is what ships: copy-3 plus Astra's radio lines (pending Jeremy's verdict). Other strings ship as drafted until Jeremy flags one.
- Radio: overheard radio traffic from "Control" and "Ground" appears as subtitles with a squelch, now and then and in reply to kills, hits, respawns, storms, blackouts and flying under the ship. No voice acting.
- Cockpit view: no canopy frame. The frame exists behind a local feature flag (`?canopy=1` or localStorage `feature.canopy` = `1`, `src/core/features.ts`); Jeremy prefers the clean view.
- Sound: outside sounds (rain, thunder, sirens, guns, distant blasts, fires) are muffled inside the hangar. A quiet music bed plays in flight and swells near the ship.

## Shape

- `src/world/`: procedural city (layout, buildings with shader-drawn windows, ground, lamps, traffic, sky, collision).
- `src/aircraft/`: jet kit, roster and per-jet builders (`docs/contracts/jets.md`).
- `src/game/`: arcade flight model, camera rig, player, particles.
- `src/scenes/`: modes (flight, hangar, title, QA viewers).
