# Jet contract

Every flyable jet is a `JetSpec` (`src/aircraft/types.ts`) registered in `ROSTER` (`src/aircraft/roster.ts`). Order in `ROSTER` is hangar order.

## JetSpec

| field | meaning |
|---|---|
| `id` | stable key; matches `jets.<id>` in the approved copy (`docs/copy/`) |
| `stats` | 1–10 each: `speed`, `handling`, `armour`, `weapons`. Shown as hangar bars; `armour` scales damage taken, `weapons` scales gun damage |
| `flight` | `FlightSpec`; derive with `flightFromStats(speed, handling)` and override fields only for a reason |
| `loadout` | optional weapon profile: `standard` (cannons + homing missile, the default), `volley`, `rail`, `flak` or `orb`. Profiles live in `LOADOUTS` in `src/game/weapons.ts` and pick the gun, the second weapon, its reload and how many targets it locks |
| `engine` | `pitch` (engine sound pitch multiplier, ~0.7–1.4), `roar` (loudness 0.5–1.5), `flame` (afterburner outer colour, linear RGB 0–1) |
| `build()` | returns a fresh `JetModel`; called once per use (hangar and flight each build their own) |

## JetModel

Units are metres. Nose points **−Z**, up is **+Y**, right wing is **+X**. Origin near the centre of mass; the model is not scaled at runtime.

| field | meaning |
|---|---|
| `root` | `THREE.Group` holding all meshes. Materials come from `jetMaterials()` (flat-shaded, night-fog patched). No lights inside the model |
| `nozzles` | exhaust exits: `pos` at the rear face of each nozzle, `r` its radius. Flames extend toward +Z from `pos` |
| `wingtips` | `[left, right]` tip positions; red/green navigation lights sit here |
| `guns` | muzzle positions; tracers start here |
| `cockpit` | pilot eye position for the cockpit camera |
| `length` | nose-to-tail length; sets chase-camera distance |
| `radius` | rough half-span; collision uses `radius * 0.6` |
| `animate(s)` | optional, called every frame with `JetAnimState` (`throttle` 0–1, `boost` 0–1, `speed` m/s, `pitch/roll/yaw` inputs −1..1). Moves control surfaces, swing wings, glows. Must not allocate per frame |

## Invariants

- Low-poly and faceted: under ~3k triangles per jet. Build from `src/aircraft/kit.ts` (`loft`, `loftRings`, `surface`, `tube`, `nozzle`, `rod`, `convex`, `boxAt`, `mirrorX`, `splitFaces`, `mergeGeometries`); merge static parts per material to keep draw calls under ~8. Each nozzle adds three flame meshes.
- Canopy uses the `glass` material; engine interiors and intake mouths use `dark`; nozzles use `metal`. `jetMaterials()` adds object-space panel lines, an optional second paint colour (`camo`) and a scene-wide rim light (`jetLook`). Self-lit parts use `glowMaterial()`; the alien shell uses `iridescentMaterial()`.
- The alien fighter's model is also the enemy fighter (`src/game/aliens.ts`), 15 at a time, so keep it cheap.
- Prototypes and the alien fighter are original designs. Real jets are recognisable silhouettes of the real aircraft.
- QA views: `?scene=jets&jet=<id|all>&view=az,el,dist&throttle=&boost=` and in-city `?scene=flight&jet=<id>&pos=x,y,z&hdg=deg&bank=deg&freeze`. Screenshot with `tools/shoot.mjs`.
