import * as THREE from 'three';
import { atmosphere, GLSL_COMMON, MAX_BLACKOUTS } from '../core/atmosphere';
import { dynLights } from '../core/dynLights';
import { Rng } from '../core/rng';
import { Particles } from '../game/particles';
import { densityAt, inRiver, PARK, type Building, type CityData } from './cityGen';
import { makeGlowPoints } from './lights';
import type { Mothership } from './mothership';

const BEAM_LEN = 2600;
const BEAM_R0 = 1.6;
const BEAM_R1 = 42;
const MAX_TRACERS = 220;
const FIRES = 5;

const beamVertex = /* glsl */ `
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorld;
void main() {
  vAlong = position.y / ${BEAM_LEN.toFixed(1)};
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Brightness follows the local haze density, so beams stand out more in rain and near the ground,
// and drifting noise fixed in world space makes each beam look like it sweeps through dust.
const beamFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlong;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorld;
${GLSL_COMMON}
void main() {
  float t = clamp(vAlong, 0.0, 1.0);
  float T = fogTransmittance(vWorld);
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float edge = pow(facing, mix(2.8, 1.3, (1.0 - T) * uHalo));
  float fall = pow(1.0 - t, 1.4) * smoothstep(0.0, 0.004, t) + exp(-t * 70.0) * 2.5;
  vec2 q = vWorld.xz * 0.011 + vec2(vWorld.y * 0.007, -vWorld.y * 0.005) + uTime * vec2(0.045, 0.02);
  float dust = 0.3 + 0.85 * vnoise(q) + 0.55 * vnoise(q * 2.9 + 7.0);
  float density = uFogDensity * exp(-uFogFalloff * max(vWorld.y, 0.0)) + uFogBase;
  float scatter = pow(clamp(density / 0.000365, 0.45, 6.0), 0.7);
  float near = smoothstep(30.0, 260.0, length(vWorld - cameraPosition));
  gl_FragColor = vec4(uColor * edge * fall * dust * scatter * near * T, 1.0);
}
`;

interface Searchlight {
  base: THREE.Vector3;
  mesh: THREE.Mesh;
  dir: THREE.Vector3;
  yaw: number;
  pitch: number;
  sweep: number;
  speed: number;
  phase: number;
}

interface Tracer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

interface Gun {
  pos: THREE.Vector3;
  next: number;
  burst: number;
  aim: THREE.Vector3;
}

interface Fire {
  pos: THREE.Vector3;
  size: number;
  acc: number;
  smokeAcc: number;
  emberAcc: number;
  flicker: number;
}

type OutagePhase = 'on' | 'failing' | 'dark' | 'restoring';

interface Outage {
  x: number;
  z: number;
  r: number;
  phase: OutagePhase;
  timer: number;
  level: number;
  tick: number;
}

export type SiegeSound = { kind: 'aa'; pos: THREE.Vector3 };

// Ambient signs of a city under siege: searchlights, anti-aircraft fire, burning rooftops,
// emergency vehicles and districts losing power.
export class Siege {
  readonly group = new THREE.Group();
  readonly sounds: SiegeSound[] = [];
  readonly firePositions: THREE.Vector3[] = [];
  // True for the one update in which a district starts losing power.
  blackoutStarted = false;
  private lights: Searchlight[] = [];
  private glare: THREE.Points;
  private guns: Gun[] = [];
  private tracers: Tracer[] = [];
  private tracerPoints: THREE.Points;
  private fires: Fire[] = [];
  private flame = new Particles(1800, true);
  private embers = new Particles(900, true);
  private smoke = new Particles(1000, false, 300);
  private outages: Outage[] = [];
  private outageSites: [number, number][] = [];
  private rng = new Rng(4040);
  private tmp = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private wind = new THREE.Vector3(7, 0, 3);

