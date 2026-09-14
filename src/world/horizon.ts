import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { Rng } from '../core/rng';
import { makeGlowPoints } from './lights';

const MAX_GLOWS = 28;
const MAX_TRACERS = 360;

const glowVertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aSize;
attribute vec3 aColor;
varying vec2 vQ;
varying vec3 vColor;
void main() {
  vec3 toCam = cameraPosition - aCenter;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
  vec3 wp = aCenter + right * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);
  vQ = position.xy * 2.0;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// Light from fighting far beyond the city, seen as the haze and cloud base lighting up on the horizon.
const glowFragment = /* glsl */ `
varying vec2 vQ;
varying vec3 vColor;
${GLSL_COMMON}
void main() {
  float spread = 1.0 + uRain * 0.8;
  float haze = exp(-(vQ.x * vQ.x * 3.2 + vQ.y * vQ.y * 5.0) / spread);
  float core = exp(-(vQ.x * vQ.x * 60.0 + (vQ.y + 0.55) * (vQ.y + 0.55) * 90.0)) * (1.0 - uRain * 0.7);
  gl_FragColor = vec4(vColor * (haze * (0.7 + 0.5 * uCloudCover) / spread + core * 2.5), 1.0);
}
`;

interface Glow {
  pos: THREE.Vector3;
  w: number;
  h: number;
  color: [number, number, number];
  age: number;
  life: number;
  steady: boolean;
  flicker: number;
}

interface FarGun {
  pos: THREE.Vector3;
  next: number;
  burst: number;
  aim: THREE.Vector3;
}

interface Tracer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export type HorizonBoom = { distance: number; strength: number };

// The war going on elsewhere: flashes and burning districts past the horizon, and far anti-aircraft fire.
export class Horizon {
  readonly group = new THREE.Group();
  readonly booms: HorizonBoom[] = [];
  private glows: Glow[] = [];
  private geo = new THREE.InstancedBufferGeometry();
  private centers = new Float32Array(MAX_GLOWS * 3);
  private sizes = new Float32Array(MAX_GLOWS * 2);
  private colors = new Float32Array(MAX_GLOWS * 3);
  private guns: FarGun[] = [];
  private tracers: Tracer[] = [];
  private tracerPoints: THREE.Points;
  private rng = new Rng(1997);
  private nextFlash = 2;

  constructor() {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
      const d = this.rng.range(15000, 21000);
      this.glows.push({
        pos: new THREE.Vector3(Math.cos(a) * d, this.rng.range(250, 500), Math.sin(a) * d),
        w: this.rng.range(3000, 5200),
        h: this.rng.range(900, 1500),
        color: [0.2, 0.075, 0.02],
        age: 0,
        life: Infinity,
        steady: true,
        flicker: this.rng.range(0, 10),
      });
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    this.geo.index = plane.index;
    this.geo.setAttribute('position', plane.getAttribute('position'));
    this.geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.sizes, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    const glows = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: { ...atmosphere },
        vertexShader: glowVertex,
        fragmentShader: glowFragment,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    );
    glows.frustumCulled = false;
    glows.renderOrder = -5;
    glows.layers.set(1);

    for (let i = 0; i < 4; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(7500, 11500);
      this.guns.push({ pos: new THREE.Vector3(Math.cos(a) * d, 20, Math.sin(a) * d), next: this.rng.range(0, 6), burst: 0, aim: new THREE.Vector3() });
    }
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      col.push(9, 2.4, 0.7);
      size.push(9);
    }
    this.tracerPoints = makeGlowPoints({ positions: new Array(MAX_TRACERS * 3).fill(0), colors: col, sizes: size, minPx: 1.5 });
    this.tracerPoints.frustumCulled = false;
    this.group.add(glows, this.tracerPoints);
  }

  private flash(near: THREE.Vector3 | null) {
    const a = near ? Math.atan2(near.z, near.x) + this.rng.range(-0.05, 0.05) : this.rng.range(0, Math.PI * 2);
    const d = near ? near.length() + this.rng.range(-600, 600) : this.rng.range(13000, 22000);
    const big = this.rng.chance(0.15);
    const k = big ? this.rng.range(1.6, 2.6) : this.rng.range(0.5, 1.1);
    const pos = new THREE.Vector3(Math.cos(a) * d, this.rng.range(80, 260), Math.sin(a) * d);
    if (this.glows.length >= MAX_GLOWS) this.glows.splice(5, 1);
    this.glows.push({
      pos,
      w: (big ? 7000 : 3500) * this.rng.range(0.8, 1.2),
      h: (big ? 2600 : 1500) * this.rng.range(0.8, 1.2),
      color: [1.0 * k, 0.55 * k, 0.22 * k],
      age: 0,
      life: this.rng.range(0.5, 1.4) * (big ? 1.8 : 1),
      steady: false,
      flicker: 0,
    });
    this.booms.push({ distance: d, strength: k });
    return pos;
  }

  update(dt: number, time: number) {
    this.booms.length = 0;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = this.rng.range(1.5, 7);
      const first = this.flash(null);
      const ripple = this.rng.chance(0.35) ? this.rng.int(2, 4) : 0;
      for (let i = 0; i < ripple; i++) this.flash(first);
    }
    this.glows = this.glows.filter((g) => g.steady || (g.age += dt) < g.life);
    this.glows.forEach((g, i) => {
      let k: number;
      if (g.steady) k = 0.75 + 0.15 * Math.sin(time * 0.7 + g.flicker) + 0.1 * Math.sin(time * 2.3 + g.flicker * 3);
      else {
        const t = g.age / g.life;
        k = t < 0.04 ? t / 0.04 : Math.pow(1 - (t - 0.04) / 0.96, 2.2);
      }
      this.centers.set([g.pos.x, g.pos.y, g.pos.z], i * 3);
      this.sizes.set([g.w, g.h], i * 2);
      this.colors.set([g.color[0] * k, g.color[1] * k, g.color[2] * k], i * 3);
    });
    this.geo.instanceCount = this.glows.length;
    for (const name of ['aCenter', 'aSize', 'aColor']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;

    for (const g of this.guns) {
      g.next -= dt;
      if (g.next <= 0 && g.burst <= 0) {
        g.burst = this.rng.range(1.5, 4);
        g.aim.set(this.rng.range(-0.35, 0.35), 1, this.rng.range(-0.35, 0.35)).normalize();
      }
      if (g.burst > 0) {
        g.burst -= dt;
        if (g.burst <= 0) g.next = this.rng.range(3, 12);
        if (Math.random() < dt * 12 && this.tracers.length < MAX_TRACERS) {
          const d = g.aim.clone();
          d.x += Math.sin(time * 1.9 + g.pos.x) * 0.12;
          d.z += Math.cos(time * 1.3 + g.pos.z) * 0.12;
          this.tracers.push({ pos: g.pos.clone(), vel: d.normalize().multiplyScalar(700), life: 4.5 });
        }
      }
    }
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      t.vel.y -= 9.8 * dt;
      t.pos.addScaledVector(t.vel, dt);
      return t.life > 0;
    });
    const attr = this.tracerPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (t) attr.setXYZ(i, t.pos.x, t.pos.y, t.pos.z);
      else attr.setXYZ(i, 0, -5000, 0);
    }
    attr.needsUpdate = true;
  }
}
