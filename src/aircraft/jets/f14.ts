import * as THREE from 'three';
import { convex, hoop, innerWall, loft, loftRings, mergeGeometries, missile, mirrorX, nozzle, PROFILES, surface, symRing, warp, type Profile, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

const SWEEP_MIN = THREE.MathUtils.degToRad(20);
const SWEEP_MAX = THREE.MathUtils.degToRad(68);

function section(z: number, yT: number, w: number, yc: number, yB: number, wl: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.7, yc + (yT - yc) * 0.82],
      [w, yc + (yT - yc) * 0.3],
      [w * 1.04, yc],
      [wl, yc - (yc - yB) * 0.5],
      [wl * 0.75, yB + (yc - yB) * 0.08],
      [0, yB],
    ]),
  };
}

// Intake duct that morphs from the big rectangular mouth (t = 0) to the round engine nacelle (t = 1).
function duct(z: number, cx: number, cy: number, hw: number, hh: number, t: number): Ring {
  const rect: Profile = [
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
    [1, 0],
  ];
  return {
    z,
    pts: rect.map(([x, y], k) => {
      const a = Math.PI / 4 + (k * Math.PI) / 4;
      return [cx + THREE.MathUtils.lerp(x * hw, Math.cos(a) * hw, t), cy + THREE.MathUtils.lerp(y * hh, Math.sin(a) * hh, t)] as [number, number];
    }),
  };
}

