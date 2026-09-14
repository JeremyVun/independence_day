import * as THREE from 'three';
import { at, convex, flip, hoop, loft, loftRings, mergeGeometries, mirrorX, PROFILES, rod, splitFaces, surface, tube, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

type P = [number, number, number];

// Span stations of the flying wing: [span, leading edge z, trailing edge z, top, bottom]. The trailing edge zigzags into a W.
const SPAN: [number, number, number, number, number][] = [
  [0.0, -6.0, 4.6, 1.05, -0.7],
  [1.6, -4.95, 5.15, 0.92, -0.6],
  [3.4, -3.75, 5.9, 0.7, -0.46],
  [5.8, -2.15, 6.6, 0.44, -0.3],
  [8.5, -0.4, 4.6, 0.24, -0.16],
  [11.0, 1.0, 2.9, 0.08, -0.06],
];
const ENGINE_X = [1.75, 3.7];
const POD_X = 4.7;

const teAt = (x: number) => {
  for (let i = 0; i < SPAN.length - 1; i++) {
    const [s0, , t0] = SPAN[i];
    const [s1, , t1] = SPAN[i + 1];
    if (x <= s1) return t0 + ((x - s0) / (s1 - s0)) * (t1 - t0);
  }
  return SPAN[SPAN.length - 1][2];
};

// Chordwise aerofoil around the span axis. Built with span along local z, then turned so span runs along +x.
function wingRing([s, le, te, top, bot]: (typeof SPAN)[number]): Ring {
  const c = te - le;
  const pts: [number, number][] = [
    [-le, 0],
    [-(le + c * 0.22), top],
    [-(le + c * 0.62), top * 0.7],
    [-te, 0.02],
    [-(le + c * 0.62), bot * 0.7],
    [-(le + c * 0.22), bot],
  ];
  return { z: s, pts };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x2b2d33, accent: 0x8e1d18, canopy: 'gold', metalness: 0.4, roughness: 0.5 });
  const root = new THREE.Group();

  const half = loftRings(SPAN.map(wingRing), { start: false, end: true });
  half.rotateY(Math.PI / 2);
  const wing = mergeGeometries([half, mirrorX(half)]);
  const leZ = (x: number) => -6.0 + Math.abs(x) * (7.0 / 11.0);
  const [redEdges, wingRest] = splitFaces(wing, (c, n) => Math.abs(c.x) > 6.4 && c.z < leZ(c.x) + 1.1 && n.y > -0.2);

  const pod = loftRings(
    [
      { z: -7.6, pts: [[0, 0.3], [0.3, 0.2], [0.35, -0.1], [0, -0.2], [-0.35, -0.1], [-0.3, 0.2]] },
      { z: -6.6, pts: [[0, 0.95], [0.8, 0.7], [1.0, 0.0], [0, -0.55], [-1.0, 0.0], [-0.8, 0.7]] },
      { z: -4.6, pts: [[0, 1.35], [1.05, 1.0], [1.3, 0.1], [0, -0.7], [-1.3, 0.1], [-1.05, 1.0]] },
      { z: -1.0, pts: [[0, 1.45], [1.15, 1.1], [1.4, 0.1], [0, -0.75], [-1.4, 0.1], [-1.15, 1.1]] },
      { z: 2.4, pts: [[0, 1.2], [1.0, 0.9], [1.3, 0.1], [0, -0.7], [-1.3, 0.1], [-1.0, 0.9]] },
      { z: 4.4, pts: [[0, 0.7], [0.6, 0.55], [0.8, 0.1], [0, -0.45], [-0.8, 0.1], [-0.6, 0.55]] },
    ],
    { start: true, end: true },
  );

  const hump = (x: number): THREE.BufferGeometry =>
    convex([
      [x - 0.62, 0.0, -2.6],
      [x + 0.62, 0.0, -2.6],
      [x - 0.55, 0.62, -2.4],
      [x + 0.55, 0.62, -2.4],
      [x - 0.62, 0.0, 3.0],
      [x + 0.62, 0.0, 3.0],
      [x - 0.5, 0.52, 2.0],
      [x + 0.5, 0.52, 2.0],
      [x - 0.55, 0.3, teAt(x) - 0.2],
      [x + 0.55, 0.3, teAt(x) - 0.2],
      [x - 0.55, 0.05, teAt(x) - 0.2],
      [x + 0.55, 0.05, teAt(x) - 0.2],
    ]);
  const humps = mergeGeometries(ENGINE_X.flatMap((x) => [hump(x), mirrorX(hump(x))]));
  const mouths = mergeGeometries(
    ENGINE_X.map((x) =>
      convex([
        [x - 0.48, 0.05, -2.62],
        [x + 0.48, 0.05, -2.62],
        [x - 0.42, 0.52, -2.44],
        [x + 0.42, 0.52, -2.44],
        [x - 0.48, 0.05, -2.5],
        [x + 0.48, 0.05, -2.5],
        [x - 0.42, 0.52, -2.34],
        [x + 0.42, 0.52, -2.34],
      ]),
    ),
  );

  const podBody = at(tube(0.44, 5.6, 10, 0.44), POD_X, -0.95, -0.4);
  const podCaps = mergeGeometries([
    at(new THREE.CircleGeometry(0.44, 10), POD_X, -0.95, 2.4),
    rod([POD_X, -0.95, 2.4], [POD_X, -0.95, 3.3], 0.44, 10, 0.08),
  ]);
  const cowl = at(tube(0.5, 0.5, 10, 0.46), POD_X, -0.95, -3.2);
  const cowlFace = at(flip(new THREE.CircleGeometry(0.46, 10)), POD_X, -0.95, -3.4);
  const pylon = convex([
    [POD_X - 0.08, -0.2, -2.0],
    [POD_X + 0.08, -0.2, -2.0],
    [POD_X - 0.08, -0.2, 1.8],
    [POD_X + 0.08, -0.2, 1.8],
    [POD_X - 0.08, -0.7, -1.6],
    [POD_X + 0.08, -0.7, -1.6],
    [POD_X - 0.08, -0.7, 1.6],
    [POD_X + 0.08, -0.7, 1.6],
  ]);
  const winglet = surface(
    [
      { s: 0, le: 1.0, te: 2.9, t: 0.1 },
      { s: 1.0, le: 1.85, te: 3.05, t: 0.04 },
    ],
    { root: [10.95, 0.0, 0], cant: -1.2 },
  );

  const hullGeo = mergeGeometries([wingRest, pod, humps, podBody, mirrorX(podBody), podCaps, mirrorX(podCaps), pylon, mirrorX(pylon)]);
  root.add(new THREE.Mesh(hullGeo, m.body));
  root.add(new THREE.Mesh(mergeGeometries([redEdges, cowl, mirrorX(cowl), winglet, mirrorX(winglet)]), m.accent));

  const canopy = loft(
    [
      { z: -6.3, w: 0.14, h: 0.05, y: 0.85 },
      { z: -5.5, w: 0.5, h: 0.42, y: 0.95 },
      { z: -4.4, w: 0.6, h: 0.56, y: 1.1 },
      { z: -3.2, w: 0.55, h: 0.48, y: 1.22 },
      { z: -2.2, w: 0.2, h: 0.12, y: 1.3 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const noz = (x: number) => {
    const z = teAt(x) + 0.15;
    const shell = tube(0.46, 0.9, 10, 0.42);
    shell.scale(1.25, 0.62, 1);
    const inner = flip(tube(0.43, 0.88, 10, 0.39));
    inner.scale(1.25, 0.62, 1);
    return { metal: at(shell, x, 0.2, z - 0.45), dark: at(inner, x, 0.2, z - 0.45), z };
  };
  const nozzles = ENGINE_X.flatMap((x) => [noz(x), noz(-x)]);
  root.add(new THREE.Mesh(mergeGeometries(nozzles.map((n) => n.metal)), m.metal));
  const bow = hoop(PROFILES.bubble, { z: -5.4, w: 0.52, h: 0.45, y: 0.95 }, 0.035);
  root.add(new THREE.Mesh(mergeGeometries([...nozzles.map((n) => n.dark), mouths, mirrorX(mouths), cowlFace, mirrorX(cowlFace), bow]), m.dark));

  const barrels: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const spin = new THREE.Group();
    spin.position.set(side * POD_X, -0.95, -3.4);
    const g = mergeGeometries([
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        const p: P = [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0];
        return rod(p, [p[0], p[1], -1.7], 0.055, 4);
      }),
      rod([0, 0, 0.1], [0, 0, -1.5], 0.12, 6),
      at(tube(0.3, 0.12, 8, 0.3), 0, 0, -1.2),
    ]);
    spin.add(new THREE.Mesh(g, m.metal));
    root.add(spin);
    barrels.push(spin);
  }

  let spinAngle = 0;
  let lastTime = 0;
  return {
    root,
    nozzles: ENGINE_X.flatMap((x) => [
      { pos: new THREE.Vector3(-x, 0.2, teAt(x) + 0.15), r: 0.4 },
      { pos: new THREE.Vector3(x, 0.2, teAt(x) + 0.15), r: 0.4 },
    ]),
    wingtips: [new THREE.Vector3(-11.0, 0.0, 2.0), new THREE.Vector3(11.0, 0.0, 2.0)],
    guns: [new THREE.Vector3(-POD_X, -0.95, -5.1), new THREE.Vector3(POD_X, -0.95, -5.1)],
    cockpit: new THREE.Vector3(0, 1.62, -4.5),
    length: 14.2,
    radius: 11.0,
    animate(s) {
      spinAngle += Math.min(Math.max(s.time - lastTime, 0), 0.1) * (1.5 + 5 * s.throttle + 6 * s.boost);
      lastTime = s.time;
      barrels[0].rotation.z = spinAngle;
      barrels[1].rotation.z = -spinAngle;
    },
  };
}

export const protoC: JetSpec = {
  id: 'protoC',
  loadout: 'flak',
  stats: { speed: 5, handling: 5, armour: 10, weapons: 10 },
  flight: flightFromStats(5, 5),
  engine: { pitch: 0.8, roar: 1.35, flame: [1.0, 0.3, 0.1] },
  build,
};
