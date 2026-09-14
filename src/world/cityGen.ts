import { Rng, clamp } from '../core/rng';

export const CITY_HALF = 3000;
export const MAP_HALF = 4096;
export const MAP_RES = 2048;
export const RIVER_HALF = 130;
export const BRIDGE_DECK = 14;
const BRIDGE_RAMP = 80;
const BANK_GAP = 18;

export const riverX = (z: number) => 1150 + 260 * Math.sin(z / 820 + 0.6) + 110 * Math.sin(z / 310 + 1.9);
export const inRiver = (x: number, z: number, margin = 0) => Math.abs(x - riverX(z)) < RIVER_HALF + margin;

export const PARK = { x0: -1250, x1: -700, z0: -1750, z1: -520 };
const inPark = (x: number, z: number, m = 0) => x > PARK.x0 - m && x < PARK.x1 + m && z > PARK.z0 - m && z < PARK.z1 + m;

export function densityAt(x: number, z: number): number {
  const g = (cx: number, cz: number, s: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
  return Math.max(g(-150, 150, 720), 0.7 * g(-760, -2150, 430), 0.62 * g(2150, 480, 400), 0.35 * g(-1900, 1500, 500));
}

export type Shape = 'box' | 'chamfer' | 'cyl' | 'hex';
export type Crown = 'flat' | 'pyramid' | 'spire' | 'antenna';

export interface Tier {
  y0: number;
  y1: number;
  w: number;
  d: number;
  shape: Shape;
}

export interface Clutter {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  kind: 'box' | 'water';
}

export interface Building {
  x: number;
  z: number;
  tiers: Tier[];
  top: number;
  tip: number;
  crown: Crown;
  crownColor: [number, number, number] | null;
  crownStart: number;
  style: number;
  seed: number;
  lit: number;
  clutter: Clutter[];
}

// dir 'x': runs along x at z = c. dir 'z': runs along z at x = c.
export interface RoadRun {
  dir: 'x' | 'z';
  c: number;
  a: number;
  b: number;
  width: number;
  ya: number;
  yb: number;
}

export interface Bridge {
  z: number;
  x0: number;
  x1: number;
  width: number;
  suspension: boolean;
}

export interface CityData {
  buildings: Building[];
  roads: RoadRun[];
  lamps: number[];
  bridges: Bridge[];
  map: Uint8Array;
}

export const WINDOW_STYLE = { office: 0, residential: 1, glass: 2, deco: 3 } as const;

const CROWN_COLORS: [number, number, number][] = [
  [1.0, 0.78, 0.5],
  [1.0, 0.78, 0.5],
  [1.0, 0.9, 0.75],
  [1.0, 0.9, 0.75],
  [0.9, 0.92, 1.0],
  [0.5, 0.72, 1.0],
  [1.0, 0.35, 0.25],
];

interface Landmark {
  x: number;
  z: number;
  foot: number;
  make: () => Omit<Building, 'x' | 'z' | 'seed'>;
}

const LANDMARKS: Landmark[] = [
  {
    x: -130,
    z: 110,
    foot: 48,
    make: () => ({
      tiers: [
        { y0: 0, y1: 55, w: 74, d: 60, shape: 'box' },
        { y0: 55, y1: 250, w: 52, d: 44, shape: 'chamfer' },
        { y0: 250, y1: 300, w: 40, d: 34, shape: 'chamfer' },
        { y0: 300, y1: 340, w: 28, d: 24, shape: 'chamfer' },
        { y0: 340, y1: 372, w: 18, d: 16, shape: 'chamfer' },
      ],
      top: 372,
      tip: 455,
      crown: 'spire',
      crownColor: [1.0, 0.8, 0.5],
      crownStart: 250,
      style: WINDOW_STYLE.deco,
      lit: 0.55,
      clutter: [],
    }),
  },
  {
    x: -560,
    z: 640,
    foot: 40,
    make: () => ({
      tiers: [
        { y0: 0, y1: 18, w: 60, d: 60, shape: 'hex' },
        { y0: 18, y1: 352, w: 22, d: 22, shape: 'cyl' },
        { y0: 352, y1: 374, w: 70, d: 70, shape: 'cyl' },
        { y0: 374, y1: 390, w: 44, d: 44, shape: 'cyl' },
        { y0: 390, y1: 440, w: 12, d: 12, shape: 'cyl' },
      ],
      top: 440,
      tip: 545,
      crown: 'antenna',
      crownColor: [0.5, 0.8, 1.0],
      crownStart: 352,
      style: WINDOW_STYLE.glass,
      lit: 0.55,
      clutter: [],
    }),
  },
  {
    x: 240,
    z: -260,
    foot: 40,
    make: () => ({
      tiers: [
        { y0: 0, y1: 30, w: 80, d: 80, shape: 'box' },
        { y0: 30, y1: 392, w: 58, d: 58, shape: 'chamfer' },
      ],
      top: 392,
      tip: 430,
      crown: 'antenna',
      crownColor: [0.4, 0.75, 1.0],
      crownStart: 360,
      style: WINDOW_STYLE.glass,
      lit: 0.45,
      clutter: [],
    }),
  },
  {
    x: 420,
    z: 420,
    foot: 36,
    make: () => ({
      tiers: [
        { y0: 0, y1: 40, w: 64, d: 64, shape: 'box' },
        { y0: 40, y1: 262, w: 48, d: 48, shape: 'box' },
      ],
      top: 262,
      tip: 305,
      crown: 'pyramid',
      crownColor: [1.0, 0.92, 0.75],
      crownStart: 240,
      style: WINDOW_STYLE.office,
      lit: 0.5,
      clutter: [],
    }),
  },
  {
    x: 2100,
    z: 470,
    foot: 40,
    make: () => ({
      tiers: [
        { y0: 0, y1: 45, w: 66, d: 66, shape: 'box' },
        { y0: 45, y1: 220, w: 46, d: 46, shape: 'chamfer' },
        { y0: 220, y1: 268, w: 34, d: 34, shape: 'chamfer' },
        { y0: 268, y1: 300, w: 22, d: 22, shape: 'chamfer' },
      ],
      top: 300,
      tip: 350,
      crown: 'spire',
      crownColor: [1.0, 0.3, 0.2],
      crownStart: 220,
      style: WINDOW_STYLE.deco,
      lit: 0.5,
      clutter: [],
    }),
  },
  {
    x: -740,
    z: -2170,
    foot: 38,
    make: () => ({
      tiers: [
        { y0: 0, y1: 25, w: 70, d: 70, shape: 'box' },
        { y0: 25, y1: 285, w: 50, d: 50, shape: 'cyl' },
      ],
      top: 285,
      tip: 320,
      crown: 'antenna',
      crownColor: [0.4, 1.0, 0.7],
      crownStart: 255,
      style: WINDOW_STYLE.glass,
      lit: 0.4,
      clutter: [],
    }),
  },
];

function lines(rng: Rng, spacing: [number, number], width: (i: number) => number) {
  const out: { c: number; w: number }[] = [];
  let c = -CITY_HALF + rng.range(0, spacing[0]);
  let i = 0;
  while (c < CITY_HALF) {
    out.push({ c, w: width(i++) });
    c += rng.range(spacing[0], spacing[1]);
  }
  return out;
}

export function generateCity(seed = 1996): CityData {
  const rng = new Rng(seed);
  const xs = lines(rng, [170, 250], (i) => (i % 3 === 1 ? 28 : 22));
  const zs = lines(rng, [72, 108], (i) => (i % 6 === 2 ? 22 : 14));

  const bridgeZs = new Set<number>();
  for (const target of [-1650, 150, 1900]) {
    let best = 0;
    for (let j = 1; j < zs.length; j++) if (Math.abs(zs[j].c - target) < Math.abs(zs[best].c - target)) best = j;
    zs[best].w = 22;
    bridgeZs.add(best);
  }

  const roads: RoadRun[] = [];
  const bridges: Bridge[] = [];
  const pushSplit = (dir: 'x' | 'z', c: number, width: number, blocked: (t: number) => boolean) => {
    let start: number | null = null;
    for (let t = -CITY_HALF; t <= CITY_HALF; t += 6) {
      const b = blocked(t);
      if (!b && start === null) start = t;
      if ((b || t + 6 > CITY_HALF) && start !== null) {
        if (t - start > 40) roads.push({ dir, c, a: start, b: t, width, ya: 0, yb: 0 });
        start = null;
      }
    }
  };

  for (const { c, w } of xs) {
    pushSplit('z', c, w, (z) => inRiver(c, z, BANK_GAP + w / 2) || inPark(c, z, -10));
  }
  zs.forEach(({ c, w }, j) => {
    if (!bridgeZs.has(j)) {
      pushSplit('x', c, w, (x) => inRiver(x, c, BANK_GAP + 6) || inPark(x, c, -10));
      return;
    }
    const rx = riverX(c);
    const x0 = rx - RIVER_HALF - BANK_GAP;
    const x1 = rx + RIVER_HALF + BANK_GAP;
    roads.push({ dir: 'x', c, a: -CITY_HALF, b: x0 - BRIDGE_RAMP, width: w, ya: 0, yb: 0 });
    roads.push({ dir: 'x', c, a: x0 - BRIDGE_RAMP, b: x0, width: w, ya: 0, yb: BRIDGE_DECK });
    roads.push({ dir: 'x', c, a: x0, b: x1, width: w, ya: BRIDGE_DECK, yb: BRIDGE_DECK });
    roads.push({ dir: 'x', c, a: x1, b: x1 + BRIDGE_RAMP, width: w, ya: BRIDGE_DECK, yb: 0 });
    roads.push({ dir: 'x', c, a: x1 + BRIDGE_RAMP, b: CITY_HALF, width: w, ya: 0, yb: 0 });
    bridges.push({ z: c, x0: x0 - BRIDGE_RAMP, x1: x1 + BRIDGE_RAMP, width: w + 6, suspension: bridges.length === 1 });
  });

  const landmarkBuildings = LANDMARKS.map((l, i) => ({ ...l.make(), x: l.x, z: l.z, seed: 0.13 + i * 0.17 }));
  const nearLandmark = (x0: number, x1: number, z0: number, z1: number) =>
    LANDMARKS.some((l) => l.x + l.foot > x0 - 6 && l.x - l.foot < x1 + 6 && l.z + l.foot > z0 - 6 && l.z - l.foot < z1 + 6);

  const buildings: Building[] = [...landmarkBuildings];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const bx0 = xs[i].c + xs[i].w / 2 + 4;
      const bx1 = xs[i + 1].c - xs[i + 1].w / 2 - 4;
      const bz0 = zs[j].c + zs[j].w / 2 + 4;
      const bz1 = zs[j + 1].c - zs[j + 1].w / 2 - 4;
      if (bx1 - bx0 < 20 || bz1 - bz0 < 16) continue;
      const corners = [
        [bx0, bz0],
        [bx1, bz0],
        [bx0, bz1],
        [bx1, bz1],
        [(bx0 + bx1) / 2, bz0],
        [(bx0 + bx1) / 2, bz1],
      ];
      if (corners.some(([x, z]) => inRiver(x, z, 30) || inPark(x, z, 8))) continue;
      subdivideBlock(rng, buildings, bx0, bx1, bz0, bz1, nearLandmark);
    }
  }

  const lamps: number[] = [];
  for (const r of roads) {
    const len = r.b - r.a;
    const n = Math.floor(len / 32);
    const off = r.width / 2 + 1.5;
    for (let k = 0; k <= n; k++) {
      const t = r.a + (len * k) / Math.max(n, 1);
      const y = r.ya + ((r.yb - r.ya) * (t - r.a)) / len;
      for (const s of [-1, 1]) {
        if (r.dir === 'x') lamps.push(t, y + 9, r.c + s * off);
        else lamps.push(r.c + s * off, y + 9, t);
      }
    }
  }
  for (let z = -CITY_HALF; z < CITY_HALF; z += 34) {
    for (const s of [-1, 1]) {
      const x = riverX(z) + s * (RIVER_HALF + 8);
      if (!inPark(x, z)) lamps.push(x, 5, z);
    }
  }
  for (let x = PARK.x0 + 40; x < PARK.x1 - 30; x += 90) {
    for (let z = PARK.z0 + 30; z < PARK.z1; z += 26) lamps.push(x + 18 * Math.sin(z / 60), 4, z);
  }
  for (let z = PARK.z0 + 60; z < PARK.z1 - 30; z += 180) {
    for (let x = PARK.x0 + 20; x < PARK.x1; x += 26) lamps.push(x, 4, z + 14 * Math.sin(x / 50));
  }

  return { buildings, roads, lamps, bridges, map: bakeMap(roads, lamps) };
}