// Flat centre body ("pancake") spanning the gap between the widely spaced nacelles.
function deck(z: number, hw: number, yT: number, yB: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [hw * 0.72, yT - 0.02],
      [hw, yT - (yT - yB) * 0.45],
      [hw * 0.9, yB],
      [0, yB - 0.02],
    ]),
  };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x767b82, canopy: 'smoke' });
  const root = new THREE.Group();

  const forward = loftRings([
    section(-9.9, -0.02, 0.02, -0.04, -0.06, 0.02),
    section(-9.2, 0.24, 0.34, -0.04, -0.36, 0.32),
    section(-8.2, 0.46, 0.56, 0.0, -0.56, 0.54),
    section(-7.2, 0.58, 0.66, 0.05, -0.66, 0.62),
    section(-5.8, 0.66, 0.68, 0.08, -0.7, 0.66),
    section(-4.4, 0.74, 0.7, 0.1, -0.72, 0.68),
    section(-3.0, 0.78, 0.72, 0.12, -0.7, 0.7),
    section(-1.5, 0.78, 0.74, 0.14, -0.62, 0.7),
    section(0.5, 0.72, 0.74, 0.14, -0.45, 0.66),
    section(2.0, 0.62, 0.7, 0.14, -0.3, 0.6),
  ]);
  const centre = loftRings([
    deck(-3.6, 0.8, 0.55, 0.0),
    deck(-1.2, 1.9, 0.56, -0.12),
    deck(2.0, 2.05, 0.52, -0.16),
    deck(5.4, 1.98, 0.44, -0.12),
    deck(7.4, 1.05, 0.3, 0.02),
    deck(9.3, 0.7, 0.2, 0.1),
  ]);
  const nacelle = warp(
    loftRings(
      [
        duct(-4.0, 1.44, -0.34, 0.58, 0.64, 0),
        duct(-2.6, 1.46, -0.34, 0.6, 0.64, 0.1),
        duct(0.0, 1.5, -0.32, 0.64, 0.62, 0.4),
        duct(3.0, 1.52, -0.28, 0.68, 0.64, 0.75),
        duct(6.0, 1.52, -0.25, 0.64, 0.62, 1),
        duct(7.75, 1.52, -0.22, 0.6, 0.6, 1),
      ],
      { start: false, end: true },
    ),
    (v) => {
      if (v.z < -3.9) v.z += (0.3 - v.y) * 0.4;
    },
  );
  const lining = warp(innerWall([duct(-4.0, 1.44, -0.34, 0.58, 0.64, 0), duct(-2.6, 1.46, -0.34, 0.6, 0.64, 0.1)]), (v) => {
    if (v.z < -3.9) v.z += (0.3 - v.y) * 0.4;
  });
  const mouthRing = duct(0, 1.44, -0.34, 0.52, 0.58, 0).pts;
  const mouth = warp(
    convex([...mouthRing.map(([x, y]) => [x, y, -3.75] as [number, number, number]), ...mouthRing.map(([x, y]) => [x, y, -3.55] as [number, number, number])]),
    (v) => {
      v.z += (0.3 - v.y) * 0.4;
    },
  );
  const glove = convex([
    [0.7, 0.36, -6.4],
    [2.95, 0.26, -0.5],
    [3.05, 0.26, 3.0],
    [2.1, 0.3, 5.2],
    [0.9, 0.58, -3.2],
    [2.6, 0.42, 0.4],
    [2.7, 0.4, 2.8],
    [1.9, 0.46, 4.6],
    [0.9, 0.1, -3.2],
    [2.6, 0.12, 0.4],
    [2.7, 0.12, 2.8],
    [1.9, 0.08, 4.6],
  ]);
  const fins = surface(
    [
      { s: 0, le: 3.4, te: 7.5, t: 0.22 },
      { s: 3.05, le: 6.35, te: 7.95, t: 0.08 },
    ],
    { root: [1.58, 0.42, 0], cant: THREE.MathUtils.degToRad(85), mirror: true },
  );
  const ventrals = surface(
    [
      { s: 0, le: 4.4, te: 6.4, t: 0.08 },
      { s: 0.8, le: 5.5, te: 6.4, t: 0.04 },
    ],
    { root: [1.6, -0.82, 0], cant: -1.3, mirror: true },
  );
  const pylon = convex([
    [2.52, 0.12, -1.6],
    [2.62, 0.12, -1.6],
    [2.52, 0.12, 0.9],
    [2.62, 0.12, 0.9],
    [2.52, -0.1, -1.2],
    [2.62, -0.1, -1.2],
    [2.52, -0.1, 0.7],
    [2.62, -0.1, 0.7],
  ]);
  const stores = mergeGeometries([missile(2.9, 0.065, 2.57, -0.18, -0.3), missile(3.96, 0.19, 0.45, -0.52, 2.2)]);

  const skin = mergeGeometries([forward, centre, nacelle, mirrorX(nacelle), glove, mirrorX(glove)]);
  root.add(new THREE.Mesh(mergeGeometries([skin, fins, ventrals, pylon, mirrorX(pylon), stores, mirrorX(stores)]), m.body));

  const canopyStations = [
    { z: -7.45, w: 0.14, h: 0.06, y: 0.5 },
    { z: -6.6, w: 0.52, h: 0.6, y: 0.54 },
    { z: -5.4, w: 0.62, h: 0.84, y: 0.56 },
    { z: -4.2, w: 0.62, h: 0.86, y: 0.6 },
    { z: -3.1, w: 0.54, h: 0.66, y: 0.68 },
    { z: -2.2, w: 0.2, h: 0.16, y: 0.74 },
  ];
  root.add(new THREE.Mesh(loft(canopyStations, PROFILES.bubble), m.glass));
  const bows = mergeGeometries([
    hoop(PROFILES.bubble, { z: -6.5, w: 0.54, h: 0.63, y: 0.54 }, 0.035),
    hoop(PROFILES.bubble, { z: -4.8, w: 0.64, h: 0.88, y: 0.58 }, 0.035),
  ]);

  const nl = nozzle(-1.52, -0.22, 9.0, 0.6, 0.52, 1.3, 12);
  const nr = nozzle(1.52, -0.22, 9.0, 0.6, 0.52, 1.3, 12);
  root.add(new THREE.Mesh(mergeGeometries([nl.metal, nr.metal]), m.metal));
  root.add(new THREE.Mesh(mergeGeometries([nl.dark, nr.dark, mouth, mirrorX(mouth), lining, mirrorX(lining), bows]), m.dark));

  const wings: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.75, 0.26, -0.2);
    let g = surface(
      [
        { s: 0, le: -1.3, te: 2.2, t: 0.22 },
        { s: 7.6, le: 1.25, te: 2.55, t: 0.08 },
      ],
      { root: [-0.6, 0, 0] },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    wings.push(pivot);
  }

  const stabs: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.05, -0.2, 6.3);
    let g = surface(
      [
        { s: 0, le: -1.8, te: 1.9, t: 0.16 },
        { s: 2.95, le: 1.0, te: 2.1, t: 0.06 },
      ],
      { root: [0, 0, 0] },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    stabs.push(pivot);
  }

  let sweep = 0;
  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-1.52, -0.22, 9.0), r: 0.5 },
      { pos: new THREE.Vector3(1.52, -0.22, 9.0), r: 0.5 },
    ],
    // Lights sit on the fixed glove tips so they stay put while the wings swing.
    wingtips: [new THREE.Vector3(-3.0, 0.28, 0.4), new THREE.Vector3(3.0, 0.28, 0.4)],
    guns: [new THREE.Vector3(-0.62, -0.3, -6.2)],
    cockpit: new THREE.Vector3(0, 1.18, -5.5),
    length: 18.9,
    radius: 6.5,
    animate(s) {
      const target = THREE.MathUtils.clamp((s.speed - 160) / 130, 0, 1);
      sweep += (target - sweep) * 0.08;
      const a = (SWEEP_MAX - SWEEP_MIN) * sweep;
      for (const w of wings) w.rotation.y = -a * Math.sign(w.position.x);
      for (const p of stabs) p.rotation.x = -s.pitch * 0.28 + s.roll * 0.14 * Math.sign(p.position.x);
    },
  };
}

export const f14: JetSpec = {
  id: 'f14',
  stats: { speed: 7, handling: 5, armour: 7, weapons: 7 },
  flight: flightFromStats(7, 5),
  engine: { pitch: 0.86, roar: 1.2, flame: [1.0, 0.44, 0.14] },
  build,
};
