import * as THREE from 'three';
import { convex, hoop, innerWall, loft, loftRings, MeshBuilder, mergeGeometries, missile, mirrorX, nozzle, PROFILES, rod, splitFaces, surface, symRing, warp, type Profile, type Ring } from '../kit';
import { jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

// Body section: humped spine on top, flat lifting body out to sx at yc, shallow belly over the engine tunnel.
function section(z: number, yT: number, w: number, sx: number, yc: number, yB: number, wl: number): Ring {
  return {
    z,
    pts: symRing([
      [0, yT],
      [w * 0.62, yc + (yT - yc) * 0.78],
      [w, yc + (yT - yc) * 0.3],
      [sx, yc],
      [wl, yc - (yc - yB) * 0.5],
      [wl * 0.8, yB + (yc - yB) * 0.08],
      [0, yB],
    ]),
  };
}

// Rectangular intake (t = 0) morphing into the round engine nacelle (t = 1).
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

// Five-pointed star in the plane spanned by u and v around c, visible from the side `n` faces.
function star(c: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, r: number): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const pt = (i: number) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    return c.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr);
  };
  for (let i = 0; i < 10; i++) mb.tri(c, pt(i), pt(i + 1), n);
  return mb.geometry();
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x74879c, accent: 0x405472, canopy: 'blue' });
  const red = jetMaterials({ body: 0x9a1a14, metalness: 0.2, roughness: 0.6 }).body;
  const root = new THREE.Group();

  const droop = (v: THREE.Vector3) => {
    if (v.z < -6) v.y -= 0.04 * (-6 - v.z) ** 2;
  };
  const body = warp(
    loftRings([
      section(-9.0, -0.03, 0.02, 0.02, -0.05, -0.07, 0.02),
      section(-8.4, 0.14, 0.2, 0.2, -0.04, -0.22, 0.19),
      section(-7.6, 0.28, 0.34, 0.35, 0.0, -0.36, 0.33),
      section(-6.6, 0.4, 0.46, 0.48, 0.04, -0.46, 0.44),
      section(-5.6, 0.5, 0.54, 0.62, 0.08, -0.52, 0.5),
      section(-4.5, 0.62, 0.6, 1.1, 0.1, -0.52, 0.54),
      section(-3.3, 0.84, 0.62, 1.58, 0.1, -0.42, 0.56),
      section(-2.0, 0.88, 0.62, 1.96, 0.1, -0.28, 0.6),
      section(-0.8, 0.84, 0.64, 2.2, 0.1, -0.22, 0.66),
      section(0.6, 0.78, 0.66, 1.75, 0.1, -0.2, 0.7),
      section(2.2, 0.7, 0.66, 1.5, 0.1, -0.2, 0.7),
      section(4.0, 0.58, 0.62, 1.4, 0.1, -0.18, 0.66),
      section(5.8, 0.46, 0.54, 1.25, 0.08, -0.16, 0.55),
      section(7.0, 0.34, 0.42, 0.9, 0.06, -0.12, 0.42),
      section(7.9, 0.18, 0.2, 0.2, 0.04, -0.06, 0.2),
    ]),
    droop,
  );
  const nacelle = warp(
    loftRings(
      [
        duct(-3.3, 1.14, -0.5, 0.42, 0.4, 0),
        duct(-2.2, 1.17, -0.5, 0.44, 0.42, 0.15),
        duct(0.0, 1.2, -0.46, 0.5, 0.46, 0.5),
        duct(3.0, 1.2, -0.44, 0.54, 0.5, 0.85),
        duct(6.0, 1.2, -0.42, 0.52, 0.5, 1),
        duct(7.0, 1.2, -0.42, 0.5, 0.48, 1),
      ],
      { start: false, end: true },
    ),
    (v) => {
      if (v.z < -3.2) v.z -= (-0.1 - v.y) * 0.7;
    },
  );
  const lining = warp(innerWall([duct(-3.3, 1.14, -0.5, 0.42, 0.4, 0), duct(-2.2, 1.17, -0.5, 0.44, 0.42, 0.15)]), (v) => {
    if (v.z < -3.2) v.z -= (-0.1 - v.y) * 0.7;
  });
  const mouthRing = duct(0, 1.14, -0.5, 0.37, 0.35, 0).pts;
  const mouth = warp(
    convex([...mouthRing.map(([x, y]) => [x, y, -3.1] as [number, number, number]), ...mouthRing.map(([x, y]) => [x, y, -2.9] as [number, number, number])]),
    (v) => {
      v.z -= (-0.1 - v.y) * 0.7;
    },
  );

  const wings = surface(
    [
      { s: 0, le: -1.23, te: 4.0, t: 0.3 },
      { s: 1.4, le: 0.03, te: 3.9, t: 0.22 },
      { s: 2.8, le: 1.29, te: 3.8, t: 0.14 },
      { s: 4.18, le: 2.53, te: 3.73, t: 0.08 },
    ],
    { root: [1.5, 0.08, 0], mirror: true },
  );
  const finCant = THREE.MathUtils.degToRad(84);
  const fins = surface(
    [
      { s: 0, le: 0.8, te: 6.4, t: 0.2 },
      { s: 0.35, le: 2.6, te: 6.4, t: 0.18 },
      { s: 2.7, le: 5.0, te: 6.55, t: 0.07 },
    ],
    { root: [1.45, 0.14, 0], cant: finCant, mirror: true },
  );
  const ventrals = surface(
    [
      { s: 0, le: 3.4, te: 5.0, t: 0.06 },
      { s: 0.55, le: 4.2, te: 5.0, t: 0.03 },
    ],
    { root: [1.25, -0.9, 0], cant: -1.45, mirror: true },
  );
  const pylons = mergeGeometries(
    [2.7, 4.2].map((x) =>
      convex([
        [x - 0.03, 0.05, 0.0],
        [x + 0.03, 0.05, 0.0],
        [x - 0.03, 0.05, 2.6],
        [x + 0.03, 0.05, 2.6],
        [x - 0.03, -0.24, 0.4],
        [x + 0.03, -0.24, 0.4],
        [x - 0.03, -0.24, 2.3],
        [x + 0.03, -0.24, 2.3],
      ]),
    ),
  );
  const stores = mergeGeometries([missile(4.0, 0.1, 2.7, -0.36, 1.2), missile(2.9, 0.08, 4.2, -0.33, 1.5)]);

  const skin = mergeGeometries([body, nacelle, mirrorX(nacelle), wings, fins]);
  const camo = (c: THREE.Vector3, n: THREE.Vector3) =>
    n.y > 0.12 && Math.sin(c.x * 1.1 + c.z * 0.55) + Math.sin(c.z * 0.8 - Math.abs(c.x) * 0.9 + 1.7) > 0.35;
  const [patches, base] = splitFaces(skin, camo);
  root.add(
    new THREE.Mesh(mergeGeometries([base, ventrals, pylons, mirrorX(pylons), stores, mirrorX(stores)]), m.body),
    new THREE.Mesh(patches, m.accent),
  );

  const span = new THREE.Vector3(Math.cos(finCant), Math.sin(finCant), 0);
  const out = new THREE.Vector3(Math.sin(finCant), -Math.cos(finCant), 0);
  const starC = new THREE.Vector3(1.45, 0.14, 5.0).addScaledVector(span, 1.7).addScaledVector(out, 0.1);
  const starR = star(starC, new THREE.Vector3(0, 0, -1), span, out, 0.42);
  root.add(new THREE.Mesh(mergeGeometries([starR, mirrorX(starR)]), red));

  const canopy = loft(
    [
      { z: -6.9, w: 0.12, h: 0.05, y: 0.32 },
      { z: -6.3, w: 0.4, h: 0.46, y: 0.36 },
      { z: -5.5, w: 0.48, h: 0.62, y: 0.42 },
      { z: -4.7, w: 0.47, h: 0.58, y: 0.5 },
      { z: -4.0, w: 0.34, h: 0.4, y: 0.62 },
      { z: -3.3, w: 0.12, h: 0.1, y: 0.8 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const nl = nozzle(-1.2, -0.42, 8.1, 0.56, 0.5, 1.2, 12);
  const nr = nozzle(1.2, -0.42, 8.1, 0.56, 0.5, 1.2, 12);
  const pitot = warp(rod([0, -0.03, -9.7], [0, -0.03, -8.9], 0.025, 4), droop);
  root.add(new THREE.Mesh(mergeGeometries([nl.metal, nr.metal, pitot]), m.metal));
  const bow = hoop(PROFILES.bubble, { z: -6.25, w: 0.42, h: 0.48, y: 0.36 }, 0.03);
  root.add(new THREE.Mesh(mergeGeometries([nl.dark, nr.dark, mouth, mirrorX(mouth), lining, mirrorX(lining), bow]), m.dark));

  const stabs: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.72, -0.34, 6.5);
    let g = surface(
      [
        { s: 0, le: -1.4, te: 1.3, t: 0.14 },
        { s: 2.2, le: 0.35, te: 1.35, t: 0.05 },
      ],
      { root: [0, 0, 0], cant: -0.04 },
    );
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.body));
    root.add(pivot);
    stabs.push(pivot);
  }

  return {
    root,
    nozzles: [
      { pos: new THREE.Vector3(-1.2, -0.42, 8.1), r: 0.48 },
      { pos: new THREE.Vector3(1.2, -0.42, 8.1), r: 0.48 },
    ],
    wingtips: [new THREE.Vector3(-5.66, 0.08, 3.1), new THREE.Vector3(5.66, 0.08, 3.1)],
    guns: [new THREE.Vector3(-1.0, 0.16, -2.8)],
    cockpit: new THREE.Vector3(0, 0.88, -5.4),
    length: 17.1,
    radius: 5.7,
    animate(s) {
      for (const p of stabs) p.rotation.x = -s.pitch * 0.3 + s.roll * 0.14 * Math.sign(p.position.x);
    },
  };
}

export const mig29: JetSpec = {
  id: 'mig29',
  stats: { speed: 6, handling: 8, armour: 5, weapons: 5 },
  flight: flightFromStats(6, 8),
  engine: { pitch: 0.95, roar: 1.1, flame: [1.0, 0.42, 0.13] },
  build,
};
