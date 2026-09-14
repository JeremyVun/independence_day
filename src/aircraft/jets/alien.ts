import * as THREE from 'three';
import { at, flip, loft, loftRings, mergeGeometries, PROFILES, rod, surface, tube, type Ring } from '../kit';
import { glowMaterial, iridescentMaterial, jetMaterials } from '../materials';
import type { JetModel, JetSpec } from '../types';
import { flightFromStats } from '../types';

type P = [number, number, number];

const TEAL = 0x2cf0c8;
// Blades point up, lower-left and lower-right; the shell slits between them show the core.
const BLADE_ANGLES = [90, 210, 330].map((d) => THREE.MathUtils.degToRad(d));
const BLADE_ROOT = 1.2;
const BLADE: { s: number; le: number; te: number; t: number; lift: number }[] = [
  { s: 0, le: -3.3, te: 3.4, t: 0.42, lift: 0 },
  { s: 2.2, le: -1.5, te: 3.9, t: 0.28, lift: 0.18 },
  { s: 4.0, le: 0.8, te: 4.7, t: 0.15, lift: 0.5 },
  { s: 5.3, le: 3.3, te: 5.7, t: 0.06, lift: 0.95 },
];
// Shell radius along the body, nose to tail.
const SHELL: [number, number][] = [
  [-6.2, 0.28],
  [-5.0, 0.95],
  [-2.8, 1.45],
  [0.4, 1.6],
  [3.0, 1.38],
  [5.2, 0.92],
  [6.5, 0.5],
];

// One curved carapace plate centred on angle phi, with a raised keel down its middle.
function plate(phi: number, spread: number): THREE.BufferGeometry {
  const rings: Ring[] = SHELL.map(([z, r]) => {
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    for (let j = 0; j <= 4; j++) {
      const a = phi - spread / 2 + (spread * j) / 4;
      const keel = j === 2 ? 1.1 : 1;
      outer.push([Math.cos(a) * r * keel, Math.sin(a) * r * keel]);
      inner.unshift([Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9]);
    }
    return { z, pts: [...outer, ...inner] };
  });
  return loftRings(rings);
}

