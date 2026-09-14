import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { Rng } from '../core/rng';
import { makeGlowPoints } from './lights';

// An original design: a hexagonal inverted ziggurat whose terraces step down to a hanging spire with a glowing core.

interface Tier {
  r: number;
  y0: number;
  y1: number;
  spin: number;
}

const TOP: Tier[] = [
  { r: 2800, y0: 1750, y1: 1900, spin: 0 },
  { r: 2250, y0: 1900, y1: 1960, spin: 0 },
  { r: 800, y0: 1960, y1: 2050, spin: 0 },
];
const UNDER: Tier[] = [
  { r: 2480, y0: 1660, y1: 1750, spin: 0 },
  { r: 1960, y0: 1575, y1: 1660, spin: 0.004 },
  { r: 1420, y0: 1495, y1: 1575, spin: 0 },
  { r: 880, y0: 1415, y1: 1495, spin: -0.007 },
  { r: 420, y0: 1330, y1: 1415, spin: 0 },
];
export const SHIP_CORE = new THREE.Vector3(0, 725, 0);
const SPIRE = { r0: 230, r1: 26, y0: 1330, y1: 770 };
export const MAX_BEAMS = 10;
const WISPS = 56;

const hullVertex = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocal = position;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const hullFragment = /* glsl */ `
uniform float uPulse;
uniform vec4 uBeamBase[${MAX_BEAMS}];
uniform vec3 uBeamDir[${MAX_BEAMS}];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
${GLSL_COMMON}

// Pools where the city's searchlights land on the hull. uBeamBase.w is the distance to the hit, 0 when the beam misses.
float beamPools(vec3 wpos) {
  float sum = 0.0;
  for (int i = 0; i < ${MAX_BEAMS}; i++) {
    float hit = uBeamBase[i].w;
    if (hit <= 0.0) continue;
    vec3 rel = wpos - uBeamBase[i].xyz;
    float along = dot(rel, uBeamDir[i]);
    float radius = (1.6 + 40.4 * along / 2600.0) * 1.3;
    float off = length(rel - uBeamDir[i] * along);
    float reach = smoothstep(hit + 60.0, hit + 8.0, along) * step(0.0, along);
    sum += (exp(-off * off / (radius * radius) * 1.4) + 0.25 * exp(-off * off / (radius * radius * 9.0))) * reach;
  }
  return sum;
}

void main() {
  vec3 n = normalize(vNormal);
  vec2 p = abs(n.y) > 0.5 ? vLocal.xz : vec2(atan(vLocal.z, vLocal.x) * 900.0, vLocal.y);
  float plate = hash12(floor(p / vec2(170.0, 110.0)));
  vec2 cell = p / vec2(42.0, 28.0);
  vec2 g = abs(fract(cell) - 0.5);
  float seam = smoothstep(0.46, 0.5, max(g.x, g.y));
  float panel = hash12(floor(cell));
  vec3 albedo = vec3(0.016, 0.017, 0.02) * (0.8 + 0.35 * plate + 0.08 * panel) * 18.0 * (1.0 - seam * 0.5);
  vec3 light = vec3(0.03, 0.035, 0.05) * max(n.y, 0.0)
    + vec3(0.11, 0.065, 0.035) * max(-n.y, 0.0) * (0.6 + 0.4 * exp(-length(vWorld.xz) / 3000.0))
    + vec3(0.05, 0.06, 0.08) * max(dot(n, uMoonDir), 0.0);
  light += shipLight(vWorld, n) * 4.5 + dynLight(vWorld, n);
  light += vec3(1.0, 0.95, 0.85) * 2.2 * beamPools(vWorld);
  vec3 col = albedo * light;

  float dist = length(vWorld - cameraPosition);
  float haze = (1.0 - exp(-dist * 0.00011)) * 0.8;
  float r = length(vLocal.xz);
  float wave = pow(0.5 + 0.5 * sin(r * 0.006 - uTime * 0.6), 12.0);
  float lines = step(0.93, hash12(floor(cell * vec2(0.5, 1.0)) + 3.1)) * seam;
  col += vec3(0.12, 0.9, 0.75) * lines * (0.25 + 2.5 * wave) * uPulse * (1.0 - haze * 0.6);
  float lamp = step(0.988, panel) * smoothstep(0.1, 0.05, length(fract(cell) - 0.5));
  col += vec3(1.0, 0.5, 0.18) * lamp * 1.8 * (0.6 + 0.4 * sin(uTime * 2.0 + panel * 60.0)) * step(n.y, -0.5) * (1.0 - haze * 0.6);

  // The air between the camera and the hull is lit by the city below, so distance fades the hull toward that glow.
  vec3 cityHaze = uFogLow * (0.9 + 0.6 * exp(-length(vWorld.xz) / 4000.0));
  col = mix(col, cityHaze, haze);
  gl_FragColor = vec4(nightFog(col, vWorld), 1.0);
}
`;

const wispVertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aInfo;
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vWorld;
varying float vNear;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = aInfo.x;
  vec3 wp = aCenter + (right * position.x + up * position.y * 0.45) * size;
  vUv = uv;
  vInfo = aInfo;
  vWorld = wp;
  vNear = smoothstep(size * 0.15, size * 0.6, distance(cameraPosition, aCenter));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const wispFragment = /* glsl */ `
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vWorld;
varying float vNear;
${GLSL_COMMON}
void main() {
  float seed = vInfo.y;
  vec2 q = vUv * vec2(3.2, 2.0) + seed * 23.0 + vec2(uTime * 0.006, 0.0);
  float n = vnoise(q) * 0.62 + vnoise(q * 2.3 + 5.0) * 0.38;
  float r = length((vUv - 0.5) * vec2(1.0, 1.6)) * 2.0;
  float dens = smoothstep(1.0, 0.2, r + (n - 0.5) * 1.1);
  vec3 under = vec3(0.13, 0.08, 0.052) * (0.5 + 0.9 * exp(-length(vWorld.xz) / 3500.0));
  vec3 col = under * (0.55 + 0.8 * n) * mix(1.2, 0.6, vUv.y);
  col += shipLight(vWorld, vec3(0.0, -1.0, 0.0)) * 1.4 + vec3(0.55, 0.6, 0.78) * uLightning * 1.2;
  float a = dens * vInfo.z * (0.6 + 0.4 * uCloudCover) * vNear;
  gl_FragColor = vec4(nightFog(col, vWorld), a);
}
`;

interface Wisp {
  r: number;
  a: number;
  y: number;
  size: number;
  seed: number;
  opacity: number;
  pos: THREE.Vector3;
}

function hexPrism(r: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 6, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  return g.toNonIndexed();
}

