import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { dynLights } from '../core/dynLights';
import { pointScale } from '../world/lights';

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  r2: number;
  g2: number;
  b2: number;
  colorT: number;
  a: number;
  drag: number;
  rise: number;
}

export interface Emit {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  spread?: number;
  life: number;
  size: [number, number];
  color: [number, number, number];
  // Colour reached after `colorT` of the particle's life, e.g. smoke glowing from a fire below and then cooling.
  color2?: [number, number, number];
  colorT?: number;
  alpha?: number;
  drag?: number;
  rise?: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uPointScale;
uniform float uMaxPx;
varying vec4 vColor;
varying float vFog;
${GLSL_COMMON}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  float px = aSize * uPointScale / max(-mv.z, 0.1);
  float size = max(px, 1.5);
  vColor = aColor;
  vColor.a *= min(1.0, (px * px) / (size * size)) * smoothstep(aSize * 0.6, aSize * 2.5 + 6.0, -mv.z);
  vFog = fogTransmittance(wp.xyz);
  gl_PointSize = min(size, uMaxPx);
  gl_Position = projectionMatrix * mv;
}
`;

const fragAdditive = /* glsl */ `
varying vec4 vColor;
varying float vFog;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 14.0);
  gl_FragColor = vec4(vColor.rgb * vColor.a * a * vFog, 1.0);
}
`;

const fragSmoke = /* glsl */ `
varying vec4 vColor;
varying float vFog;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float n = h(floor(gl_PointCoord * 6.0) + vColor.a * 13.0) * 0.25;
  float a = smoothstep(1.0, 0.2 + n, r) * vColor.a;
  gl_FragColor = vec4(mix(vec3(0.02, 0.018, 0.02), vColor.rgb, vFog), a * (0.4 + 0.6 * vFog));
}
`;

export class Particles {
  readonly points: THREE.Points;
  private pool: P[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(private max: number, additive: boolean, maxPx = 512) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uPointScale: pointScale, uMaxPx: { value: maxPx } },
      vertexShader,
      fragmentShader: additive ? fragAdditive : fragSmoke,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  emit(e: Emit, count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.pool.length >= this.max) this.pool.shift();
      const sp = e.spread ?? 0;
      const v = e.vel ?? new THREE.Vector3();
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(1 - u * u);
      const m = sp * (0.3 + 0.7 * Math.random());
      this.pool.push({
        x: e.pos.x,
        y: e.pos.y,
        z: e.pos.z,
        vx: v.x + Math.cos(th) * rr * m,
        vy: v.y + u * m,
        vz: v.z + Math.sin(th) * rr * m,
        life: e.life * (0.7 + 0.6 * Math.random()),
        age: 0,
        size0: e.size[0],
        size1: e.size[1],
        r: e.color[0],
        g: e.color[1],
        b: e.color[2],
        r2: (e.color2 ?? e.color)[0],
        g2: (e.color2 ?? e.color)[1],
        b2: (e.color2 ?? e.color)[2],
        colorT: e.colorT ?? 1,
        a: e.alpha ?? 1,
        drag: e.drag ?? 1.5,
        rise: e.rise ?? 0,
      });
    }
  }

  update(dt: number) {
    let n = 0;
    const alive: P[] = [];
    for (const p of this.pool) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.rise * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      const ck = Math.min(1, t / p.colorT);
      this.col[n * 4] = p.r + (p.r2 - p.r) * ck;
      this.col[n * 4 + 1] = p.g + (p.g2 - p.g) * ck;
      this.col[n * 4 + 2] = p.b + (p.b2 - p.b) * ck;
      this.col[n * 4 + 3] = p.a * fade;
      this.size[n] = p.size0 + (p.size1 - p.size0) * Math.sqrt(t);
      alive.push(p);
      n++;
    }
    this.pool = alive;
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aSize']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Effects {
  readonly fire = new Particles(6000, true);
  readonly smoke = new Particles(2500, false);
  readonly group = new THREE.Group();

  constructor() {
    this.group.add(this.smoke.points, this.fire.points);
  }

  explosion(pos: THREE.Vector3, scale = 1, vel = new THREE.Vector3()) {
    const v = vel.clone().multiplyScalar(0.3);
    dynLights.flash(pos, [16 * scale, 8 * scale, 2.5 * scale], 100 * scale, 1.1);
    this.fire.emit({ pos, vel: v, life: 0.16, size: [14 * scale, 30 * scale], color: [4.5, 3.4, 2.2], drag: 0 }, 1);
    this.fire.emit({ pos, vel: v, spread: 20 * scale, life: 0.5, size: [4 * scale, 9 * scale], color: [4.5, 3.2, 1.3], drag: 3 }, 14);
    this.fire.emit({ pos, vel: v, spread: 34 * scale, life: 0.95, size: [5 * scale, 15 * scale], color: [3.6, 1.5, 0.35], drag: 3, rise: 5 }, 34);
    this.fire.emit({ pos, vel: v, spread: 110 * scale, life: 1.3, size: [1.0, 0.3], color: [6, 3, 1], drag: 0.8, rise: -14 }, 40);
    this.smoke.emit({ pos, vel: v, spread: 14 * scale, life: 4.5, size: [10 * scale, 34 * scale], color: [0.05, 0.04, 0.04], alpha: 0.8, drag: 1.4, rise: 4 }, 16);
  }

  update(dt: number) {
    this.fire.update(dt);
    this.smoke.update(dt);
  }
}