function subdivideBlock(
  rng: Rng,
  out: Building[],
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  nearLandmark: (x0: number, x1: number, z0: number, z1: number) => boolean,
) {
  const dens = densityAt((x0 + x1) / 2, (z0 + z1) / 2);
  const w = x1 - x0;
  const d = z1 - z0;
  const big = dens > 0.45 && rng.chance(0.55);
  const lotLen = big ? rng.range(45, 80) : rng.range(20, 26 + 36 * dens);
  const nx = Math.max(1, Math.round(w / lotLen));
  const nz = d > 64 && !big ? 2 : 1;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const lx0 = x0 + (w * a) / nx + (a > 0 ? 1 : 0);
      const lx1 = x0 + (w * (a + 1)) / nx - (a < nx - 1 ? 1 : 0);
      const lz0 = z0 + (d * b) / nz + (b > 0 ? 1 : 0);
      const lz1 = z0 + (d * (b + 1)) / nz - (b < nz - 1 ? 1 : 0);
      if (nearLandmark(lx0, lx1, lz0, lz1)) continue;
      if (rng.chance(0.04) && dens < 0.5) continue;
      out.push(makeBuilding(rng, (lx0 + lx1) / 2, (lz0 + lz1) / 2, lx1 - lx0, lz1 - lz0, densityAt((lx0 + lx1) / 2, (lz0 + lz1) / 2)));
    }
  }
}

