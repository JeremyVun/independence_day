import * as THREE from 'three';
import { boxAt, convex, innerWall, loft, loftRings, mergeGeometries, missile, mirrorX, nozzle, PROFILES, splitFaces, surface, symRing, type Profile, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

// Hornet section: rounded top, leading-edge extension reaching out to sx at height yc, flat belly between the intakes.
function section(z: number, yT: number, w: number, sx: number, yc: number, yB: number, wl: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.7, yc + (yT - yc) * 0.82],
      [w, yc + (yT - yc) * 0.3],
      [sx, yc],
      [wl, yc - (yc - yB) * 0.5],
      [wl * 0.8, yB + (yc - yB) * 0.08],
      [0, yB],
    ]),
  };
}

// D-shaped intake: flat inboard face against the fuselage, rounded outboard lip.
function intakeRing(z: number, cx: number, cy: number, s: number): Ring {
  const pts: Profile = [
    [-0.3, 0.4],
    [0.08, 0.4],
    [0.3, 0.25],
    [0.36, 0],
    [0.3, -0.26],
    [0.08, -0.42],
    [-0.3, -0.42],
  ];
  return { z, pts: pts.map(([x, y]) => [cx + x * s, cy + y * s]) };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x686d75, accent: 0x50555d, canopy: 'smoke' });
  const root = new THREE.Group();

  const fuselage = loftRings([
    section(-8.8, -0.04, 0.02, 0.02, -0.06, -0.08, 0.02),
    section(-8.2, 0.18, 0.26, 0.26, -0.03, -0.26, 0.24),
    section(-7.4, 0.34, 0.42, 0.42, 0.0, -0.42, 0.4),
    section(-6.5, 0.44, 0.52, 0.54, 0.08, -0.52, 0.5),
    section(-5.4, 0.52, 0.58, 0.74, 0.16, -0.58, 0.55),
    section(-4.2, 0.58, 0.62, 1.02, 0.2, -0.62, 0.6),
    section(-3.0, 0.62, 0.68, 1.4, 0.22, -0.66, 0.66),
    section(-1.9, 0.64, 0.76, 1.82, 0.2, -0.68, 0.74),
    section(-1.0, 0.64, 0.86, 2.15, 0.16, -0.7, 0.82),
    section(0.3, 0.62, 0.98, 1.72, 0.12, -0.72, 0.95),
    section(2.0, 0.6, 1.08, 1.32, 0.1, -0.7, 1.05),
    section(3.8, 0.56, 1.12, 1.2, 0.08, -0.62, 1.08),
    section(5.6, 0.5, 1.1, 1.12, 0.05, -0.52, 1.06),
    section(7.1, 0.42, 1.05, 1.06, 0.02, -0.44, 1.0),
  ]);
  const [topSkin, lowSkin] = splitFaces(fuselage, (_c, n) => n.y > 0.25);

  const intake = loftRings(
    [intakeRing(-2.5, 1.02, -0.42, 1), intakeRing(-1.4, 1.02, -0.42, 1), intakeRing(0.4, 0.96, -0.42, 0.92), intakeRing(2.2, 0.86, -0.36, 0.66)],
    { start: false, end: true },
  );
  const lining = innerWall([intakeRing(-2.5, 1.02, -0.42, 1), intakeRing(-1.4, 1.02, -0.42, 1)]);
  const mouthRing = intakeRing(0, 1.02, -0.42, 0.9).pts;
  const mouth = convex([...mouthRing.map(([x, y]) => [x, y, -2.35] as [number, number, number]), ...mouthRing.map(([x, y]) => [x, y, -2.2] as [number, number, number])]);
  const splitter = boxAt(0.04, 0.9, 1.5, 0.68, -0.44, -1.9);

  const wings = surface(
    [
      { s: 0, le: -1.6, te: 2.6, t: 0.34 },
      { s: 4.7, le: 0.76, te: 2.36, t: 0.1 },
    ],
    { root: [1.0, 0.12, 0], mirror: true },
  );
  const fins = surface(
    [
      { s: 0, le: 1.8, te: 5.3, t: 0.2 },
      { s: 3.15, le: 4.3, te: 5.6, t: 0.07 },
    ],
    { root: [0.95, 0.5, 0], cant: THREE.MathUtils.degToRad(70), mirror: true },
  );
  const rail = boxAt(0.09, 0.12, 2.6, 5.72, 0.12, 1.55);
  const pylon = convex([
    [3.48, 0.05, -0.2],
    [3.54, 0.05, -0.2],
    [3.48, 0.05, 2.2],
    [3.54, 0.05, 2.2],
    [3.48, -0.3, 0.2],
    [3.54, -0.3, 0.2],
    [3.48, -0.3, 2.0],
    [3.54, -0.3, 2.0],
  ]);
  const stores = mergeGeometries([
    missile(2.9, 0.065, 5.82, 0.12, 1.45),
    missile(3.66, 0.1, 3.51, -0.42, 0.9),
    missile(3.66, 0.1, 1.28, -0.86, 1.4),
  ]);
  const [topWing, lowWing] = splitFaces(mergeGeometries([wings, fins]), (_c, n) => n.y > 0.25 || Math.abs(n.x) > 0.8);
  root.add(
    new THREE.Mesh(mergeGeometries([lowSkin, lowWing, intake, mirrorX(intake), splitter, mirrorX(splitter), rail, mirrorX(rail), pylon, mirrorX(pylon), stores, mirrorX(stores)]), m.body),
    new THREE.Mesh(mergeGeometries([topSkin, topWing]), m.accent),
  );

  const canopy = loft(
    [
      { z: -6.8, w: 0.14, h: 0.06, y: 0.4 },
      { z: -6.2, w: 0.43, h: 0.54, y: 0.42 },
      { z: -5.3, w: 0.52, h: 0.8, y: 0.44 },
      { z: -4.4, w: 0.5, h: 0.74, y: 0.48 },
      { z: -3.5, w: 0.36, h: 0.46, y: 0.54 },
      { z: -2.7, w: 0.12, h: 0.1, y: 0.6 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const nl = nozzle(-0.56, 0.0, 8.2, 0.55, 0.48, 1.15, 12);
  const nr = nozzle(0.56, 0.0, 8.2, 0.55, 0.48, 1.15, 12);
  root.add(new THREE.Mesh(mergeGeometries([nl.metal, nr.metal]), m.metal));
  root.add(new THREE.Mesh(mergeGeometries([nl.dark, nr.dark, mouth, mirrorX(mouth), lining, mirrorX(lining)]), m.dark));

  const stabs: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.05, 0.0, 6.7);
    let g = surface(
      [
        { s: 0, le: -1.6, te: 1.05, t: 0.14 },
        { s: 2.45, le: 0.3, te: 1.15, t: 0.05 },
      ],
      { root: [0, 0, 0], cant: -0.05 },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.accent));
    root.add(pivot);
    stabs.push(pivot);
  }

  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-0.56, 0.0, 8.2), r: 0.46 },
      { pos: new THREE.Vector3(0.56, 0.0, 8.2), r: 0.46 },
    ],
    wingtips: [new THREE.Vector3(-5.7, 0.12, 1.55), new THREE.Vector3(5.7, 0.12, 1.55)],
    guns: [new THREE.Vector3(0, 0.34, -8.1)],
    cockpit: new THREE.Vector3(0, 1.05, -5.3),
    length: 17.0,
    radius: 5.8,
    animate(s) {
      for (const p of stabs) p.rotation.x = -s.pitch * 0.3 + s.roll * 0.14 * Math.sign(p.position.x);
    },
  };
}

export const f18: JetSpec = {
  id: 'f18',
  stats: { speed: 5, handling: 7, armour: 6, weapons: 6 },
  flight: flightFromStats(5, 7),
  engine: { pitch: 0.98, roar: 1.05, flame: [1.0, 0.46, 0.15] },
  build,
};
