import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { Rng } from '../core/rng';
import { BRIDGE_DECK, densityAt, RIVER_HALF, riverX, type CityData } from './cityGen';

export const pointScale = { value: 800 };
export const screenSize = { value: new THREE.Vector2(1600, 900) };

export function updatePointScale(camera: THREE.PerspectiveCamera, drawingBufferHeight: number) {
  pointScale.value = drawingBufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  screenSize.value.set(drawingBufferHeight * camera.aspect, drawingBufferHeight);
}

const vertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute vec2 aBlink;
#ifdef MOVING
attribute vec3 aDir;
attribute vec3 aMove;
#endif
uniform float uPointScale;
uniform float uMinPx;
uniform float uExtraHaze;
varying vec3 vColor;
varying vec3 vHalo;
varying float vSpread;
${GLSL_COMMON}
void main() {
  vec3 p = position;
  float fade = 1.0;
#ifdef MOVING
  float along = mod(aMove.z + uTime * aMove.y, aMove.x);
  p += aDir * along;
  fade = smoothstep(0.0, 20.0, along) * smoothstep(0.0, 20.0, aMove.x - along);
#endif
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * wp;
#ifdef POWERED
  fade *= cityPower(wp.xz);
#endif
  float T = fogTransmittance(wp.xyz) * exp(-length(wp.xyz - cameraPosition) * uExtraHaze);
  float scatter = (1.0 - T) * uHalo;
  float spread = 1.0 + 2.5 * scatter;
  float px = aSize * spread * uPointScale / max(-mv.z, 0.1);
  float size = max(px, uMinPx);
  float energy = (px * px) / (size * size);
  vSpread = spread;
  float blink = 1.0;
  if (aBlink.x > 0.0) {
    float ph = fract(uTime / aBlink.x + aBlink.y);
    blink = 0.04 + 0.96 * smoothstep(0.0, 0.03, ph) * smoothstep(0.22, 0.12, ph);
  }
  vColor = aColor * energy * blink * fade * T;
  vHalo = aColor * energy * blink * fade * scatter * 0.16;
  gl_PointSize = min(size, 256.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vColor;
varying vec3 vHalo;
varying float vSpread;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  float core = exp(-r2 * vSpread * vSpread * 5.0) - 0.0067;
  float halo = exp(-r2 * 3.0) - 0.05;
  gl_FragColor = vec4(vColor * max(core, 0.0) + vHalo * max(halo, 0.0), 1.0);
}
`;

export interface GlowPointsInput {
  positions: number[];
  colors: number[];
  sizes: number[];
  blink?: number[];
  moving?: { dir: number[]; move: number[] };
  minPx?: number;
  // Mains-powered lights that go dark in a blackout district.
  powered?: boolean;
  // Extra fading per metre, for lights on something so large and far that it sits in the city's haze.
  haze?: number;
}

export function makeGlowPoints(input: GlowPointsInput): THREE.Points {
  const g = new THREE.BufferGeometry();
  const count = input.positions.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(input.positions, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(input.colors, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(input.sizes, 1));
  g.setAttribute('aBlink', new THREE.Float32BufferAttribute(input.blink ?? new Array(count * 2).fill(0), 2));
  if (input.moving) {
    g.setAttribute('aDir', new THREE.Float32BufferAttribute(input.moving.dir, 3));
    g.setAttribute('aMove', new THREE.Float32BufferAttribute(input.moving.move, 3));
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uPointScale: pointScale, uMinPx: { value: input.minPx ?? 1.6 }, uExtraHaze: { value: input.haze ?? 0 } },
    vertexShader,
    fragmentShader,
    defines: { ...(input.moving ? { MOVING: '' } : {}), ...(input.powered ? { POWERED: '' } : {}) },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = !input.moving;
  if (input.moving) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return pts;
}

export function buildStreetLamps(city: CityData): THREE.Points {
  const { lamps } = city;
  const colors: number[] = [];
  const sizes: number[] = [];
  const rng = new Rng(77);
  for (let i = 0; i < lamps.length; i += 3) {
    const low = lamps[i + 1] < 6;
    const k = rng.range(0.8, 1.2);
    if (low) colors.push(1.4 * k, 1.1 * k, 0.75 * k);
    else colors.push(3.2 * k, 1.5 * k, 0.45 * k);
    sizes.push(low ? 2.2 : 3.6);
  }
  return makeGlowPoints({ positions: lamps, colors, sizes, powered: true });
}

export function buildTraffic(city: CityData): THREE.Points {
  const rng = new Rng(4242);
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const dir: number[] = [];
  const move: number[] = [];
  for (const r of city.roads) {
    const len = Math.hypot(r.b - r.a, r.yb - r.ya);
    const dx = (r.b - r.a) / len;
    const dy = (r.yb - r.ya) / len;
    const mid = r.dir === 'x' ? densityAt((r.a + r.b) / 2, r.c) : densityAt(r.c, (r.a + r.b) / 2);
    const spacing = 55 - 30 * Math.min(mid * 1.4, 1);
    for (const lane of [-1, 1]) {
      const n = Math.floor(len / spacing);
      const off = lane * r.width * 0.22;
      const sx = r.dir === 'x' ? (lane > 0 ? r.a : r.b) : r.c + off;
      const sz = r.dir === 'x' ? r.c + off : lane > 0 ? r.a : r.b;
      const sy = (lane > 0 ? r.ya : r.yb) + 0.8;
      const ddx = r.dir === 'x' ? dx * lane : 0;
      const ddz = r.dir === 'x' ? 0 : dx * lane;
      const ddy = dy * lane;
      for (let k = 0; k < n; k++) {
        if (rng.chance(0.25)) continue;
        const phase = rng.range(0, len);
        const speed = rng.range(8, 16);
        const car = [
          { back: 0, col: [2.6, 2.3, 1.8], size: 1.7 },
          { back: -4.4, col: [2.4, 0.12, 0.05], size: 1.3 },
        ];
        for (const c of car) {
          positions.push(sx, sy, sz);
          dir.push(ddx, ddy, ddz);
          move.push(len, speed, (phase + c.back + len) % len);
          colors.push(...c.col);
          sizes.push(c.size);
        }
      }
    }
  }
  return makeGlowPoints({ positions, colors, sizes, moving: { dir, move }, minPx: 1.3 });
}

export function buildAviationLights(city: CityData): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  const sizes: number[] = [];
  const blink: number[] = [];
  const rng = new Rng(9);
  const add = (x: number, y: number, z: number, size: number, period: number, phase: number, white = false) => {
    positions.push(x, y, z);
    colors.push(...(white ? [6, 6, 7] : [7, 0.35, 0.15]));
    sizes.push(size);
    blink.push(period, phase);
  };
  for (const b of city.buildings) {
    if (b.tip < 110) continue;
    const phase = rng.next();
    add(b.x, b.tip + 1.5, b.z, 5, 1.6, phase);
    if (b.tip > 250) {
      const t = b.tiers[b.tiers.length - 1];
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        add(b.x + (sx * t.w) / 2, b.top + 1, b.z + (sz * t.d) / 2, 3.5, 1.6, phase + 0.02);
      }
      if (b.crown === 'antenna') add(b.x, b.top + (b.tip - b.top) * 0.5, b.z, 3.5, 1.6, phase + 0.05);
    }
  }
  for (const br of city.bridges) {
    if (!br.suspension) continue;
    const rx = riverX(br.z);
    for (const tx of [rx - RIVER_HALF * 0.55, rx + RIVER_HALF * 0.55]) add(tx, BRIDGE_DECK + 96, br.z, 5, 2.0, rng.next());
  }
  return makeGlowPoints({ positions, colors, sizes, blink, minPx: 1.8 });
}