function makeBuilding(rng: Rng, x: number, z: number, w: number, d: number, dens: number): Building {
  const r1 = rng.next();
  const r2 = rng.next();
  let h = Math.max(9 + 30 * r1 * r1, Math.pow(dens, 1.3) * (55 + 360 * Math.pow(r2, 2.2)));
  if (dens < 0.2 && rng.chance(0.02)) h = rng.range(55, 130);
  h = Math.min(h, Math.min(w, d) * 9);
  h = Math.max(h, 7);

  let style: number;
  const s = rng.next();
  if (h > 150) style = s < 0.45 ? WINDOW_STYLE.office : s < 0.8 ? WINDOW_STYLE.glass : WINDOW_STYLE.deco;
  else if (h > 45) style = s < 0.5 ? WINDOW_STYLE.office : s < 0.78 ? WINDOW_STYLE.residential : WINDOW_STYLE.deco;
  else style = s < 0.6 ? WINDOW_STYLE.residential : s < 0.8 ? WINDOW_STYLE.office : WINDOW_STYLE.deco;

  const lit =
    style === WINDOW_STYLE.residential
      ? rng.range(0.12, 0.34)
      : rng.chance(0.25)
        ? rng.range(0.02, 0.07)
        : rng.range(0.1, 0.45);

  const pickShape = (): Shape => {
    const p = rng.next();
    return p < 0.62 ? 'box' : p < 0.82 ? 'chamfer' : p < 0.94 ? 'cyl' : 'hex';
  };

  const tiers: Tier[] = [];
  let crown: Crown = 'flat';
  let tip = h;
  if (h < 45) {
    tiers.push({ y0: 0, y1: h, w, d, shape: rng.chance(0.1) ? 'chamfer' : 'box' });
  } else if (h < 130) {
    const pod = rng.range(10, 22);
    const k = rng.range(0.72, 0.9);
    const shape = pickShape();
    const sw = shape === 'cyl' || shape === 'hex' ? Math.min(w, d) * k : w * k;
    const sd = shape === 'cyl' || shape === 'hex' ? sw : d * k;
    tiers.push({ y0: 0, y1: pod, w, d, shape: 'box' });
    if (rng.chance(0.4)) {
      const s1 = h * rng.range(0.7, 0.85);
      tiers.push({ y0: pod, y1: s1, w: sw, d: sd, shape });
      tiers.push({ y0: s1, y1: h, w: sw * 0.78, d: sd * 0.78, shape });
    } else tiers.push({ y0: pod, y1: h, w: sw, d: sd, shape });
  } else {
    const pod = rng.range(16, 34);
    const shape = pickShape();
    const k = rng.range(0.66, 0.84);
    let sw = Math.min(w * k, 58);
    let sd = Math.min(d * k, 58);
    if (shape === 'cyl' || shape === 'hex') sw = sd = Math.min(sw, sd);
    const s1 = h * rng.range(0.62, 0.8);
    const s2 = h * rng.range(0.84, 0.93);
    tiers.push({ y0: 0, y1: pod, w, d, shape: 'box' });
    tiers.push({ y0: pod, y1: s1, w: sw, d: sd, shape });
    tiers.push({ y0: s1, y1: s2, w: sw * 0.82, d: sd * 0.82, shape });
    tiers.push({ y0: s2, y1: h, w: sw * 0.64, d: sd * 0.64, shape });
    const c = rng.next();
    crown = c < 0.2 ? 'pyramid' : c < 0.36 ? 'spire' : c < 0.62 ? 'antenna' : 'flat';
    tip = crown === 'pyramid' ? h + sw * 0.64 * 0.55 : crown === 'spire' ? h + h * 0.14 : crown === 'antenna' ? h + h * 0.09 : h;
  }

  const top = tiers[tiers.length - 1];
  let crownColor: [number, number, number] | null = null;
  let crownStart = 0;
  if (h > 190 && rng.chance(crown === 'spire' || crown === 'pyramid' ? 0.6 : 0.2)) {
    crownColor = rng.pick(CROWN_COLORS);
    crownStart = tiers.length > 2 ? tiers[tiers.length - 2].y0 : h * 0.85;
  }

  const clutter: Clutter[] = [];
  if (crown === 'flat' && h < 200) {
    const n = rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const cw = rng.range(3, Math.min(9, top.w * 0.4));
      const cd = rng.range(3, Math.min(9, top.d * 0.4));
      clutter.push({
        x: rng.range(-top.w / 2 + cw / 2 + 1, top.w / 2 - cw / 2 - 1),
        z: rng.range(-top.d / 2 + cd / 2 + 1, top.d / 2 - cd / 2 - 1),
        w: cw,
        d: cd,
        h: rng.range(2.5, 5),
        kind: 'box',
      });
    }
    if ((style === WINDOW_STYLE.residential || style === WINDOW_STYLE.deco) && h < 90 && rng.chance(0.22)) {
      clutter.push({
        x: rng.range(-top.w / 4, top.w / 4),
        z: rng.range(-top.d / 4, top.d / 4),
        w: rng.range(5, 7),
        d: 0,
        h: rng.range(6, 8),
        kind: 'water',
      });
    }
  }

  return { x, z, tiers, top: h, tip, crown, crownColor, crownStart, style, seed: rng.next(), lit, clutter };
}

