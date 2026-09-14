import * as THREE from 'three';
import { flip, hoop, loft, loftRings, mergeGeometries, mirrorX, nozzle, PROFILES, rod, splitFaces, surface, symRing, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

const NACELLE_X = 4.1;
const NOZZLE_Z = 13.4;

// Blackbird section: rounded top, knife-edge chine reaching out to cx, flatter underside.
function section(z: number, yT: number, w: number, cx: number, yc: number, yB: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.6, yc + (yT - yc) * 0.86],
      [w, yc + (yT - yc) * 0.36],
      [cx, yc],
      [w * 0.96, yc + (yB - yc) * 0.5],
      [w * 0.55, yB * 0.96],
      [0, yB],
    ]),
  };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x0f1118, accent: 0x151822, dark: 0x06070a, canopy: 'smoke', metalness: 0.62, roughness: 0.34 });
  const root = new THREE.Group();

  const fuselage = loftRings([
    section(-18.2, 0.02, 0.02, 0.02, 0.0, -0.02),
    section(-17.0, 0.2, 0.2, 0.36, 0.0, -0.17),
    section(-15.0, 0.42, 0.4, 0.9, -0.02, -0.34),
    section(-12.5, 0.6, 0.55, 1.45, -0.04, -0.48),
    section(-10.0, 0.72, 0.66, 1.95, -0.05, -0.56),
    section(-7.0, 0.8, 0.72, 2.55, -0.05, -0.6),
    section(-4.5, 0.82, 0.76, 3.15, -0.05, -0.62),
    section(-1.0, 0.82, 0.78, 3.2, -0.04, -0.62),
    section(3.0, 0.8, 0.78, 3.2, -0.03, -0.6),
    section(8.8, 0.66, 0.68, 3.2, -0.02, -0.5),
    section(9.6, 0.62, 0.64, 0.9, -0.02, -0.46),
    section(12.2, 0.4, 0.42, 0.55, 0.0, -0.3),
    section(14.6, 0.04, 0.04, 0.04, 0.0, -0.02),
  ]);

  const nacelleStations = [
    { z: -4.9, w: 0.9, h: 0.9 },
    { z: -3.6, w: 1.08, h: 1.08 },
    { z: 0.5, w: 1.2, h: 1.2 },
    { z: 6.5, w: 1.16, h: 1.16 },
    { z: 10.5, w: 1.0, h: 1.0 },
    { z: 12.3, w: 0.9, h: 0.9 },
  ].map((s) => ({ ...s, x: NACELLE_X }));
  const nacelle = loft(nacelleStations, PROFILES.round, { start: false, end: true });
  const spike = loft(
    [
      { z: -8.4, w: 0.01, h: 0.01, x: NACELLE_X },
      { z: -6.6, w: 0.36, h: 0.36, x: NACELLE_X },
      { z: -4.9, w: 0.6, h: 0.6, x: NACELLE_X },
      { z: -3.8, w: 0.66, h: 0.66, x: NACELLE_X },
    ],
    PROFILES.round,
  );
  const inletWall = flip(loft(nacelleStations.slice(0, 2).map((s) => ({ ...s, w: s.w * 0.97, h: s.h * 0.97 })), PROFILES.round, { start: false, end: true }));

  const outerWing = surface(
    [
      { s: 0, le: -0.6, te: 9.0, t: 0.34 },
      { s: 2.0, le: 1.95, te: 8.9, t: 0.2 },
      { s: 3.0, le: 3.4, te: 8.5, t: 0.12 },
      { s: 3.4, le: 4.8, te: 7.8, t: 0.05 },
    ],
    { root: [NACELLE_X + 0.95, 0.0, 0] },
  );

  const skin = mergeGeometries([fuselage, nacelle, mirrorX(nacelle), outerWing, mirrorX(outerWing)]);
  const [topSkin, lowSkin] = splitFaces(skin, (_c, n) => n.y > 0.2);
  root.add(new THREE.Mesh(topSkin, m.body), new THREE.Mesh(mergeGeometries([lowSkin, spike, mirrorX(spike)]), m.accent));

  const canopy = loft(
    [
      { z: -11.3, w: 0.12, h: 0.05, y: 0.6 },
      { z: -10.6, w: 0.4, h: 0.34, y: 0.62 },
      { z: -9.6, w: 0.48, h: 0.46, y: 0.64 },
      { z: -8.6, w: 0.46, h: 0.4, y: 0.68 },
      { z: -7.6, w: 0.36, h: 0.3, y: 0.72 },
      { z: -6.8, w: 0.1, h: 0.06, y: 0.76 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const nl = nozzle(-NACELLE_X, 0, NOZZLE_Z, 0.9, 0.84, 1.3, 12);
  const nr = nozzle(NACELLE_X, 0, NOZZLE_Z, 0.9, 0.84, 1.3, 12);
  root.add(new THREE.Mesh(mergeGeometries([nl.metal, nr.metal, rod([0, 0, -19.2], [0, 0, -18.1], 0.03, 4)]), m.metal));
  const bows = mergeGeometries([
    hoop(PROFILES.bubble, { z: -10.5, w: 0.42, h: 0.36, y: 0.62 }, 0.03),
    hoop(PROFILES.bubble, { z: -8.9, w: 0.48, h: 0.43, y: 0.67 }, 0.03),
  ]);
  root.add(new THREE.Mesh(mergeGeometries([nl.dark, nr.dark, inletWall, mirrorX(inletWall), bows]), m.dark));

  const finCant = THREE.MathUtils.degToRad(105);
  const fins: { pivot: THREE.Group; axis: THREE.Vector3 }[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * NACELLE_X, 1.08, 9.2);
    let g = surface(
      [
        { s: 0, le: -2.6, te: 2.0, t: 0.2 },
        { s: 2.9, le: 0.4, te: 2.35, t: 0.07 },
      ],
      { root: [0, 0, 0], cant: finCant },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    fins.push({ pivot, axis: new THREE.Vector3(side * Math.cos(finCant), Math.sin(finCant), 0) });
  }

  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-NACELLE_X, 0, NOZZLE_Z), r: 0.8 },
      { pos: new THREE.Vector3(NACELLE_X, 0, NOZZLE_Z), r: 0.8 },
    ],
    wingtips: [new THREE.Vector3(-8.4, 0.0, 6.4), new THREE.Vector3(8.4, 0.0, 6.4)],
    guns: [new THREE.Vector3(-1.2, -0.05, -12.5), new THREE.Vector3(1.2, -0.05, -12.5)],
    cockpit: new THREE.Vector3(0, 1.02, -9.8),
    length: 32.7,
    radius: 8.4,
    animate(s) {
      for (const f of fins) f.pivot.quaternion.setFromAxisAngle(f.axis, s.yaw * 0.25);
    },
  };
}

export const sr71: JetSpec = {
  id: 'sr71',
  stats: { speed: 9, handling: 2, armour: 4, weapons: 3 },
  flight: flightFromStats(9, 2),
  engine: { pitch: 0.74, roar: 1.45, flame: [1.0, 0.42, 0.12] },
  build,
};