// Bends blade vertices a little around the body axis, more toward the tips, as a slow travelling wave.
function flexing<T extends THREE.Material>(mat: T, clock: { value: number }): T {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uFlex = clock;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlex;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float rr = length(transformed.xy);
        float k = smoothstep(1.3, 6.6, rr);
        float ph = uFlex * 1.3 + atan(transformed.y, transformed.x) * 2.0;
        float ang = k * k * 0.06 * sin(ph - transformed.z * 0.25);
        float c = cos(ang);
        float s = sin(ang);
        transformed.xy = mat2(c, s, -s, c) * transformed.xy;
        transformed.z += k * k * 0.3 * sin(ph + 1.3);
      }`,
    );
  };
  mat.customProgramCacheKey = () => 'nightfog-alienflex';
  return mat;
}

function build(): JetModel {
  const m = jetMaterials({ body: 0x141a22, dark: 0x05070a });
  const shell = iridescentMaterial(0x252f40);
  const clock = { value: 0 };
  const bladeMat = flexing(iridescentMaterial(0x2b374b), clock);
  const veinMat = flexing(glowMaterial(TEAL, 1.8), clock);
  const coreMat = glowMaterial(TEAL, 2.0);
  const root = new THREE.Group();

  const plates = mergeGeometries(BLADE_ANGLES.map((a) => plate(a, THREE.MathUtils.degToRad(106))));
  root.add(new THREE.Mesh(plates, shell));

  const core = loft(
    [
      { z: -6.9, w: 0.01, h: 0.01 },
      { z: -5.2, w: 0.62, h: 0.62 },
      { z: -2.2, w: 1.12, h: 1.12 },
      { z: 1.4, w: 1.12, h: 1.12 },
      { z: 4.6, w: 0.72, h: 0.72 },
      { z: 6.6, w: 0.3, h: 0.3 },
    ],
    PROFILES.round6,
  );
  root.add(new THREE.Mesh(core, coreMat));

  const blades: THREE.BufferGeometry[] = [];
  const veins: THREE.BufferGeometry[] = [];
  for (const a of BLADE_ANGLES) {
    const span = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const up = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    const rootPt = span.clone().multiplyScalar(BLADE_ROOT);
    blades.push(surface(BLADE, { root: [rootPt.x, rootPt.y, 0], cant: a, ridge: 0.3 }));
    const along = (fn: (st: (typeof BLADE)[number]) => [number, number]): P[] =>
      BLADE.map((st) => {
        const [off, z] = fn(st);
        const b = rootPt.clone().addScaledVector(span, st.s).addScaledVector(up, st.lift + off);
        return [b.x, b.y, z];
      });
    const line = (pts: P[], r: number) => mergeGeometries(pts.slice(1).map((p, i) => rod(pts[i], p, r, 4)));
    veins.push(line(along((st) => [0, st.le - 0.02]), 0.05));
    veins.push(line(along((st) => [st.t / 2 + 0.02, st.le + (st.te - st.le) * 0.3]).slice(0, 3), 0.04));
  }
  root.add(new THREE.Mesh(mergeGeometries(blades), bladeMat), new THREE.Mesh(mergeGeometries(veins), veinMat));

  const vents = BLADE_ANGLES.map((a) => a + Math.PI / 3);
  const ventPos = vents.map((a) => new THREE.Vector3(Math.cos(a) * 0.72, Math.sin(a) * 0.72, 6.2));
  const shells: THREE.BufferGeometry[] = [at(tube(0.5, 0.8, 9, 0.44), 0, 0, 6.55)];
  const inners: THREE.BufferGeometry[] = [flip(at(tube(0.46, 0.78, 9, 0.4), 0, 0, 6.55))];
  for (const p of ventPos) {
    shells.push(at(tube(0.26, 0.5, 6, 0.24), p.x, p.y, p.z - 0.25));
    inners.push(flip(at(tube(0.23, 0.48, 6, 0.21), p.x, p.y, p.z - 0.25)));
  }
  root.add(new THREE.Mesh(mergeGeometries(shells), m.metal), new THREE.Mesh(mergeGeometries(inners), m.dark));

  const tipAt = (a: number) => {
    const last = BLADE[BLADE.length - 1];
    const span = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const up = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
    return span.multiplyScalar(BLADE_ROOT + last.s).addScaledVector(up, last.lift).setZ((last.le + last.te) / 2);
  };

  return {
    root,
    nozzles: [{ pos: new THREE.Vector3(0, 0, 6.95), r: 0.42 }, ...ventPos.map((p) => ({ pos: p.clone(), r: 0.22 }))],
    wingtips: [tipAt(BLADE_ANGLES[1]), tipAt(BLADE_ANGLES[2])],
    guns: [new THREE.Vector3(0, 0.95, -5.0), new THREE.Vector3(-0.82, -0.48, -5.0), new THREE.Vector3(0.82, -0.48, -5.0)],
    cockpit: new THREE.Vector3(0, 0.7, -3.6),
    length: 14.0,
    radius: 6.6,
    animate(s) {
      clock.value = s.time;
      const pulse = 0.5 + 0.5 * Math.sin(s.time * 1.6);
      coreMat.emissiveIntensity = 1.4 + 1.3 * pulse + 1.0 * s.boost;
      veinMat.emissiveIntensity = 1.3 + 0.7 * (0.5 + 0.5 * Math.sin(s.time * 1.6 - 0.9)) + 0.8 * s.boost;
    },
  };
}

export const alien: JetSpec = {
  id: 'alien',
  loadout: 'orb',
  stats: { speed: 9, handling: 10, armour: 8, weapons: 9 },
  flight: flightFromStats(9, 10),
  engine: { pitch: 1.38, roar: 1.1, flame: [0.1, 0.95, 0.78] },
  build,
};