  constructor(
    city: CityData,
    private ship: Mothership,
  ) {
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { ...atmosphere, uColor: { value: new THREE.Color(0.12, 0.11, 0.095) } },
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(BEAM_R1, BEAM_R0, BEAM_LEN, 24, 1, true);
    beamGeo.translate(0, BEAM_LEN / 2, 0);
    const sites: [number, number][] = [
      [-1100, -1100],
      [-980, -1500],
      [1400, -900],
      [1380, 1300],
      [-2300, 400],
      [-1600, 2300],
      [600, 2500],
      [2500, -2200],
      [-2500, -2400],
      [300, -2700],
    ];
    sites.forEach(([x, z], i) => {
      const mesh = new THREE.Mesh(beamGeo, beamMat);
      mesh.frustumCulled = false;
      const base = new THREE.Vector3(x, 3, z);
      mesh.position.copy(base);
      this.group.add(mesh);
      this.lights.push({
        base,
        mesh,
        dir: new THREE.Vector3(0, 1, 0),
        yaw: Math.atan2(-x, -z) + this.rng.range(-0.4, 0.4),
        pitch: this.rng.range(0.9, 1.25),
        sweep: this.rng.range(0.25, 0.6),
        speed: this.rng.range(0.05, 0.12),
        phase: i * 1.7,
      });
    });
    this.glare = makeGlowPoints({
      positions: sites.flatMap(([x, z]) => [x, 5, z]),
      colors: sites.flatMap(() => [4, 3.8, 3.3]),
      sizes: sites.map(() => 4),
      minPx: 2,
    });
    this.glare.frustumCulled = false;
    this.group.add(this.glare);

    for (const [x, z] of [
      [-1500, 600],
      [900, -1700],
      [1900, 1900],
      [-600, 2100],
      [-2100, -900],
    ]) {
      this.guns.push({ pos: new THREE.Vector3(x, 20, z), next: this.rng.range(1, 8), burst: 0, aim: new THREE.Vector3() });
    }
    const tCol: number[] = [];
    const tSize: number[] = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      tCol.push(6, 1.6, 0.5, 2.4, 0.6, 0.2);
      tSize.push(4, 3);
    }
    this.tracerPoints = makeGlowPoints({ positions: new Array(MAX_TRACERS * 6).fill(0), colors: tCol, sizes: tSize, minPx: 1.8 });
    this.tracerPoints.frustumCulled = false;
    this.group.add(this.tracerPoints);

    const burning = this.pickFires(city);
    for (const b of burning) {
      const pos = new THREE.Vector3(b.x, b.top + 2, b.z);
      this.fires.push({ pos, size: this.rng.range(1.6, 2.6), acc: 0, smokeAcc: 0, emberAcc: this.rng.next(), flicker: this.rng.next() * 10 });
      this.firePositions.push(pos);
    }
    const fireGlow = makeGlowPoints({
      positions: this.fires.flatMap((f) => [f.pos.x, f.pos.y + 6, f.pos.z]),
      colors: this.fires.flatMap(() => [4, 1.5, 0.35]),
      sizes: this.fires.map((f) => 13 * f.size),
      minPx: 2,
    });
    this.smoke.points.layers.set(1);
    this.group.add(fireGlow, this.smoke.points, this.flame.points, this.embers.points, this.emergencyVehicles(city, burning));
    for (let i = 0; i < 70; i++) {
      for (const f of this.fires) this.burn(f, 0.5);
      this.flame.update(0.5);
      this.embers.update(0.5);
      this.smoke.update(0.5);
    }

