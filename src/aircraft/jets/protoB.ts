import * as THREE from 'three';
import { convex, loft, loftRings, mergeGeometries, mirrorX, PROFILES, rod, splitFaces, surface, symRing, type Ring } from '../kit';
import { glowMaterial, jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

type P = [number, number, number];

const TAIL_Z = 12.0;
const SLOT_X = [-1.95, -1.3, -0.65, 0, 0.65, 1.3, 1.95];

// Planform half-width and lens thickness along the body, nose to tail.
const STATIONS: [number, number, number, number][] = [
  [-14.0, 0.0, 0.0, 0.0],
  [-12.0, 0.45, 0.2, -0.14],
  [-9.0, 1.15, 0.42, -0.28],
  [-6.0, 1.95, 0.6, -0.38],
  [-3.0, 2.8, 0.74, -0.46],
  [0.0, 3.6, 0.82, -0.5],
  [3.0, 4.35, 0.84, -0.5],
  [6.0, 4.95, 0.78, -0.48],
  [9.0, 5.4, 0.64, -0.44],
  [TAIL_Z, 5.62, 0.46, -0.36],
];

// Flattened lens with a knife edge at the planform outline.
function section(z: number, w: number, top: number, bot: number): Ring {
  return {
    z,
    pts: symRing([
      [0, top],
      [w * 0.22, top * 0.96],
      [w * 0.48, top * 0.62],
      [w * 0.78, top * 0.24],
      [w, 0],
      [w * 0.78, bot * 0.22],
      [w * 0.48, bot * 0.62],
      [w * 0.22, bot * 0.96],
      [0, bot],
    ]),
  };
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x15171d, accent: 0x1d2029, canopy: 'gold', metalness: 0.5, roughness: 0.36 });
  const seamGlow = glowMaterial(0x4cc4ff, 2.2);
  const root = new THREE.Group();

  const hull = loftRings(STATIONS.map(([z, w, t, b]) => section(z, w, t, b)));
  const [topPanels, rest] = splitFaces(hull, (c, n) => n.y > 0.3 && Math.abs(c.x) < 1.8);
  const belly = loftRings(
    [-1.8, 0.0, 4.0, 8.0, 11.2].map((z, i) => {
      const hw = [1.5, 1.7, 1.75, 1.7, 1.6][i];
      const d = [-0.76, -0.8, -0.8, -0.72, -0.5][i];
      return { z, pts: symRing([[0, -0.3], [hw, -0.3], [hw * 0.92, d], [0, d]]) };
    }),
    { start: false, end: true },
  );
  const fins = surface(
    [
      { s: 0, le: 8.6, te: TAIL_Z, t: 0.16 },
      { s: 2.0, le: 10.6, te: TAIL_Z + 0.3, t: 0.06 },
    ],
    { root: [5.0, 0.12, 0], cant: THREE.MathUtils.degToRad(70), mirror: true },
  );
  root.add(new THREE.Mesh(mergeGeometries([rest, belly, fins]), m.body), new THREE.Mesh(topPanels, m.accent));

  const canopy = loft(
    [
      { z: -8.4, w: 0.12, h: 0.04, y: 0.46 },
      { z: -7.4, w: 0.4, h: 0.32, y: 0.5 },
      { z: -6.1, w: 0.46, h: 0.42, y: 0.56 },
      { z: -4.9, w: 0.4, h: 0.34, y: 0.62 },
      { z: -3.8, w: 0.12, h: 0.06, y: 0.68 },
    ],
    PROFILES.bubble,
  );
  root.add(new THREE.Mesh(canopy, m.glass));

  const slot = convex([
    [-2.3, -0.3, TAIL_Z - 0.5],
    [2.3, -0.3, TAIL_Z - 0.5],
    [-2.3, 0.14, TAIL_Z - 0.5],
    [2.3, 0.14, TAIL_Z - 0.5],
    [-2.3, -0.3, TAIL_Z + 0.02],
    [2.3, -0.3, TAIL_Z + 0.02],
    [-2.3, 0.14, TAIL_Z + 0.02],
    [2.3, 0.14, TAIL_Z + 0.02],
  ]);
  const scoop = convex([
    [-1.35, -0.34, -1.7],
    [1.35, -0.34, -1.7],
    [-1.3, -0.72, -1.7],
    [1.3, -0.72, -1.7],
    [-1.35, -0.34, -1.5],
    [1.35, -0.34, -1.5],
    [-1.3, -0.72, -1.5],
    [1.3, -0.72, -1.5],
  ]);
  root.add(new THREE.Mesh(mergeGeometries([slot, scoop]), m.dark));
  const lipTop = rod([-2.35, 0.17, TAIL_Z + 0.02], [2.35, 0.17, TAIL_Z + 0.02], 0.05, 4);
  const lipBot = rod([-2.35, -0.33, TAIL_Z + 0.02], [2.35, -0.33, TAIL_Z + 0.02], 0.05, 4);
  root.add(new THREE.Mesh(mergeGeometries([lipTop, lipBot]), m.metal));

  // Thin glowing seams: shoulder lines running aft from the canopy, a spine line and the exhaust frame.
  const along = (f: number, lift: number): P[] =>
    STATIONS.slice(3).map(([z, w, t]) => [w * f, t * (f < 0.3 ? 0.97 : 0.62) + lift, z] as P);
  const polyline = (pts: P[], r: number) => mergeGeometries(pts.slice(1).map((p, i) => rod(pts[i], p, r, 4)));
  const shoulder = polyline(along(0.48, 0.03), 0.045);
  const edge = polyline(
    STATIONS.map(([z, w]) => [w + 0.01, 0, z] as P),
    0.045,
  );
  const spine = polyline(
    STATIONS.slice(5).map(([z, , t]) => [0, t + 0.03, z] as P),
    0.045,
  );
  const frame = mergeGeometries([
    rod([-2.35, 0.2, TAIL_Z + 0.04], [2.35, 0.2, TAIL_Z + 0.04], 0.03, 4),
    rod([-2.35, -0.36, TAIL_Z + 0.04], [2.35, -0.36, TAIL_Z + 0.04], 0.03, 4),
  ]);
  root.add(new THREE.Mesh(mergeGeometries([shoulder, mirrorX(shoulder), edge, mirrorX(edge), spine, frame]), seamGlow));

  const elevons: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 2.5, 0.0, TAIL_Z - 0.05);
    let g = convex([
      [0, 0.1, 0],
      [2.4, 0.06, 0],
      [0, -0.08, 0],
      [2.4, -0.05, 0],
      [0, 0, 0.9],
      [2.4, 0, 0.9],
    ]);
    if (side < 0) g = mirrorX(g);
    pivot.add(new THREE.Mesh(g, m.accent));
    root.add(pivot);
    elevons.push(pivot);
  }

  return {
    root,
    nozzles: SLOT_X.map((x) => ({ pos: new THREE.Vector3(x, -0.08, TAIL_Z), r: 0.26 })),
    wingtips: [new THREE.Vector3(-5.6, 0.0, 11.3), new THREE.Vector3(5.6, 0.0, 11.3)],
    guns: [new THREE.Vector3(-1.1, -0.2, -8.0), new THREE.Vector3(1.1, -0.2, -8.0)],
    cockpit: new THREE.Vector3(0, 0.88, -6.3),
    length: 26.0,
    radius: 5.6,
    animate(s) {
      for (const e of elevons) e.rotation.x = -s.pitch * 0.3 + s.roll * 0.25 * Math.sign(e.position.x);
      seamGlow.emissiveIntensity = 1.8 + 0.8 * s.throttle + 1.6 * s.boost + 0.25 * Math.sin(s.time * 2.2);
    },
  };
}

export const protoB: JetSpec = {
  id: 'protoB',
  loadout: 'rail',
  stats: { speed: 10, handling: 4, armour: 5, weapons: 5 },
  flight: flightFromStats(10, 4),
  engine: { pitch: 1.25, roar: 1.25, flame: [0.55, 0.75, 1.0] },
  build,
};
