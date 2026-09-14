import * as THREE from 'three';
import { convex, mergeGeometries, mirrorX, rod, surface } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

type P = [number, number, number];

const SLOT_Z = 8.62;
const SLOT_X = [0.67, 1.04, 1.42, 1.79];

function build(): JetModel {
  const m = jetMaterials({ body: 0x25272c, accent: 0x2d2f35, dark: 0x08090b, canopy: 'gold', metalness: 0.3, roughness: 0.58 });
  const root = new THREE.Group();

  const sym = (pts: P[]): P[] => [...pts, ...pts.filter(([x]) => x > 0).map(([x, y, z]) => [-x, y, z] as P)];

  const body = convex(
    sym([
      [0, -0.2, -10.1],
      [0, -0.45, -9.5],
      [2.25, -0.42, -4.7],
      [2.6, -0.42, 1.5],
      [2.45, -0.42, 4.2],
      [2.2, -0.36, SLOT_Z],
      [1.55, 0.22, -5.2],
      [2.3, 0.3, -1.5],
      [2.4, 0.3, 2.5],
      [2.1, 0.1, SLOT_Z],
      [0.5, 0.56, -7.3],
      [1.05, 0.9, -2.4],
      [1.25, 0.95, 1.0],
      [1.2, 0.7, 5.2],
      [0.7, 0.3, SLOT_Z],
      [0, 1.14, -1.0],
      [0, 1.02, 2.5],
      [0, 0.72, 5.8],
    ]),
  );
  const stinger = convex(
    sym([
      [0.45, 0.25, 6.2],
      [0.45, -0.4, 6.2],
      [0.3, 0.2, SLOT_Z + 0.2],
      [0.3, -0.4, SLOT_Z + 0.2],
      [0, 0.1, 9.9],
      [0, -0.3, 9.9],
    ]),
  );
  const wing = convex([
    [2.0, -0.36, -5.27],
    [6.6, -0.38, 5.83],
    [6.25, -0.38, 6.95],
    [2.0, -0.36, 3.78],
    [2.1, 0.12, -0.6],
    [6.42, -0.3, 6.3],
    [2.1, -0.45, -0.6],
    [6.42, -0.42, 6.3],
  ]);
  const lip = convex([
    [0.5, -0.3, SLOT_Z - 0.3],
    [2.15, -0.3, SLOT_Z - 0.3],
    [2.15, -0.3, SLOT_Z + 0.35],
    [1.3, -0.3, SLOT_Z + 0.78],
    [0.5, -0.3, SLOT_Z + 0.4],
    [0.5, -0.4, SLOT_Z - 0.3],
    [2.15, -0.4, SLOT_Z - 0.3],
    [2.15, -0.4, SLOT_Z + 0.35],
    [1.3, -0.4, SLOT_Z + 0.78],
    [0.5, -0.4, SLOT_Z + 0.4],
  ]);
  const intakeHood = convex([
    [1.0, 0.98, -2.5],
    [2.15, 0.4, -2.5],
    [2.15, 0.12, -2.4],
    [1.0, 0.66, -2.4],
    [1.1, 0.96, -1.2],
    [2.3, 0.36, -1.2],
  ]);
  root.add(new THREE.Mesh(mergeGeometries([body, stinger, intakeHood, mirrorX(intakeHood)]), m.body));
  root.add(new THREE.Mesh(mergeGeometries([wing, mirrorX(wing), lip, mirrorX(lip)]), m.accent));

  const canopy = convex(
    sym([
      [0.52, 0.54, -7.35],
      [0.34, 1.12, -5.5],
      [0.34, 1.32, -3.6],
      [0.98, 0.55, -3.9],
      [0.78, 0.86, -2.6],
      [0, 1.36, -2.7],
    ]),
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const frame = (a: P, b: P) => rod(a, b, 0.035, 4);
  const frames = mergeGeometries([
    frame([0.34, 1.13, -5.5], [-0.34, 1.13, -5.5]),
    frame([0.34, 1.13, -5.5], [0.53, 0.55, -7.33]),
    frame([-0.34, 1.13, -5.5], [-0.53, 0.55, -7.33]),
    frame([0.34, 1.13, -5.5], [0.98, 0.56, -3.9]),
    frame([-0.34, 1.13, -5.5], [-0.98, 0.56, -3.9]),
    frame([0.34, 1.33, -3.6], [0.79, 0.87, -2.6]),
    frame([-0.34, 1.33, -3.6], [-0.79, 0.87, -2.6]),
  ]);
  const grille = convex([
    [1.06, 0.94, -2.54],
    [2.1, 0.4, -2.54],
    [2.1, 0.16, -2.44],
    [1.06, 0.68, -2.44],
    [1.06, 0.94, -2.46],
    [2.1, 0.4, -2.46],
    [2.1, 0.16, -2.36],
    [1.06, 0.68, -2.36],
  ]);
  const slot = convex([
    [0.48, -0.26, SLOT_Z - 0.4],
    [1.98, -0.26, SLOT_Z - 0.4],
    [0.48, 0.1, SLOT_Z - 0.4],
    [1.98, -0.02, SLOT_Z - 0.4],
    [0.48, -0.26, SLOT_Z + 0.01],
    [1.98, -0.26, SLOT_Z + 0.01],
    [0.48, 0.1, SLOT_Z + 0.01],
    [1.98, -0.02, SLOT_Z + 0.01],
  ]);
  root.add(new THREE.Mesh(mergeGeometries([frames, grille, mirrorX(grille), slot, mirrorX(slot)]), m.dark));

  const tails: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.3, 0.4, 7.2);
    let g = surface(
      [
        { s: 0, le: -1.9, te: 1.8, t: 0.12 },
        { s: 3.4, le: 1.05, te: 2.6, t: 0.05 },
      ],
      { root: [0, 0, 0], cant: THREE.MathUtils.degToRad(40) },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    tails.push(pivot);
  }

  const nozzles = SLOT_X.flatMap((x) => [
    { pos: new THREE.Vector3(-x, -0.1, SLOT_Z), r: 0.16 },
    { pos: new THREE.Vector3(x, -0.1, SLOT_Z), r: 0.16 },
  ]);

  return {
    root,
    nozzles,
    wingtips: [new THREE.Vector3(-6.42, -0.36, 6.3), new THREE.Vector3(6.42, -0.36, 6.3)],
    guns: [new THREE.Vector3(-0.5, -0.5, -3.2), new THREE.Vector3(0.5, -0.5, -3.2)],
    cockpit: new THREE.Vector3(0, 1.0, -4.6),
    length: 20.0,
    radius: 6.6,
    animate(s) {
      for (const t of tails) t.rotation.x = -s.pitch * 0.22 + s.yaw * 0.12 * Math.sign(t.position.x);
    },
  };
}

export const f117: JetSpec = {
  id: 'f117',
  stats: { speed: 3, handling: 4, armour: 7, weapons: 8 },
  flight: flightFromStats(3, 4),
  engine: { pitch: 0.86, roar: 0.68, flame: [1.0, 0.5, 0.2] },
  build,
};
