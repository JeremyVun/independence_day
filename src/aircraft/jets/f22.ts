import * as THREE from 'three';
import { boxAt, loft, mergeGeometries, PROFILES, surface, tube, at, mirrorX } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

function build(): JetModel {
  const m = jetMaterials({ body: 0x60656d, accent: 0x50555d, camo: 0x4c5159, camoScale: 0.18, canopy: 'gold' });
  const root = new THREE.Group();

  const fuselage = loft(
    [
      { z: -9.6, w: 0.02, h: 0.02, y: 0.02 },
      { z: -8.6, w: 0.42, h: 0.3, y: 0.06 },
      { z: -7.2, w: 0.72, h: 0.5, y: 0.12 },
      { z: -5.6, w: 0.95, h: 0.62, y: 0.18 },
      { z: -4.0, w: 1.2, h: 0.66, y: 0.18 },
      { z: -2.6, w: 1.95, h: 0.7, y: 0.1 },
      { z: -0.5, w: 2.25, h: 0.72, y: 0.04 },
      { z: 2.5, w: 2.15, h: 0.66, y: 0.0 },
      { z: 5.5, w: 1.85, h: 0.55, y: 0.0 },
      { z: 7.8, w: 1.55, h: 0.45, y: 0.0 },
      { z: 8.8, w: 1.45, h: 0.42, y: 0.0 },
    ],
    PROFILES.chine,
  );
  const wings = surface(
    [
      { s: 0, le: -2.4, te: 5.6, t: 0.42 },
      { s: 5.3, le: 2.7, te: 4.2, t: 0.1, lift: -0.3 },
    ],
    { root: [1.5, 0.0, 0], mirror: true },
  );
  const fins = surface(
    [
      { s: 0, le: 4.3, te: 8.0, t: 0.18 },
      { s: 3.3, le: 6.9, te: 8.4, t: 0.06 },
    ],
    { root: [1.5, 0.45, 0], cant: THREE.MathUtils.degToRad(62), mirror: true },
  );
  const intakeR = loft(
    [
      { z: -3.7, w: 0.42, h: 0.5, x: 1.62, y: -0.05 },
      { z: -1.0, w: 0.5, h: 0.56, x: 1.7, y: -0.05 },
      { z: 1.8, w: 0.3, h: 0.4, x: 1.5, y: -0.05 },
    ],
    PROFILES.diamond,
  );
  root.add(new THREE.Mesh(mergeGeometries([fuselage, wings, fins, intakeR, mirrorX(intakeR)]), m.body));

  const mouth = boxAt(0.62, 0.8, 0.06, 1.62, -0.05, -3.72);
  root.add(new THREE.Mesh(mergeGeometries([mouth, mirrorX(mouth)]), m.dark));

  const canopy = loft(
    [
      { z: -6.5, w: 0.18, h: 0.06, y: 0.7 },
      { z: -5.6, w: 0.5, h: 0.46, y: 0.7 },
      { z: -4.4, w: 0.58, h: 0.56, y: 0.7 },
      { z: -3.3, w: 0.5, h: 0.44, y: 0.7 },
      { z: -2.4, w: 0.26, h: 0.16, y: 0.7 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const nozzleL = at(tube(0.54, 0.9, 8, 0.47), -0.62, 0.0, 9.15);
  const nozzleR = at(tube(0.54, 0.9, 8, 0.47), 0.62, 0.0, 9.15);
  root.add(new THREE.Mesh(mergeGeometries([nozzleL, nozzleR]), m.metal));

  const stabs: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.35, 0.0, 7.2);
    let g = surface(
      [
        { s: 0, le: -1.7, te: 2.2, t: 0.18 },
        { s: 3.4, le: 0.9, te: 2.1, t: 0.06 },
      ],
      { root: [0, 0, 0] },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.accent));
    root.add(pivot);
    stabs.push(pivot);
  }

  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-0.62, 0.0, 9.6), r: 0.46 },
      { pos: new THREE.Vector3(0.62, 0.0, 9.6), r: 0.46 },
    ],
    wingtips: [new THREE.Vector3(-6.8, -0.3, 3.5), new THREE.Vector3(6.8, -0.3, 3.5)],
    guns: [new THREE.Vector3(1.3, 0.25, -3.2), new THREE.Vector3(-1.3, 0.25, -3.2)],
    cockpit: new THREE.Vector3(0, 1.2, -4.7),
    length: 19.2,
    radius: 5,
    animate(s) {
      for (const p of stabs) p.rotation.x = -s.pitch * 0.28 + s.roll * 0.12 * Math.sign(p.position.x);
    },
  };
}

export const f22: JetSpec = {
  id: 'f22',
  stats: { speed: 8, handling: 9, armour: 6, weapons: 7 },
  flight: flightFromStats(8, 9),
  engine: { pitch: 1.0, roar: 1.0, flame: [1.0, 0.45, 0.15] },
  build,
};
