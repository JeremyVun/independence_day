import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// Low-poly jet construction kit. Conventions: metres, nose toward -Z, up +Y, right +X, origin near the centre of mass.

export type Profile = [number, number][];

const ring = (n: number, phase = 0): Profile =>
  Array.from({ length: n }, (_, i) => {
    const a = phase + (i / n) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)] as [number, number];
  });

export const PROFILES = {
  round: ring(10),
  round6: ring(6),
  oct: ring(8, Math.PI / 8),
  chine: [
    [1, 0],
    [0.62, 0.5],
    [0.22, 0.9],
    [-0.22, 0.9],
    [-0.62, 0.5],
    [-1, 0],
    [-0.7, -0.55],
    [-0.25, -0.8],
    [0.25, -0.8],
    [0.7, -0.55],
  ] as Profile,
  flat: [
    [1, 0.1],
    [0.7, 0.75],
    [0, 1],
    [-0.7, 0.75],
    [-1, 0.1],
    [-0.8, -0.7],
    [0, -0.9],
    [0.8, -0.7],
  ] as Profile,
  box: [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ] as Profile,
  diamond: [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as Profile,
  facet: [
    [1, -0.15],
    [0.55, 0.55],
    [0, 1],
    [-0.55, 0.55],
    [-1, -0.15],
    [-0.5, -0.6],
    [0.5, -0.6],
  ] as Profile,
  bubble: [
    [1, 0],
    [0.8, 0.6],
    [0.35, 0.95],
    [-0.35, 0.95],
    [-0.8, 0.6],
    [-1, 0],
  ] as Profile,
};

export interface Station {
  z: number;
  w: number;
  h: number;
  y?: number;
  x?: number;
}

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  vert(v: THREE.Vector3): number {
    this.pos.push(v.x, v.y, v.z);
    return this.pos.length / 3 - 1;
  }

  // Adds a triangle, flipping it if its normal points against the outward hint.
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hint: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() < 1e-12) return;
    const [i, j, k] = [this.vert(a), this.vert(b), this.vert(c)];
    if (n.dot(hint) >= 0) this.idx.push(i, j, k);
    else this.idx.push(i, k, j);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hint: THREE.Vector3) {
    this.tri(a, b, c, hint);
    this.tri(a, c, d, hint);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Sweeps a cross-section profile through stations ordered nose to tail.
export function loft(stations: Station[], profile: Profile = PROFILES.round, caps = { start: true, end: true }): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const rings = stations.map((s) =>
    profile.map(([px, py]) => new THREE.Vector3((s.x ?? 0) + px * s.w, (s.y ?? 0) + py * s.h, s.z)),
  );
  const centre = (s: Station) => new THREE.Vector3(s.x ?? 0, s.y ?? 0, s.z);
  for (let i = 0; i < rings.length - 1; i++) {
    const c = centre(stations[i]).add(centre(stations[i + 1])).multiplyScalar(0.5);
    for (let k = 0; k < profile.length; k++) {
      const k2 = (k + 1) % profile.length;
      const a = rings[i][k];
      const b = rings[i][k2];
      const cc = rings[i + 1][k2];
      const d = rings[i + 1][k];
      const mid = new THREE.Vector3().add(a).add(b).add(cc).add(d).multiplyScalar(0.25);
      const hint = mid.sub(c);
      hint.z = 0;
      mb.quad(a, b, cc, d, hint);
    }
  }
  const cap = (i: number, dir: number) => {
    const s = stations[i];
    if (s.w < 1e-4 && s.h < 1e-4) return;
    const c = centre(s);
    for (let k = 0; k < profile.length; k++) {
      mb.tri(c, rings[i][k], rings[i][(k + 1) % profile.length], new THREE.Vector3(0, 0, dir));
    }
  };
  if (caps.start) cap(0, -1);
  if (caps.end) cap(stations.length - 1, 1);
  return mb.geometry();
}

export interface SurfaceStation {
  s: number;
  le: number;
  te: number;
  t: number;
  lift?: number;
}

export interface SurfaceOptions {
  root: [number, number, number];
  cant?: number;
  ridge?: number;
  mirror?: boolean;
}