    for (let tries = 0; tries < 400 && this.outageSites.length < 14; tries++) {
      const x = this.rng.range(-2600, 2600);
      const z = this.rng.range(-2600, 2600);
      const clear = x < PARK.x0 - 200 || x > PARK.x1 + 200 || z < PARK.z0 - 200 || z > PARK.z1 + 200;
      if (densityAt(x, z) < 0.4 && !inRiver(x, z, 250) && clear) this.outageSites.push([x, z]);
    }
    for (let i = 0; i < MAX_BLACKOUTS; i++) {
      const [x, z] = this.outageSites[i % this.outageSites.length];
      const dark = i === 0;
      this.outages.push({ x, z, r: this.rng.range(260, 420), phase: dark ? 'dark' : 'on', timer: dark ? 40 : 15 + i * 22, level: dark ? 1 : 0, tick: 0 });
    }
  }

  private pickFires(city: CityData): Building[] {
    const candidates = city.buildings.filter((b) => b.top > 35 && b.top < 150 && densityAt(b.x, b.z) < 0.55 && b.crown === 'flat');
    const picked: Building[] = [];
    for (let tries = 0; tries < 400 && picked.length < FIRES; tries++) {
      const b = this.rng.pick(candidates);
      if (picked.every((q) => Math.hypot(q.x - b.x, q.z - b.z) > 1400)) picked.push(b);
    }
    return picked;
  }

  // Police cars racing along long avenues, and fire engines parked below each burning building.
  private emergencyVehicles(city: CityData, burning: Building[]): THREE.Points {
    const positions: number[] = [];
    const colors: number[] = [];
    const sizes: number[] = [];
    const blink: number[] = [];
    const dir: number[] = [];
    const move: number[] = [];
    const avenues = city.roads.filter((r) => r.b - r.a > 400 && r.ya === 0 && r.yb === 0);
    for (let i = 0; i < 28; i++) {
      const r = this.rng.pick(avenues);
      const len = r.b - r.a;
      const lane = this.rng.chance(0.5) ? 1 : -1;
      const off = lane * r.width * 0.22;
      const start = lane > 0 ? r.a : r.b;
      const sx = r.dir === 'x' ? start : r.c + off;
      const sz = r.dir === 'x' ? r.c + off : start;
      const along: [number, number, number] = r.dir === 'x' ? [lane, 0, 0] : [0, 0, lane];
      const phase = this.rng.range(0, len);
      const speed = this.rng.range(18, 28);
      const period = this.rng.range(0.42, 0.58);
      const p0 = this.rng.next();
      for (const l of [
        { lat: -0.7, back: -1.4, col: [6, 0.25, 0.15], size: 1.5, ph: p0 },
        { lat: 0.7, back: -1.4, col: [0.4, 1.0, 7], size: 1.5, ph: p0 + 0.5 },
        { lat: 0, back: 0, col: [2.6, 2.4, 2.0], size: 1.7, ph: -1 },
      ]) {
        positions.push(sx + (r.dir === 'x' ? 0 : l.lat), 2.2, sz + (r.dir === 'x' ? l.lat : 0));
        dir.push(...along);
        move.push(len, speed, (phase + l.back + len) % len);
        colors.push(...l.col);
        sizes.push(l.size);
        blink.push(l.ph < 0 ? 0 : period, Math.max(l.ph, 0));
      }
    }
    for (const b of burning) {
      const half = b.tiers[0].w / 2 + 7;
      for (let k = 0; k < 3; k++) {
        const side = k === 1 ? -1 : 1;
        const x = b.x + side * half;
        const z = b.z + (k - 1) * 9;
        const period = this.rng.range(0.7, 1.1);
        for (const [dz, col, ph] of [
          [-0.8, [6, 0.3, 0.12], 0],
          [0.8, [6, 5.5, 5], 0.5],
        ] as [number, number[], number][]) {
          positions.push(x, 3, z + dz);
          dir.push(0, 0, 0);
          move.push(1000, 0, 500);
          colors.push(...col);
          sizes.push(1.6);
          blink.push(period, ph + k * 0.2);
        }
      }
    }
    return makeGlowPoints({ positions, colors, sizes, blink, moving: { dir, move }, minPx: 1.4 });
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    this.sounds.length = 0;
    const cam = camera.position;
    const glareCol = this.glare.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const glareSize = this.glare.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    this.lights.forEach((l, i) => {
      const yaw = l.yaw + Math.sin(time * l.speed + l.phase) * l.sweep;
      const pitch = l.pitch + Math.sin(time * l.speed * 1.7 + l.phase * 2) * 0.18;
      l.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      l.mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, l.dir);
      const hit = this.ship.rayHit(l.base, l.dir);
      l.mesh.scale.set(1, hit !== null ? Math.min(1, hit / BEAM_LEN) : 1, 1);
      this.ship.setBeam(i, l.base, l.dir, hit);

      // Flying into a beam and looking back down it is dazzling.
      const along = this.toCam.subVectors(cam, l.base).dot(l.dir);
      const radius = BEAM_R0 + (BEAM_R1 - BEAM_R0) * Math.max(along, 0) / BEAM_LEN;
      const off = this.toCam.addScaledVector(l.dir, -along).length();
      const inBeam = along > 0 && along < (hit ?? BEAM_LEN) ? THREE.MathUtils.smoothstep(radius * 4, radius * 0.6, off) : 0;
      glareCol.setXYZ(i, 4 + 60 * inBeam, 3.8 + 57 * inBeam, 3.3 + 50 * inBeam);
      glareSize.setX(i, 4 + 30 * inBeam);
    });
    glareCol.needsUpdate = true;
    glareSize.needsUpdate = true;

    for (const g of this.guns) {
      g.next -= dt;
      if (g.next <= 0 && g.burst <= 0) {
        g.burst = this.rng.range(1.2, 2.6);
        g.aim.set(-g.pos.x * 0.6 + this.rng.range(-500, 500), 1500, -g.pos.z * 0.6 + this.rng.range(-500, 500)).sub(g.pos).normalize();
      }
      if (g.burst > 0) {
        g.burst -= dt;
        if (g.burst <= 0) g.next = this.rng.range(4, 11);
        if (Math.random() < dt * 14 && this.tracers.length < MAX_TRACERS) {
          const d = g.aim.clone();
          d.x += Math.sin(time * 3) * 0.05 + (Math.random() - 0.5) * 0.03;
          d.z += Math.cos(time * 2.3) * 0.05 + (Math.random() - 0.5) * 0.03;
          this.tracers.push({ pos: g.pos.clone(), vel: d.normalize().multiplyScalar(620), life: 4 });
          dynLights.flash(g.pos, [3, 1.5, 0.5], 70, 0.07);
          this.sounds.push({ kind: 'aa', pos: g.pos });
        }
      }
    }
    const alive: Tracer[] = [];
    for (const t of this.tracers) {
      t.life -= dt;
      t.vel.y -= 9.8 * dt;
      t.pos.addScaledVector(t.vel, dt);
      if (t.life <= 0) continue;
      if (this.ship.hit(t.pos, 2)) {
        this.flame.emit({ pos: t.pos, spread: 30, life: 0.5, size: [9, 3], color: [2, 5, 4.5], drag: 2 }, 3);
        continue;
      }
      alive.push(t);
    }
    this.tracers = alive;
    const tAttr = this.tracerPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (t) {
        tAttr.setXYZ(i * 2, t.pos.x, t.pos.y, t.pos.z);
        tAttr.setXYZ(i * 2 + 1, t.pos.x - t.vel.x * 0.02, t.pos.y - t.vel.y * 0.02, t.pos.z - t.vel.z * 0.02);
      } else {
        tAttr.setXYZ(i * 2, 0, -5000, 0);
        tAttr.setXYZ(i * 2 + 1, 0, -5000, 0);
      }
    }
    tAttr.needsUpdate = true;

    for (const f of this.fires) {
      this.burn(f, dt);
      const flick = 0.75 + 0.15 * Math.sin(time * 9.1 + f.flicker) + 0.1 * Math.sin(time * 23.7 + f.flicker * 2);
      dynLights.add(this.tmp.copy(f.pos).setY(f.pos.y + 10), [2.2 * flick, 0.85 * flick, 0.2 * flick], 70 * f.size);
    }
    this.flame.update(dt);
    this.embers.update(dt);
    this.smoke.update(dt);
    this.updateOutages(dt);
  }

  private burn(f: Fire, dt: number) {
    const s = f.size;
    f.acc += dt * 24 * s;
    while (f.acc > 1) {
      f.acc -= 1;
      const p = f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16 * s, 0, (Math.random() - 0.5) * 16 * s));
      this.flame.emit({ pos: p, vel: new THREE.Vector3(0, 14, 0), spread: 4, life: 1.2, size: [10 * s, 3 * s], color: [5, 1.7, 0.35], drag: 0.5, rise: 7 });
    }
    f.smokeAcc += dt * 1.7 * s;
    while (f.smokeAcc > 1) {
      f.smokeAcc -= 1;
      this.smoke.emit({
        pos: f.pos.clone().setY(f.pos.y + 12),
        vel: this.wind.clone().add(new THREE.Vector3(0, 18, 0)),
        spread: 4,
        life: 28,
        size: [30 * s, 175 * s],
        color: [0.3, 0.1, 0.035],
        color2: [0.04, 0.034, 0.033],
        colorT: 0.1,
        alpha: 0.8,
        drag: 0.045,
        rise: 0.45,
      });
    }
    f.emberAcc += dt * 7 * s;
    while (f.emberAcc > 1) {
      f.emberAcc -= 1;
      this.embers.emit({ pos: f.pos.clone().setY(f.pos.y + 6), vel: this.wind.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 22, 0)), spread: 8, life: 6, size: [1.1, 0.4], color: [7, 2.6, 0.5], drag: 0.35, rise: 1.5 });
    }
  }

  // Districts lose power for a while, flickering as they fail and again as they come back.
  private updateOutages(dt: number) {
    this.blackoutStarted = false;
    this.outages.forEach((o, i) => {
      o.timer -= dt;
      o.tick -= dt;
      const flicker = () => {
        if (o.tick > 0) return;
        o.tick = this.rng.range(0.05, 0.16);
        o.level = this.rng.chance(0.5) ? 1 : this.rng.range(0, 0.4);
      };
      if (o.phase === 'failing' || o.phase === 'restoring') flicker();
      if (o.timer <= 0) {
        if (o.phase === 'on') {
          o.phase = 'failing';
          o.timer = this.rng.range(1.2, 2.4);
          this.blackoutStarted = true;
        } else if (o.phase === 'failing') {
          o.phase = 'dark';
          o.level = 1;
          o.timer = this.rng.range(25, 60);
        } else if (o.phase === 'dark') {
          o.phase = 'restoring';
          o.timer = this.rng.range(2, 3.5);
        } else {
          o.phase = 'on';
          o.level = 0;
          o.timer = this.rng.range(25, 80);
          [o.x, o.z] = this.rng.pick(this.outageSites);
          o.r = this.rng.range(260, 420);
        }
      }
      atmosphere.uBlackout.value[i].set(o.x, o.z, o.r, o.level);
    });
  }
}