function bakeMap(roads: RoadRun[], lamps: number[]): Uint8Array {
  const N = MAP_RES;
  const texel = (2 * MAP_HALF) / N;
  const road = new Float32Array(N * N);
  const glow = new Float32Array(N * N);
  const toT = (v: number) => (v + MAP_HALF) / texel;

  for (const r of roads) {
    if (r.ya > 0 && r.yb > 0) continue;
    const hw = r.width / 2;
    const [u0, u1, v0, v1] =
      r.dir === 'x' ? [toT(r.a), toT(r.b), toT(r.c - hw), toT(r.c + hw)] : [toT(r.c - hw), toT(r.c + hw), toT(r.a), toT(r.b)];
    for (let v = Math.floor(v0); v <= Math.ceil(v1); v++) {
      const cv = clamp(Math.min(v + 1 - v0, v1 - v), 0, 1);
      for (let u = Math.floor(u0); u <= Math.ceil(u1); u++) {
        const cu = clamp(Math.min(u + 1 - u0, u1 - u), 0, 1);
        if (u >= 0 && v >= 0 && u < N && v < N) road[v * N + u] = Math.max(road[v * N + u], cu * cv);
      }
    }
  }

  const sigma = 8 / texel;
  const rad = Math.ceil(sigma * 3);
  for (let i = 0; i < lamps.length; i += 3) {
    if (lamps[i + 1] > 12) continue;
    const cu = toT(lamps[i]);
    const cv = toT(lamps[i + 2]);
    const strength = lamps[i + 1] < 6 ? 0.55 : 1;
    for (let v = Math.floor(cv - rad); v <= cv + rad; v++) {
      for (let u = Math.floor(cu - rad); u <= cu + rad; u++) {
        if (u < 0 || v < 0 || u >= N || v >= N) continue;
        const dd = (u + 0.5 - cu) ** 2 + (v + 0.5 - cv) ** 2;
        glow[v * N + u] += strength * Math.exp(-dd / (2 * sigma * sigma));
      }
    }
  }

  const out = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    out[i * 4] = Math.round(road[i] * 255);
    out[i * 4 + 3] = Math.round(clamp(glow[i] / 1.6, 0, 1) * 255);
  }
  return out;
}