// Builds a lifting surface (wing, stabiliser, fin) with a faceted diamond aerofoil.
// Span runs from the root along (cos cant, sin cant); cant 0 is a wing to the right, PI/2 a vertical fin.
export function surface(stations: SurfaceStation[], opts: SurfaceOptions): THREE.BufferGeometry {
  const cant = opts.cant ?? 0;
  const ridge = opts.ridge ?? 0.4;
  const span = new THREE.Vector3(Math.cos(cant), Math.sin(cant), 0);
  const up = new THREE.Vector3(-Math.sin(cant), Math.cos(cant), 0);
  const root = new THREE.Vector3(...opts.root);
  const mb = new MeshBuilder();
  const pts = stations.map((st) => {
    const base = root.clone().addScaledVector(span, st.s).addScaledVector(up, st.lift ?? 0);
    const rz = st.le + (st.te - st.le) * ridge;
    return {
      le: base.clone().setZ(st.le),
      te: base.clone().setZ(st.te),
      top: base.clone().addScaledVector(up, st.t / 2).setZ(rz),
      bot: base.clone().addScaledVector(up, -st.t / 2).setZ(rz),
    };
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const fwd = new THREE.Vector3(0, 0, -1);
    const back = new THREE.Vector3(0, 0, 1);
    mb.quad(a.le, b.le, b.top, a.top, up.clone().add(fwd));
    mb.quad(a.top, b.top, b.te, a.te, up.clone().add(back));
    mb.quad(a.le, b.le, b.bot, a.bot, up.clone().negate().add(fwd));
    mb.quad(a.bot, b.bot, b.te, a.te, up.clone().negate().add(back));
  }
  const tip = pts[pts.length - 1];
  mb.quad(tip.le, tip.top, tip.te, tip.bot, span);
  const r0 = pts[0];
  mb.quad(r0.le, r0.top, r0.te, r0.bot, span.clone().negate());
  const g = mb.geometry();
  return opts.mirror ? mergeGeometries([g, mirrorX(g)]) : g;
}

export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.index!.array as Uint32Array | Uint16Array;
  const out = Array.from(idx);
  for (let i = 0; i < out.length; i += 3) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]];
  m.setIndex(out);
  m.computeVertexNormals();
  return m;
}

export function withMirror(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeGeometries([g, mirrorX(g)]);
}

export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of geos) {
    const base = pos.length / 3;
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    const gi = g.index ? Array.from(g.index.array) : Array.from({ length: p.length / 3 }, (_, i) => i);
    for (const i of gi) idx.push(i + base);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

export function tube(radius: number, length: number, segments = 10, radiusEnd = radius): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radiusEnd, radius, length, segments, 1, true);
  g.rotateX(Math.PI / 2);
  return g;
}

export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function at<T extends THREE.BufferGeometry>(g: T, x: number, y: number, z: number): T {
  g.translate(x, y, z);
  return g;
}

export interface Ring {
  z: number;
  pts: Profile;
}

function ringArea(pts: Profile): number {
  let a = 0;
  for (let k = 0; k < pts.length; k++) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[(k + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// Lofts explicit cross-sections (equal point counts, any shape including concave) nose to tail.
// Faces orient by each edge's outward normal, so chines, lips and blended wing roots keep correct winding.
export function loftRings(rings: Ring[], caps = { start: true, end: true }): THREE.BufferGeometry {
  const mb = new MeshBuilder();
  const n = rings[0].pts.length;
  const P = rings.map((r) => r.pts.map(([x, y]) => new THREE.Vector3(x, y, r.z)));
  for (let i = 0; i < rings.length - 1; i++) {
    const a0 = ringArea(rings[i].pts);
    const sgn = Math.sign(Math.abs(a0) > 1e-9 ? a0 : ringArea(rings[i + 1].pts));
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = P[i][k];
      const b = P[i][k2];
      const c = P[i + 1][k2];
      const d = P[i + 1][k];
      const ex = b.x - a.x + c.x - d.x;
      const ey = b.y - a.y + c.y - d.y;
      mb.quad(a, b, c, d, new THREE.Vector3(ey * sgn, -ex * sgn, 0));
    }
  }
  const cap = (i: number, dir: number) => {
    if (Math.abs(ringArea(rings[i].pts)) < 1e-6) return;
    const c = P[i].reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / n);
    for (let k = 0; k < n; k++) mb.tri(c, P[i][k], P[i][(k + 1) % n], new THREE.Vector3(0, 0, dir));
  };
  if (caps.start) cap(0, -1);
  if (caps.end) cap(rings.length - 1, 1);
  return mb.geometry();
}

// Inward-facing lining for an open duct: the given rings shrunk toward their centres, faces flipped so the tunnel reads dark.
export function innerWall(rings: Ring[], inset = 0.94): THREE.BufferGeometry {
  const shrunk = rings.map(({ z, pts }) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { z, pts: pts.map(([x, y]) => [cx + (x - cx) * inset, cy + (y - cy) * inset] as [number, number]) };
  });
  return flip(loftRings(shrunk, { start: false, end: false }));
}