export class Mothership {
  readonly group = new THREE.Group();
  private spinning: { obj: THREE.Object3D; rate: number }[] = [];
  private coreGlow: THREE.Mesh;
  private uniforms = {
    ...atmosphere,
    uPulse: { value: 1 },
    uBeamBase: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector4()) },
    uBeamDir: { value: Array.from({ length: MAX_BEAMS }, () => new THREE.Vector3(0, 1, 0)) },
  };
  private wisps: Wisp[] = [];
  private wispGeo = new THREE.InstancedBufferGeometry();
  private wispCenters = new Float32Array(WISPS * 3);
  private wispInfos = new Float32Array(WISPS * 3);

  constructor() {
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: hullVertex, fragmentShader: hullFragment });
    const staticGeos: THREE.BufferGeometry[] = [];
    for (const t of TOP) staticGeos.push(hexPrism(t.r, t.y0, t.y1));
    for (const t of UNDER) {
      const g = hexPrism(t.r, t.y0, t.y1);
      if (t.spin) {
        const m = new THREE.Mesh(g, mat);
        m.rotation.y = Math.PI / 6;
        this.group.add(m);
        this.spinning.push({ obj: m, rate: t.spin });
      } else staticGeos.push(g);
    }
    const spire = new THREE.CylinderGeometry(SPIRE.r0, SPIRE.r1, SPIRE.y0 - SPIRE.y1, 6, 4);
    spire.translate(0, (SPIRE.y0 + SPIRE.y1) / 2, 0);
    staticGeos.push(spire.toNonIndexed());
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const keel = new THREE.BoxGeometry(1500, 70, 50);
      keel.translate(1600, 1625, 0);
      keel.rotateY(a);
      staticGeos.push(keel.toNonIndexed());
      const rib = new THREE.BoxGeometry(40, 520, 40);
      rib.translate(SPIRE.r0 * 0.7, 1080, 0);
      rib.rotateZ(0.12);
      rib.rotateY(a + Math.PI / 6);
      staticGeos.push(rib.toNonIndexed());
    }
    const merged = mergeNonIndexed(staticGeos);
    this.group.add(new THREE.Mesh(merged, mat));

    this.coreGlow = new THREE.Mesh(
      new THREE.IcosahedronGeometry(48, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 1.2) }),
    );
    this.coreGlow.position.copy(SHIP_CORE);
    this.group.add(this.coreGlow);
    this.group.add(this.lights());
    this.group.add(this.buildWisps());
  }

  // Low cloud hanging under the rim and between the terraces, slowly circling the ship.
  private buildWisps(): THREE.Mesh {
    const rng = new Rng(88);
    for (let i = 0; i < WISPS; i++) {
      const under = rng.chance(0.3);
      this.wisps.push({
        r: under ? rng.range(700, 2200) : rng.range(2100, 3500),
        a: rng.range(0, Math.PI * 2),
        y: under ? rng.range(1250, 1450) : rng.range(1420, 1760),
        size: rng.range(380, 900),
        seed: rng.next(),
        opacity: rng.range(0.22, 0.48),
        pos: new THREE.Vector3(),
      });
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    this.wispGeo.index = plane.index;
    this.wispGeo.setAttribute('position', plane.getAttribute('position'));
    this.wispGeo.setAttribute('uv', plane.getAttribute('uv'));
    this.wispGeo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.wispCenters, 3).setUsage(THREE.DynamicDrawUsage));
    this.wispGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.wispInfos, 3).setUsage(THREE.DynamicDrawUsage));
    this.wispGeo.instanceCount = WISPS;
    const mesh = new THREE.Mesh(
      this.wispGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...atmosphere },
        vertexShader: wispVertex,
        fragmentShader: wispFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.layers.set(1);
    return mesh;
  }

  setBeam(i: number, base: THREE.Vector3, dir: THREE.Vector3, hit: number | null) {
    this.uniforms.uBeamBase.value[i].set(base.x, base.y, base.z, hit ?? 0);
    this.uniforms.uBeamDir.value[i].copy(dir);
  }

  private updateWisps(time: number, camera: THREE.Vector3) {
    for (const w of this.wisps) {
      const a = w.a + time * 0.0035 * (3000 / w.r);
      w.pos.set(Math.cos(a) * w.r, w.y + 25 * Math.sin(time * 0.05 + w.seed * 20), Math.sin(a) * w.r);
    }
    const order = this.wisps.map((w, i) => [i, w.pos.distanceToSquared(camera)] as const).sort((x, y) => y[1] - x[1]);
    order.forEach(([i], k) => {
      const w = this.wisps[i];
      this.wispCenters.set([w.pos.x, w.pos.y, w.pos.z], k * 3);
      this.wispInfos.set([w.size, w.seed, w.opacity], k * 3);
    });
    (this.wispGeo.getAttribute('aCenter') as THREE.BufferAttribute).needsUpdate = true;
    (this.wispGeo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
  }

  private lights(): THREE.Points {
    const rng = new Rng(51);
    const pos: number[] = [];
    const col: number[] = [];
    const size: number[] = [];
    const blink: number[] = [];
    const hexPoint = (r: number, t: number) => {
      const side = Math.floor(t * 6);
      const f = t * 6 - side;
      const a0 = (side / 6) * Math.PI * 2;
      const a1 = ((side + 1) / 6) * Math.PI * 2;
      return [r * (Math.cos(a0) * (1 - f) + Math.cos(a1) * f), r * (Math.sin(a0) * (1 - f) + Math.sin(a1) * f)];
    };
    for (const t of [...UNDER, TOP[0]]) {
      const n = Math.floor((t.r * 6) / 30);
      for (let i = 0; i < n; i++) {
        const [x, z] = hexPoint(t.r + 2, i / n);
        pos.push(x, t.y0 - 2, z);
        const warm = rng.chance(0.08);
        col.push(...(warm ? [3, 1.6, 0.6] : [0.5, 2.6, 2.2]));
        size.push(warm ? 14 : 9);
        blink.push(0, 0);
      }
    }
    for (let i = 0; i < 1400; i++) {
      const t = rng.pick(UNDER);
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * t.r * 0.95;
      pos.push(Math.cos(a) * rr, t.y0 - 1, Math.sin(a) * rr);
      const red = rng.chance(0.15);
      col.push(...(red ? [4, 0.5, 0.25] : [2.2, 1.4, 0.7]));
      size.push(rng.range(6, 12));
      blink.push(red ? rng.range(1.5, 3) : 0, rng.next());
    }
    for (let y = SPIRE.y1 + 40; y < SPIRE.y0; y += 60) {
      const k = (y - SPIRE.y1) / (SPIRE.y0 - SPIRE.y1);
      const r = SPIRE.r1 + (SPIRE.r0 - SPIRE.r1) * k + 3;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        col.push(0.6, 3.5, 3);
        size.push(10);
        blink.push(2.4, (y / 600) % 1);
      }
    }
    for (let i = 0; i < 6; i++) {
      for (let b = 0; b < 3; b++) {
        const [x, z] = hexPoint(2800 + 4, i / 6 + (b + 1) / 24);
        pos.push(x, 1800, z);
        col.push(2.4, 4.8, 4.2);
        size.push(60);
        blink.push(0, 0);
      }
    }
    pos.push(SHIP_CORE.x, SHIP_CORE.y, SHIP_CORE.z);
    col.push(0.3, 1.45, 1.25);
    size.push(200);
    blink.push(0, 0);
    return makeGlowPoints({ positions: pos, colors: col, sizes: size, blink, minPx: 1.8, haze: 0.00009 });
  }

  update(dt: number, time: number, camera: THREE.Vector3) {
    this.updateWisps(time, camera);
    for (const s of this.spinning) s.obj.rotation.y += s.rate * dt;
    const pulse = 0.75 + 0.25 * Math.sin(time * 0.9);
    this.uniforms.uPulse.value = pulse;
    this.coreGlow.scale.setScalar(0.92 + 0.12 * pulse);
    atmosphere.uShipLightColor.value.setRGB(0.024 * pulse, 0.15 * pulse, 0.13 * pulse);
  }

  // Distance along a ray to the hull, marched coarsely; null if the ray misses.
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 6000): number | null {
    if (dir.y <= 0.05) return null;
    const p = new THREE.Vector3();
    const t0 = Math.max(0, (SPIRE.y1 - 60 - origin.y) / dir.y);
    const t1 = Math.min(maxDist, (TOP[2].y1 - origin.y) / dir.y);
    for (let t = t0; t < t1; t += 12) {
      if (this.hit(p.copy(origin).addScaledVector(dir, t), 0)) return t;
    }
    return null;
  }

  hit(p: THREE.Vector3, r: number): boolean {
    if (p.y > TOP[2].y1 + r || p.y < SPIRE.y1 - 60) return false;
    const radial = Math.hypot(p.x, p.z);
    if (p.y < SPIRE.y0) {
      if (p.distanceTo(SHIP_CORE) < 60 + r) return true;
      const k = (p.y - SPIRE.y1) / (SPIRE.y0 - SPIRE.y1);
      return radial < SPIRE.r1 + (SPIRE.r0 - SPIRE.r1) * k + r;
    }
    for (const t of [...UNDER, ...TOP]) if (p.y > t.y0 - r && p.y < t.y1 + r && radial < t.r * 0.93 + r) return true;
    return false;
  }
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nrm.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.computeBoundingSphere();
  return out;
}
