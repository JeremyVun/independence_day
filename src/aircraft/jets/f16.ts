import * as THREE from 'three';
import { boxAt, convex, innerWall, loft, loftRings, mergeGeometries, missile, mirrorX, nozzle, PROFILES, rod, splitFaces, surface, symRing, warp, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

// Fuselage cross-section: rounded top, sharp chine/strake edge at height yc reaching out to sx, deep belly.
function section(z: number, yT: number, w: number, sx: number, yc: number, yB: number, wl: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.66, yc + (yT - yc) * 0.8],
      [w, yc + (yT - yc) * 0.28],
      [sx, yc],
      [wl, yc - (yc - yB) * 0.5],
      [wl * 0.84, yB + (yc - yB) * 0.1],
      [0, yB],
    ]),
  };
}

function intakeRing(z: number, cy: number, s: number): Ring {
  return {
    z,
    pts: symRing([
      [0, cy + 0.36 * s],
      [0.46 * s, cy + 0.36 * s],
      [0.56 * s, cy + 0.08 * s],
      [0.5 * s, cy - 0.22 * s],
      [0.3 * s, cy - 0.38 * s],
      [0, cy - 0.42 * s],
    ]),
  };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x6c7178, accent: 0x4a4f57, canopy: 'gold' });
  const root = new THREE.Group();

  const fuselage = loftRings([
    section(-7.55, -0.02, 0.03, 0.03, -0.06, -0.1, 0.03),
    section(-7.0, 0.16, 0.24, 0.25, -0.06, -0.3, 0.22),
    section(-6.2, 0.33, 0.4, 0.41, -0.02, -0.45, 0.38),
    section(-5.3, 0.44, 0.52, 0.53, 0.04, -0.55, 0.48),
    section(-4.4, 0.5, 0.58, 0.64, 0.08, -0.62, 0.54),
    section(-3.4, 0.58, 0.63, 0.94, 0.1, -0.8, 0.58),
    section(-2.3, 0.7, 0.68, 1.32, 0.1, -1.02, 0.62),
    section(-1.1, 0.72, 0.74, 1.74, 0.08, -1.1, 0.66),
    section(0.4, 0.7, 0.78, 1.6, 0.06, -1.08, 0.7),
    section(2.0, 0.64, 0.78, 1.3, 0.04, -0.98, 0.72),
    section(3.6, 0.57, 0.74, 0.98, 0.02, -0.8, 0.7),
    section(5.0, 0.5, 0.68, 0.74, 0.0, -0.6, 0.64),
    section(6.3, 0.44, 0.6, 0.6, 0.0, -0.44, 0.58),
  ]);
  const [spine, belly] = splitFaces(fuselage, (c, n) => n.y > 0.2 && c.z > -6.4);

  const intake = warp(
    loftRings([intakeRing(-4.35, -0.9, 1), intakeRing(-3.4, -0.9, 1.02), intakeRing(-2.2, -0.86, 0.98), intakeRing(-0.8, -0.78, 0.9)], {
      start: false,
      end: true,
    }),
    (v) => {
      if (v.z < -4.3) v.z -= (-0.56 - v.y) * 0.4;
    },
  );
  const lining = warp(innerWall([intakeRing(-4.35, -0.9, 1), intakeRing(-3.4, -0.9, 1.02)]), (v) => {
    if (v.z < -4.3) v.z -= (-0.56 - v.y) * 0.4;
  });
  const mouthPts = intakeRing(0, -0.9, 0.9).pts;
  const mouth = convex([...mouthPts.map(([x, y]) => [x, y, -4.1] as [number, number, number]), ...mouthPts.map(([x, y]) => [x, y, -3.9] as [number, number, number])]);

  const wings = surface(
    [
      { s: 0, le: -1.75, te: 3.05, t: 0.36 },
      { s: 3.92, le: 1.42, te: 2.72, t: 0.09 },
    ],
    { root: [0.7, 0.05, 0], mirror: true },
  );
  const fin = surface(
    [
      { s: 0, le: 2.3, te: 6.2, t: 0.24 },
      { s: 2.85, le: 5.25, te: 6.45, t: 0.08 },
    ],
    { root: [0, 0.5, 0], cant: Math.PI / 2 },
  );
  const chute = convex([
    [0.2, 0.4, 5.8],
    [-0.2, 0.4, 5.8],
    [0.2, 0.78, 6.1],
    [-0.2, 0.78, 6.1],
    [0.18, 0.4, 6.95],
    [-0.18, 0.4, 6.95],
    [0.16, 0.74, 6.85],
    [-0.16, 0.74, 6.85],
  ]);
  const ventrals = surface(
    [
      { s: 0, le: 3.7, te: 5.0, t: 0.07 },
      { s: 0.62, le: 4.35, te: 5.0, t: 0.03 },
    ],
    { root: [0.52, -0.4, 0], cant: -1.25, mirror: true },
  );
  const rail = boxAt(0.09, 0.12, 2.7, 4.66, 0.04, 1.85);
  const pylon = convex([
    [3.08, 0.0, 0.2],
    [3.12, 0.0, 0.2],
    [3.08, 0.0, 2.4],
    [3.12, 0.0, 2.4],
    [3.08, -0.24, 0.6],
    [3.12, -0.24, 0.6],
    [3.08, -0.24, 2.2],
    [3.12, -0.24, 2.2],
  ]);
  const stores = mergeGeometries([missile(2.9, 0.065, 4.76, 0.04, 1.75), missile(3.65, 0.09, 3.1, -0.34, 1.3)]);
  root.add(
    new THREE.Mesh(mergeGeometries([belly, intake, wings, fin, ventrals, rail, mirrorX(rail), pylon, mirrorX(pylon), stores, mirrorX(stores)]), m.body),
    new THREE.Mesh(mergeGeometries([spine, chute]), m.accent),
  );

  const canopy = loft(
    [
      { z: -6.1, w: 0.14, h: 0.06, y: 0.32 },
      { z: -5.5, w: 0.42, h: 0.5, y: 0.34 },
      { z: -4.6, w: 0.52, h: 0.78, y: 0.36 },
      { z: -3.6, w: 0.5, h: 0.72, y: 0.42 },
      { z: -2.8, w: 0.36, h: 0.46, y: 0.52 },
      { z: -2.1, w: 0.14, h: 0.14, y: 0.64 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const noz = nozzle(0, 0, 7.45, 0.6, 0.5, 1.2, 12);
  root.add(new THREE.Mesh(mergeGeometries([noz.metal, rod([0, -0.04, -8.25], [0, -0.04, -7.5], 0.025, 4)]), m.metal));
  root.add(new THREE.Mesh(mergeGeometries([noz.dark, mouth, lining]), m.dark));

  const stabs: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.82, -0.02, 5.75);
    let g = surface(
      [
        { s: 0, le: -1.35, te: 1.2, t: 0.14 },
        { s: 2.2, le: 0.42, te: 1.25, t: 0.05 },
      ],
      { root: [0, 0, 0], cant: -0.17 },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    stabs.push(pivot);
  }

  return {
    root,
    nozzles: [{ pos: new THREE.Vector3(0, 0, 7.45), r: 0.48 }],
    wingtips: [new THREE.Vector3(-4.62, 0.05, 2.1), new THREE.Vector3(4.62, 0.05, 2.1)],
    guns: [new THREE.Vector3(-0.8, 0.3, -3.3)],
    cockpit: new THREE.Vector3(0, 0.95, -4.6),
    length: 15.0,
    radius: 4.7,
    animate(s) {
      for (const p of stabs) p.rotation.x = -s.pitch * 0.3 + s.roll * 0.14 * Math.sign(p.position.x);
    },
  };
}

export const f16: JetSpec = {
  id: 'f16',
  stats: { speed: 6, handling: 8, armour: 4, weapons: 5 },
  flight: flightFromStats(6, 8),
  engine: { pitch: 1.1, roar: 0.92, flame: [1.0, 0.48, 0.16] },
  build,
};
