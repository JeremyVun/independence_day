import * as THREE from 'three';
import { at, convex, flip, hoop, innerWall, loft, loftRings, mergeGeometries, mirrorX, PROFILES, rod, splitFaces, surface, symRing, tube, warp, type Profile, type Ring } from '../kit';
import { glowMaterial, jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

const NOZZLE_Z = 9.0;

// Stealth-chined section: faceted top, knife chine at yc reaching out to cx, flat belly.
function section(z: number, yT: number, w: number, cx: number, yc: number, yB: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.55, yT * 0.9],
      [w, yc + (yT - yc) * 0.35],
      [cx, yc],
      [w * 0.85, yB * 0.72],
      [0, yB],
    ]),
  };
}

// Trapezoid intake leaning with the chine; the mouth is swept so the top lip leads.
function intake(z: number, s: number, cx: number, cy: number): Ring {
  const pts: Profile = [
    [0.44, 0.32],
    [-0.4, 0.34],
    [-0.4, -0.34],
    [0.26, -0.34],
  ];
  return { z, pts: pts.map(([x, y]) => [cx + x * s, cy + y * s]) };
}

// Square two-dimensional thrust-vectoring nozzle whose exit face sits at exitZ.
function squareNozzle(x: number, y: number, r0: number, r1: number, len: number) {
  const shell = tube(r0, len, 4, r1);
  shell.rotateZ(Math.PI / 4);
  const inner = flip(tube(r0 * 0.9, len * 0.98, 4, r1 * 0.9));
  inner.rotateZ(Math.PI / 4);
  const face = new THREE.PlaneGeometry(r1 * 1.2, r1 * 1.2);
  face.translate(0, 0, len * 0.25 - len / 2);
  return {
    metal: at(shell, x, y, NOZZLE_Z - len / 2),
    dark: at(mergeGeometries([inner, face]), x, y, NOZZLE_Z - len / 2),
  };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x121419, accent: 0x1d2129, canopy: 'blue', metalness: 0.55, roughness: 0.32 });
  const glow = glowMaterial(0x3a8cff, 3.2);
  const root = new THREE.Group();

  const fuselage = loftRings([
    section(-9.6, -0.03, 0.02, 0.02, -0.05, -0.07),
    section(-8.6, 0.2, 0.24, 0.38, -0.04, -0.22),
    section(-7.2, 0.4, 0.44, 0.74, -0.02, -0.4),
    section(-5.8, 0.54, 0.56, 1.02, 0.0, -0.52),
    section(-4.4, 0.62, 0.66, 1.4, 0.02, -0.6),
    section(-2.8, 0.66, 0.8, 1.72, 0.04, -0.66),
    section(-0.8, 0.66, 0.95, 1.88, 0.04, -0.68),
    section(1.5, 0.64, 1.1, 1.92, 0.04, -0.64),
    section(4.0, 0.6, 1.18, 1.86, 0.04, -0.58),
    section(6.5, 0.52, 1.2, 1.6, 0.02, -0.5),
    section(8.1, 0.46, 1.18, 1.36, 0.0, -0.46),
  ]);
  const duct = warp(
    loftRings([intake(-4.3, 1, 1.12, -0.38), intake(-2.8, 1.02, 1.12, -0.4), intake(-0.4, 0.94, 1.05, -0.38), intake(1.8, 0.68, 0.85, -0.34)], {
      start: false,
      end: true,
    }),
    (v) => {
      if (v.z < -4.2) v.z += (-0.04 - v.y) * 0.6;
    },
  );
  const rake = (v: THREE.Vector3) => {
    v.z += (-0.04 - v.y) * 0.6;
  };
  const lining = warp(innerWall([intake(-4.3, 1, 1.12, -0.38), intake(-2.8, 1.02, 1.12, -0.4)]), (v) => {
    if (v.z < -4.2) v.z += (-0.04 - v.y) * 0.6;
  });
  const mouthPts = intake(0, 0.9, 1.12, -0.38).pts;
  const mouth = warp(
    convex([...mouthPts.map(([x, y]) => [x, y, -4.18] as [number, number, number]), ...mouthPts.map(([x, y]) => [x, y, -4.0] as [number, number, number])]),
    rake,
  );
  const lip = warp(
    hoop(
      intake(0, 1, 0, 0).pts,
      { z: -4.3, w: 1, h: 1, x: 1.12, y: -0.38 },
      0.04,
      true,
    ),
    rake,
  );

  const wings = surface(
    [
      { s: 0, le: 0.8, te: 5.4, t: 0.34 },
      { s: 2.7, le: -0.3, te: 2.75, t: 0.2 },
      { s: 5.4, le: -1.45, te: 0.1, t: 0.08 },
    ],
    { root: [1.4, 0.04, 0], mirror: true },
  );
  const winglets = surface(
    [
      { s: 0, le: -1.45, te: 0.1, t: 0.06 },
      { s: 0.75, le: -0.75, te: 0.3, t: 0.03 },
    ],
    { root: [6.8, 0.04, 0], cant: -0.95, mirror: true },
  );
  const tails = surface(
    [
      { s: 0, le: 4.6, te: 8.0, t: 0.16 },
      { s: 2.8, le: 6.95, te: 8.55, t: 0.06 },
    ],
    { root: [1.22, 0.42, 0], cant: THREE.MathUtils.degToRad(62), mirror: true },
  );

  const skin = mergeGeometries([fuselage, duct, mirrorX(duct), wings]);
  const [panels, hull] = splitFaces(skin, (c, n) => n.y > 0.5 && Math.abs(c.x) > 1.9 && Math.abs(c.x) < 3.2);
  root.add(new THREE.Mesh(hull, m.body), new THREE.Mesh(mergeGeometries([panels, tails, winglets]), m.accent));
  const tailCant = THREE.MathUtils.degToRad(62);
  const tailSpan = new THREE.Vector3(Math.cos(tailCant), Math.sin(tailCant), 0);
  const finEdge = rod(
    [1.22 + tailSpan.x * 0.25, 0.42 + tailSpan.y * 0.25, 4.6 + 0.25 * (2.35 / 2.8) - 0.03],
    [1.22 + tailSpan.x * 2.75, 0.42 + tailSpan.y * 2.75, 6.95 - 0.05 * (2.35 / 2.8) - 0.03],
    0.035,
    4,
  );
  root.add(new THREE.Mesh(mergeGeometries([mouth, mirrorX(mouth), lip, mirrorX(lip), finEdge, mirrorX(finEdge)]), glow));

  const canopy = loft(
    [
      { z: -7.3, w: 0.12, h: 0.05, y: 0.36 },
      { z: -6.6, w: 0.38, h: 0.42, y: 0.4 },
      { z: -5.6, w: 0.46, h: 0.6, y: 0.46 },
      { z: -4.6, w: 0.44, h: 0.54, y: 0.52 },
      { z: -3.6, w: 0.3, h: 0.3, y: 0.58 },
      { z: -2.8, w: 0.1, h: 0.06, y: 0.62 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const nl = squareNozzle(-0.64, 0.0, 0.56, 0.5, 1.1);
  const nr = squareNozzle(0.64, 0.0, 0.56, 0.5, 1.1);
  root.add(new THREE.Mesh(mergeGeometries([nl.metal, nr.metal]), m.metal));
  const bow = hoop(PROFILES.bubble, { z: -6.5, w: 0.4, h: 0.45, y: 0.4 }, 0.03);
  root.add(new THREE.Mesh(mergeGeometries([nl.dark, nr.dark, bow, lining, mirrorX(lining)]), m.dark));

  const canards: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.25, 0.08, -4.2);
    let g = surface(
      [
        { s: 0, le: -0.95, te: 0.8, t: 0.1 },
        { s: 1.75, le: 0.25, te: 0.9, t: 0.04 },
      ],
      { root: [0, 0, 0], cant: -0.08 },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.accent));
    root.add(pivot);
    canards.push(pivot);
  }

  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-0.64, 0.0, NOZZLE_Z), r: 0.44 },
      { pos: new THREE.Vector3(0.64, 0.0, NOZZLE_Z), r: 0.44 },
    ],
    wingtips: [new THREE.Vector3(-6.85, 0.02, -0.65), new THREE.Vector3(6.85, 0.02, -0.65)],
    guns: [new THREE.Vector3(-1.0, 0.1, -5.4), new THREE.Vector3(1.0, 0.1, -5.4)],
    cockpit: new THREE.Vector3(0, 0.92, -5.4),
    length: 18.6,
    radius: 6.8,
    animate(s) {
      for (const c of canards) c.rotation.x = s.pitch * 0.35 + s.roll * 0.1 * Math.sign(c.position.x);
      glow.emissiveIntensity = 2.6 + 1.2 * s.throttle + 1.5 * s.boost;
    },
  };
}

export const protoA: JetSpec = {
  id: 'protoA',
  loadout: 'volley',
  stats: { speed: 7, handling: 10, armour: 4, weapons: 6 },
  flight: flightFromStats(7, 10),
  engine: { pitch: 1.18, roar: 1.0, flame: [0.45, 0.7, 1.0] },
  build,
};