// Closes a left-right symmetric cross-section from its right half, listed from top centre down to bottom centre (both on x = 0).
export function symRing(half: Profile): Profile {
  return [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
}

// Faceted convex hull of a point cloud; ideal for stealth facets, canopies, pods and pylons.
export function convex(points: [number, number, number][]): THREE.BufferGeometry {
  const hull = new ConvexGeometry(points.map((p) => new THREE.Vector3(...p)));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', hull.getAttribute('position'));
  out.setIndex(Array.from({ length: hull.getAttribute('position').count }, (_, i) => i));
  out.computeVertexNormals();
  return out;
}

// Closed cylinder from a to b (antennas, pitots, gun barrels, glowing seams).
export function rod(a: [number, number, number], b: [number, number, number], r: number, segments = 4, rEnd = r): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const g = new THREE.CylinderGeometry(rEnd, r, dir.length(), segments, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}

// Frame hoop following a profile placed at a station (canopy bows, intake lips).
export function hoop(profile: Profile, st: Station, r: number, closed = false): THREE.BufferGeometry {
  const pts = profile.map(([px, py]) => [(st.x ?? 0) + px * st.w, (st.y ?? 0) + py * st.h, st.z] as [number, number, number]);
  const n = closed ? pts.length : pts.length - 1;
  return mergeGeometries(Array.from({ length: n }, (_, i) => rod(pts[i], pts[(i + 1) % pts.length], r, 4)));
}

// Reverses triangle winding in place, e.g. to show the inside of a nozzle or intake tube.
export function flip<T extends THREE.BufferGeometry>(g: T): T {
  const idx = Array.from(g.index!.array);
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  g.setIndex(idx);
  return g;
}

// Moves every vertex through fn (rake intake lips, droop noses, bend blades).
export function warp<T extends THREE.BufferGeometry>(g: T, fn: (v: THREE.Vector3) => void): T {
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    fn(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// Air-to-air missile along Z centred at (x, y, z): pointed nose, body and cruciform tail fins.
export function missile(length: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const front = z - length / 2;
  const back = z + length / 2;
  const noseEnd = front + length * 0.13;
  const finZ = back - length * 0.09;
  const span = r * 5.4;
  return mergeGeometries([
    rod([x, y, front], [x, y, noseEnd], 0.001, 6, r),
    rod([x, y, noseEnd], [x, y, back], r, 6),
    boxAt(span, r * 0.22, length * 0.13, x, y, finZ),
    boxAt(r * 0.22, span, length * 0.13, x, y, finZ),
  ]);
}

// Engine nozzle whose exit face sits at exitZ: metal outer shell plus dark inner wall and turbine face.
export function nozzle(x: number, y: number, exitZ: number, rFront: number, rExit: number, length: number, segments = 12) {
  const zc = exitZ - length / 2;
  const face = new THREE.CircleGeometry(rExit * 0.9, segments);
  face.translate(x, y, exitZ - length * 0.75);
  return {
    metal: at(tube(rFront, length, segments, rExit), x, y, zc),
    dark: mergeGeometries([flip(at(tube(rFront * 0.94, length * 0.98, segments, rExit * 0.93), x, y, zc)), face]),
  };
}

// Splits faces into [matching, rest] by centroid and outward normal; used for two-tone paint and camouflage.
export function splitFaces(
  g: THREE.BufferGeometry,
  pred: (centroid: THREE.Vector3, normal: THREE.Vector3) => boolean,
): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const p = g.attributes.position;
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
  const outs = [
    { pos: [] as number[], idx: [] as number[] },
    { pos: [] as number[], idx: [] as number[] },
  ];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cen = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]);
    b.fromBufferAttribute(p, idx[i + 1]);
    c.fromBufferAttribute(p, idx[i + 2]);
    cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    nrm.subVectors(b, a).cross(e.subVectors(c, a)).normalize();
    const o = outs[pred(cen, nrm) ? 0 : 1];
    for (const v of [a, b, c]) {
      o.pos.push(v.x, v.y, v.z);
      o.idx.push(o.pos.length / 3 - 1);
    }
  }
  return outs.map((o) => {
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3));
    out.setIndex(o.idx);
    out.computeVertexNormals();
    return out;
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];
}
