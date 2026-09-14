import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { CITY_HALF, MAP_HALF, type Building, type CityData, type Shape } from './cityGen';

const CHUNK = 750;

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  facade: number[] = [];
  info: number[] = [];
  crown: number[] = [];
  idx: number[] = [];
  curInfo: [number, number, number, number] = [0, 0, 0, 0];
  curCrown: [number, number, number, number] = [0, 0, 0, 0];

  private vert(x: number, y: number, z: number, n: THREE.Vector3, fu: number, fv: number, fl: number) {
    this.pos.push(x, y, z);
    this.nrm.push(n.x, n.y, n.z);
    this.facade.push(fu, fv, fl);
    this.info.push(...this.curInfo);
    this.crown.push(...this.curCrown);
    return this.pos.length / 3 - 1;
  }

  quad(p: THREE.Vector3[], n: THREE.Vector3, f: [number, number][], flag: number) {
    const i = p.map((v, k) => this.vert(v.x, v.y, v.z, n, f[k][0], f[k][1], flag));
    this.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  tri(p: THREE.Vector3[], flag: number) {
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
    const i = p.map((v) => this.vert(v.x, v.y, v.z, n, v.x, v.z, flag));
    this.idx.push(i[0], i[1], i[2]);
  }

  polygon(pts: [number, number][], y: number, up: boolean, flag: number) {
    const n = new THREE.Vector3(0, up ? 1 : -1, 0);
    const base = this.pos.length / 3;
    for (const [x, z] of pts) this.vert(x, y, z, n, x, z, flag);
    for (let k = 1; k < pts.length - 1; k++) {
      if (up) this.idx.push(base, base + k + 1, base + k);
      else this.idx.push(base, base + k, base + k + 1);
    }
  }

  prism(pts: [number, number][], y0: number, y1: number, cx: number, cz: number, top: boolean, bottom: boolean) {
    const nPts = pts.length;
    for (let k = 0; k < nPts; k++) {
      const [ax, az] = pts[k];
      const [bx, bz] = pts[(k + 1) % nPts];
      const len = Math.hypot(bx - ax, bz - az);
      const n = new THREE.Vector3(bz - az, 0, -(bx - ax)).normalize();
      if (n.x * ((ax + bx) / 2 - cx) + n.z * ((az + bz) / 2 - cz) < 0) n.negate();
      const outward = n.x * (bz - az) - n.z * (bx - ax) < 0;
      const [p0, p1] = outward ? [[ax, az], [bx, bz]] : [[bx, bz], [ax, az]];
      this.quad(
        [
          new THREE.Vector3(p0[0], y0, p0[1]),
          new THREE.Vector3(p1[0], y0, p1[1]),
          new THREE.Vector3(p1[0], y1, p1[1]),
          new THREE.Vector3(p0[0], y1, p0[1]),
        ],
        n,
        [
          [0, y0],
          [len, y0],
          [len, y1],
          [0, y1],
        ],
        len,
      );
    }
    if (top) this.polygon(pts, y1, true, -1);
    if (bottom) this.polygon(pts, y0, false, -1);
  }

  cone(pts: [number, number][], y0: number, apex: THREE.Vector3, flag: number) {
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      const va = new THREE.Vector3(a[0], y0, a[1]);
      const vb = new THREE.Vector3(b[0], y0, b[1]);
      const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(apex, va));
      const mid = new THREE.Vector3((a[0] + b[0]) / 2 - apex.x, 0, (a[1] + b[1]) / 2 - apex.z);
      this.tri(n.dot(mid) >= 0 ? [va, vb, apex] : [vb, va, apex], flag);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aFacade', new THREE.Float32BufferAttribute(this.facade, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aCrown', new THREE.Float32BufferAttribute(this.crown, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function footprint(shape: Shape, cx: number, cz: number, w: number, d: number): [number, number][] {
  const hw = w / 2;
  const hd = d / 2;
  if (shape === 'box') {
    return [
      [cx - hw, cz - hd],
      [cx + hw, cz - hd],
      [cx + hw, cz + hd],
      [cx - hw, cz + hd],
    ];
  }
  if (shape === 'chamfer') {
    const c = Math.min(w, d) * 0.2;
    return [
      [cx - hw + c, cz - hd],
      [cx + hw - c, cz - hd],
      [cx + hw, cz - hd + c],
      [cx + hw, cz + hd - c],
      [cx + hw - c, cz + hd],
      [cx - hw + c, cz + hd],
      [cx - hw, cz + hd - c],
      [cx - hw, cz - hd + c],
    ];
  }
  const n = shape === 'hex' ? 6 : 16;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (shape === 'hex' ? Math.PI / 6 : 0);
    out.push([cx + Math.cos(a) * hw, cz + Math.sin(a) * hd]);
  }
  return out;
}

function addBuilding(g: GeoBuilder, b: Building) {
  g.curCrown = b.crownColor ? [...b.crownColor, b.crownStart] : [0, 0, 0, 0];
  let prevArea = Infinity;
  b.tiers.forEach((t, i) => {
    g.curInfo = [b.seed, b.style, b.lit, t.y1];
    const pts = footprint(t.shape, b.x, b.z, t.w, t.d);
    const area = t.w * t.d;
    g.prism(pts, t.y0, t.y1, b.x, b.z, true, i > 0 && area > prevArea);
    prevArea = area;
  });
  const top = b.tiers[b.tiers.length - 1];
  const topPts = footprint(top.shape, b.x, b.z, top.w, top.d);
  g.curInfo = [b.seed, b.style, b.lit, b.top];
  if (b.crown === 'pyramid') {
    g.cone(topPts, b.top, new THREE.Vector3(b.x, b.tip, b.z), -2);
  } else if (b.crown === 'spire') {
    const r = Math.min(top.w, top.d) * 0.2;
    g.cone(footprint('hex', b.x, b.z, r * 2, r * 2), b.top, new THREE.Vector3(b.x, b.tip, b.z), -2);
  } else if (b.crown === 'antenna') {
    g.prism(footprint('box', b.x, b.z, 4, 4), b.top, b.top + 6, b.x, b.z, true, false);
    g.prism(footprint('box', b.x, b.z, 1.2, 1.2), b.top + 6, b.tip, b.x, b.z, true, false);
  }
  for (const c of b.clutter) {
    const x = b.x + c.x;
    const z = b.z + c.z;
    g.curInfo = [b.seed, b.style, 0, b.top + c.h];
    if (c.kind === 'box') {
      g.prism(footprint('box', x, z, c.w, c.d), b.top, b.top + c.h, x, z, true, false);
    } else {
      const legH = 3.5;
      for (const [lx, lz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const px = x + lx * c.w * 0.3;
        const pz = z + lz * c.w * 0.3;
        g.prism(footprint('box', px, pz, 0.4, 0.4), b.top, b.top + legH, px, pz, false, false);
      }
      const ring = footprint('cyl', x, z, c.w, c.w).filter((_, k) => k % 2 === 0);
      g.prism(ring, b.top + legH, b.top + legH + c.h, x, z, false, true);
      g.cone(ring, b.top + legH + c.h, new THREE.Vector3(x, b.top + legH + c.h + c.w * 0.35, z), -1);
    }
  }
}

const vertexShader = /* glsl */ `
attribute vec3 aFacade;
attribute vec4 aInfo;
attribute vec4 aCrown;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vFacade;
varying vec4 vInfo;
varying vec4 vCrown;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vFacade = aFacade;
  vInfo = aInfo;
  vCrown = aCrown;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uCityMap;
uniform float uMapHalf;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vFacade;
varying vec4 vInfo;
varying vec4 vCrown;
${GLSL_COMMON}

void styleParams(float s, out vec2 pitch, out vec2 size, out vec3 wall) {
  if (s < 0.5) { pitch = vec2(3.2, 3.8); size = vec2(0.8, 0.6); wall = vec3(0.05, 0.05, 0.056); }
  else if (s < 1.5) { pitch = vec2(3.6, 3.1); size = vec2(0.42, 0.55); wall = vec3(0.07, 0.042, 0.032); }
  else if (s < 2.5) { pitch = vec2(1.6, 3.9); size = vec2(0.94, 0.72); wall = vec3(0.018, 0.026, 0.04); }
  else { pitch = vec2(2.6, 3.5); size = vec2(0.46, 0.58); wall = vec3(0.085, 0.072, 0.06); }
}

// What dark glass mirrors: sky above, the lit windows of neighbouring towers near the horizon,
// sodium-lit streets below, and the ship's core.
vec3 glassReflection(vec3 r, vec3 wpos) {
  vec3 col = fogColorFor(r);
  vec2 cell = vec2(atan(r.z, r.x) * 42.0, r.y * 58.0);
  vec2 ci = floor(cell);
  vec2 cf = fract(cell) - 0.5;
  float band = smoothstep(0.38, 0.04, r.y) * smoothstep(-0.5, -0.1, r.y);
  float lit = step(0.76, hash12(ci + 17.0)) * band;
  float pane = smoothstep(0.5, 0.15, max(abs(cf.x), abs(cf.y) * 1.3));
  col += (hash12(ci + 3.0) < 0.62 ? vec3(1.0, 0.72, 0.42) : vec3(0.7, 0.85, 1.0)) * lit * pane * 0.4;
  col += vec3(1.0, 0.52, 0.18) * 0.06 * smoothstep(0.0, -0.45, r.y);
  vec3 toCore = normalize(uShipLightPos - wpos);
  col += uShipLightColor * (pow(max(dot(r, toCore), 0.0), 90.0) * 30.0 + pow(max(dot(r, toCore), 0.0), 8.0) * 1.5);
  return col;
}

vec3 windowColor(float s, float r) {
  if (s < 0.5) return r < 0.5 ? vec3(0.78, 0.9, 1.0) : r < 0.85 ? vec3(1.0, 0.82, 0.58) : vec3(1.0, 0.7, 0.42);
  if (s < 1.5) return r < 0.08 ? vec3(0.45, 0.6, 1.0) : r < 0.6 ? vec3(1.0, 0.66, 0.36) : vec3(1.0, 0.84, 0.6);
  if (s < 2.5) return r < 0.8 ? vec3(0.72, 0.88, 1.0) : vec3(1.0, 0.9, 0.75);
  return r < 0.75 ? vec3(1.0, 0.76, 0.44) : vec3(1.0, 0.9, 0.7);
}

void main() {
  vec3 n = normalize(vNormal);
  float seed = vInfo.x;
  float style = vInfo.y;
  float litFrac = vInfo.z;
  float tierTop = vInfo.w;

  vec3 light = vec3(0.012, 0.016, 0.03) * (0.55 + 0.45 * n.y)
    + vec3(0.05, 0.032, 0.02) * (0.6 - 0.4 * n.y)
    + vec3(0.06, 0.07, 0.1) * max(dot(n, uMoonDir), 0.0);
  vec2 muv = (vWorld.xz + n.xz * 5.0 + uMapHalf) / (2.0 * uMapHalf);
  float lamp = texture2D(uCityMap, muv).a;
  float power = cityPower(vWorld.xz);
  light += vec3(1.0, 0.5, 0.16) * lamp * 1.1 * exp(-max(vWorld.y - 2.0, 0.0) / 12.0) * power;
  light += shipLight(vWorld, n) + dynLight(vWorld, n);

  vec2 pitch, wsize;
  vec3 wall;
  styleParams(style, pitch, wsize, wall);
  vec3 col;

  if (vFacade.z > 0.0) {
    float usable = vFacade.z - mod(vFacade.z, pitch.x);
    float u = vFacade.x - (vFacade.z - usable) * 0.5;
    float v = vFacade.y - 4.6;
    vec2 p = vec2(u, v) / pitch;
    vec2 id = floor(p);
    vec2 f = fract(p);
    vec2 fw = max(fwidth(p), vec2(1e-4));
    vec2 lo = 0.5 - wsize * 0.5;
    vec2 hi = 0.5 + wsize * 0.5;
    vec2 cov = clamp((min(f + fw * 0.5, hi) - max(f - fw * 0.5, lo)) / fw, 0.0, 1.0);
    float valid = step(0.0, u) * step(u, usable) * step(0.0, v) * step(vFacade.y, tierTop - 2.0);
    float mask = cov.x * cov.y * valid;

    float floorRnd = hash12(vec2(id.y, seed * 113.0));
    float floorBias = floorRnd < 0.1 ? 2.4 : floorRnd < 0.32 ? 0.2 : 1.0;
    float h = hash12(id + seed * 517.0);
    float isLit = step(h, litFrac * floorBias);
    float epoch = floor(uTime / 19.0 + hash12(id * 1.7 + seed) * 40.0);
    if (hash12(id + epoch * 0.37) < 0.025) isLit = 1.0 - isLit;
    // In a blackout a few rooms keep a dim, warm light from candles or generators.
    float backup = step(0.955, hash12(id * 9.1 + seed * 3.7));
    isLit = max(isLit * power, backup * (1.0 - power));
    vec3 wc = mix(vec3(1.0, 0.55, 0.25), windowColor(style, hash12(id * 3.1 + seed * 7.0)), power);
    float inten = mix(0.55, 1.7, pow(hash12(id * 5.3 + seed), 1.8)) * mix(0.3, 1.0, power);
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(view, n), 0.0), 4.0);
    float detail = clamp(1.0 - max(fw.x, fw.y) * 5.0, 0.0, 1.0);
    vec3 paneN = normalize(n + (vec3(hash12(id + 1.3), hash12(id + 4.1), hash12(id + 8.7)) - 0.5) * 0.07 * detail);
    vec3 glass = vec3(0.003, 0.004, 0.008) + light * 0.035 + glassReflection(reflect(-view, paneN), vWorld) * (0.2 + 1.1 * fres);
    vec2 wf = clamp((f - lo) / (hi - lo), 0.0, 1.0);
    float kind = hash12(id * 7.7 + seed * 3.0);
    float interior = 0.72 + 0.4 * wf.y;
    if (kind < 0.3) interior *= mix(0.78, 0.55 + 0.45 * step(0.45, fract(wf.y * 8.0)), detail);
    else if (kind < 0.42) interior *= mix(0.8, 0.45 + 0.55 * smoothstep(0.18, 0.32, abs(wf.x - 0.5)), detail);
    if (wsize.x > 0.6) interior *= mix(1.0, mix(0.96, step(0.04, abs(wf.x - 0.5)), detail), 1.0);
    vec3 near = mix(glass, wc * inten * interior, isLit);

    float area = wsize.x * wsize.y;
    float block = hash12(vec2(floor(id.x / 3.0), id.y) + seed * 31.0);
    float farLit = clamp(litFrac * floorBias * (0.3 + 1.4 * block), 0.0, 1.0) * mix(0.06, 1.0, power);
    vec3 far = mix(glass, windowColor(style, block) * 0.75, farLit) * valid;
    float farK = smoothstep(0.35, 1.0, max(fw.x, fw.y));

    vec3 tint = mix(vec3(1.0), hash12(vec2(seed, 5.0)) < 0.5 ? vec3(1.08, 0.97, 0.88) : vec3(0.9, 0.97, 1.08), 0.6);
    // Weathering up close: rain streaks under each column of windows and slightly mismatched panels.
    float streak = vnoise(vec2(vFacade.x * 0.4, vFacade.y * 0.025 + seed * 40.0));
    float panelShade = hash12(vec2(floor(vFacade.x / (pitch.x * 2.0)), floor(vFacade.y / (pitch.y * 4.0))) + seed * 13.0);
    float weather = mix(1.0, 0.8 + 0.28 * streak + 0.12 * panelShade, detail);
    vec3 baseWall = wall * tint * (0.8 + 0.4 * hash12(vec2(seed, 9.0))) * weather * light * (1.0 - 0.3 * uWet);
    float frame = 1.0 - step(0.05, wf.x) * step(wf.x, 0.95) * step(0.06, wf.y) * step(wf.y, 0.94);
    near = mix(near, baseWall * 0.7, frame * detail);
    baseWall += fogColorFor(reflect(-view, n)) * (0.15 + 1.2 * fres) * uWet * 0.5;
    col = mix(baseWall * (1.0 - mask) + near * mask, baseWall * (1.0 - area * valid) + far * area, farK);

    if (style > 1.5 && style < 2.5) {
      vec3 view = normalize(cameraPosition - vWorld);
      float fr = pow(1.0 - max(dot(view, n), 0.0), 5.0);
      col += fr * uFogLow * 1.6 * (1.0 - mask * isLit);
    }

    if (vWorld.y < 4.4 && style < 0.5 || (style > 2.5 && vWorld.y < 4.4)) {
      float shop = step(0.4, hash12(vec2(floor(vFacade.x / 6.5), seed * 91.0))) * power;
      float band = step(0.7, vWorld.y) * step(vWorld.y, 3.6);
      col = mix(col, vec3(1.0, 0.78, 0.5) * 1.05 * shop + baseWall * (1.0 - shop), band);
    }

    float faceId = hash13(vec3(seed * 97.0, vFacade.z, n.x * 3.0 + n.z * 7.0));
    if ((style < 0.5 || style > 2.5) && faceId < 0.16 && vFacade.z > 14.0) {
      float sw = 6.0 + 9.0 * hash12(vec2(faceId, 3.0));
      vec2 sp = vec2(vFacade.x - (vFacade.z - sw) * hash12(vec2(faceId, 5.3)), vFacade.y - (5.2 + 3.6 * floor(hash12(vec2(faceId, 9.1)) * 3.0)));
      float sh = 2.2 + 2.4 * hash12(vec2(faceId, 13.7));
      if (sp.x > 0.0 && sp.x < sw && sp.y > 0.0 && sp.y < sh) {
        float pick = hash12(vec2(faceId, 21.0));
        vec3 sc = pick < 0.22 ? vec3(1.0, 0.12, 0.18) : pick < 0.42 ? vec3(0.15, 0.85, 1.0) : pick < 0.6 ? vec3(1.0, 0.2, 0.75) : pick < 0.82 ? vec3(1.0, 0.55, 0.12) : vec3(0.3, 1.0, 0.45);
        float edge = min(min(sp.x, sw - sp.x), min(sp.y, sh - sp.y));
        float tube = smoothstep(0.32, 0.1, edge);
        vec2 cell = floor(sp / vec2(0.85, max(sh - 0.8, 0.5) / 2.0));
        float letters = step(0.45, hash12(cell + faceId * 50.0)) * step(0.4, sp.x) * step(sp.x, sw - 0.4) * step(0.4, sp.y) * step(sp.y, sh - 0.4);
        float flicker = hash12(vec2(faceId, floor(uTime * 12.0))) < 0.04 && hash12(vec2(faceId, 2.0)) < 0.3 ? 0.2 : 1.0;
        col = col * 0.25 + sc * (tube * 3.2 + letters * 1.6 + 0.12) * flicker * power;
      }
    }
  } else {
    float grit = 0.75 + 0.5 * vnoise(vWorld.xz * 0.4);
    col = wall * 0.7 * grit * light * (1.0 - 0.35 * uWet);
  }

  if (vCrown.a > 0.0 && vWorld.y > vCrown.a) {
    float t = vWorld.y - vCrown.a;
    float wash = vFacade.z < -1.5 ? 0.4 : exp(-t / 20.0) * 0.55 + 0.035;
    float side = 0.6 + 0.4 * abs(n.x + n.z * 0.5);
    col += vCrown.rgb * wash * side * (vFacade.z > 0.0 ? 1.0 : 0.5) * power;
  }

  gl_FragColor = vec4(nightFog(col, vWorld), 1.0);
}
`;

export function buildBuildings(city: CityData, cityMap: THREE.Texture): THREE.Group {
  const chunks = new Map<string, GeoBuilder>();
  for (const b of city.buildings) {
    const key = `${Math.floor((b.x + CITY_HALF) / CHUNK)},${Math.floor((b.z + CITY_HALF) / CHUNK)}`;
    let g = chunks.get(key);
    if (!g) chunks.set(key, (g = new GeoBuilder()));
    addBuilding(g, b);
  }
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere, uCityMap: { value: cityMap }, uMapHalf: { value: MAP_HALF } },
    vertexShader,
    fragmentShader,
  });
  const group = new THREE.Group();
  group.name = 'buildings';
  for (const g of chunks.values()) group.add(new THREE.Mesh(g.build(), material));
  return group;
}
