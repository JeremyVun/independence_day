import * as THREE from 'three';
import { applyNightFog } from '../core/atmosphere';
import { dynLights, type Rgb } from '../core/dynLights';
import type { Controls } from '../core/input';
import type { Loadout } from '../aircraft/types';
import type { World } from '../world/world';
import { makeGlowPoints } from '../world/lights';
import type { AlienEvent, Aliens, Fighter } from './aliens';
import type { Effects } from './particles';
import type { Player } from './player';

export type GunKind = 'cannon' | 'rotary' | 'plasma';
export type SpecialKind = 'missile' | 'volley' | 'rail' | 'flak' | 'orb';

interface GunProfile {
  interval: number;
  speed: number;
  damage: number;
  spread: number;
  life: number;
  color: [number, number, number];
  size: number;
  trail: number;
}

const GUNS: Record<GunKind, GunProfile> = {
  cannon: { interval: 1 / 14, speed: 1150, damage: 1, spread: 0.008, life: 1.6, color: [10, 6, 2], size: 2.4, trail: 0.006 },
  rotary: { interval: 1 / 30, speed: 1250, damage: 0.75, spread: 0.016, life: 1.5, color: [12, 5.5, 1.6], size: 2.2, trail: 0.005 },
  plasma: { interval: 1 / 8, speed: 650, damage: 2.6, spread: 0.004, life: 2.6, color: [1.4, 8, 6], size: 5.5, trail: 0.012 },
};

export const LOADOUTS: Record<Loadout, { gun: GunKind; special: SpecialKind; reload: number; locks: number }> = {
  standard: { gun: 'cannon', special: 'missile', reload: 3.2, locks: 1 },
  volley: { gun: 'cannon', special: 'volley', reload: 6, locks: 4 },
  rail: { gun: 'cannon', special: 'rail', reload: 4, locks: 0 },
  flak: { gun: 'rotary', special: 'flak', reload: 2.5, locks: 0 },
  orb: { gun: 'plasma', special: 'orb', reload: 7, locks: 1 },
};

const MUZZLE_LIGHT: Record<GunKind, Rgb> = { cannon: [5, 3, 1.1], rotary: [5, 2.4, 0.8], plasma: [0.7, 4, 3.2] };

const MAX_BULLETS = 120;
const LOCK_TIME = 0.6;
const RAIL_CHARGE = 0.45;
const RAIL_RANGE = 3500;

interface Bullet {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

type ProjectileKind = 'missile' | 'micro' | 'flak' | 'orb';

interface Projectile {
  kind: ProjectileKind;
  obj: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  target: Fighter | null;
  life: number;
  smokeT: number;
}

export interface Lock {
  target: Fighter;
  progress: number;
}

export type WeaponEvent =
  | { kind: 'gun'; gun: GunKind }
  | { kind: 'launch'; special: SpecialKind }
  | { kind: 'charge' }
  | { kind: 'boom'; pos: THREE.Vector3; size: number };

const beamVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const beamFragment = /* glsl */ `
uniform float uFade;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float core = pow(1.0 - across, 3.0);
  gl_FragColor = vec4(uColor * core * uFade * (0.6 + 0.4 * sin(vUv.y * 400.0 - uFade * 30.0)), 1.0);
}
`;

export class Weapons {
  readonly group = new THREE.Group();
  readonly gun: GunKind;
  readonly special: SpecialKind;
  readonly reload: number;
  kills = 0;
  cooldown = 0;
  charging = 0;
  locks: Lock[] = [];
  private maxLocks: number;
  private bullets: Bullet[] = [];
  private projectiles: Projectile[] = [];
  private gunCd = 0;
  private muzzle = 0;
  private tracers: THREE.Points;
  private missileGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.2, 6).rotateX(Math.PI / 2);
  private missileMat = applyNightFog(new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.4, metalness: 0.3, flatShading: true }));
  private beam: THREE.Mesh;
  private beamUniforms = { uFade: { value: 0 }, uColor: { value: new THREE.Color(3, 5, 9) } };
  private tmp = new THREE.Vector3();

  constructor(loadout: Loadout = 'standard') {
    const l = LOADOUTS[loadout];
    this.gun = l.gun;
    this.special = l.special;
    this.reload = l.reload;
    this.maxLocks = l.locks;
    const g = GUNS[this.gun];
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < MAX_BULLETS; i++) {
      col.push(...g.color, ...g.color.map((c) => c * 0.5), ...g.color.map((c) => c * 0.2));
      size.push(g.size, g.size * 0.8, g.size * 0.6);
    }
    this.tracers = makeGlowPoints({ positions: new Array(MAX_BULLETS * 9).fill(0), colors: col, sizes: size, minPx: 1.8 });
    this.tracers.frustumCulled = false;
    const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        uniforms: this.beamUniforms,
        vertexShader: beamVertex,
        fragmentShader: beamFragment,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.group.add(this.tracers, this.beam);
  }

  reset() {
    this.locks = [];
    this.charging = 0;
  }

  get ready() {
    return this.cooldown <= 0 && this.charging <= 0;
  }

  get locked(): Fighter[] {
    return this.locks.filter((l) => l.progress >= LOCK_TIME).map((l) => l.target);
  }

  lockFraction(l: Lock) {
    return Math.min(1, l.progress / LOCK_TIME);
  }

  private updateLocks(dt: number, player: Player, aliens: Aliens) {
    const f = player.flight;
    const want = Math.max(this.maxLocks, 1);
    const keepCone = Math.cos(THREE.MathUtils.degToRad(this.maxLocks > 1 ? 34 : 28));
    const newCone = Math.cos(THREE.MathUtils.degToRad(this.maxLocks > 1 ? 26 : 18));
    this.locks = this.locks.filter((l) => {
      if (!l.target.alive) return false;
      const d = this.tmp.subVectors(l.target.pos, f.pos);
      const dist = d.length();
      return dist < 3600 && d.dot(f.fwd) / dist > keepCone;
    });
    const candidates = aliens.inCone(f.pos, f.fwd, newCone, 3400);
    const best = candidates[0];
    const current = this.locks[0];
    if (want === 1 && best && current && best !== current.target && best.pos.distanceTo(f.pos) < current.target.pos.distanceTo(f.pos) * 0.5) this.locks = [];
    for (const c of candidates) {
      if (this.locks.length >= want) break;
      if (!this.locks.some((l) => l.target === c)) this.locks.push({ target: c, progress: 0 });
    }
    for (const l of this.locks) l.progress = this.maxLocks > 0 ? Math.min(LOCK_TIME, l.progress + dt) : 0;
  }

  update(dt: number, c: Controls, fireSpecial: boolean, player: Player, aliens: Aliens, world: World, effects: Effects, alienEvents: AlienEvent[], events: WeaponEvent[]) {
    const f = player.flight;
    const g = GUNS[this.gun];
    const damage = (3 + player.spec.stats.weapons * 0.3) * g.damage;
    this.gunCd -= dt;
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (player.alive) {
      this.updateLocks(dt, player, aliens);

      if (c.guns && this.gunCd <= 0) {
        this.gunCd = g.interval;
        const guns = player.model.guns;
        const pair = this.gun === 'plasma' ? guns : [guns[this.muzzle++ % guns.length]];
        for (const gun of pair) {
          const start = gun.clone().applyQuaternion(f.quat).add(f.pos);
          const dir = f.fwd.clone();
          dir.x += (Math.random() - 0.5) * g.spread;
          dir.y += (Math.random() - 0.5) * g.spread;
          dir.normalize();
          if (this.bullets.length >= MAX_BULLETS) this.bullets.shift();
          this.bullets.push({ pos: start, vel: dir.multiplyScalar(g.speed).add(f.vel), life: g.life });
          dynLights.flash(start, MUZZLE_LIGHT[this.gun], 38, 0.06);
        }
        events.push({ kind: 'gun', gun: this.gun });
      }

      if (fireSpecial && this.ready) this.fireSpecial(player, aliens, effects, events);
      if (this.charging > 0) {
        this.charging -= dt;
        const nose = this.tmp.set(0, 0, -player.model.length * 0.5).applyQuaternion(f.quat).add(f.pos);
        effects.fire.emit({ pos: nose, vel: f.vel, spread: 6, life: 0.2, size: [1.5, 0.3], color: [2, 4, 8], drag: 4 }, 2);
        if (this.charging <= 0) this.fireRail(player, aliens, world, effects, alienEvents, events);
      }
    }

    this.updateBullets(dt, damage, aliens, world, effects, alienEvents);
    this.updateProjectiles(dt, aliens, world, effects, alienEvents, events);

    if (this.beam.visible) {
      this.beamUniforms.uFade.value -= dt * 2.4;
      if (this.beamUniforms.uFade.value <= 0) this.beam.visible = false;
    }
  }

  private fireSpecial(player: Player, aliens: Aliens, effects: Effects, events: WeaponEvent[]) {
    const f = player.flight;
    this.cooldown = this.reload;
    events.push({ kind: this.special === 'rail' ? 'charge' : 'launch', special: this.special } as WeaponEvent);
    const under = new THREE.Vector3(0, -1.2, 0).applyQuaternion(f.quat).add(f.pos);
    const locked = this.locked;
    for (const t of locked) aliens.provoke(t);
    if (this.special === 'rail') {
      this.charging = RAIL_CHARGE;
      this.cooldown = this.reload + RAIL_CHARGE;
    } else if (this.special === 'missile') {
      this.launch('missile', under, f.vel.clone().addScaledVector(f.fwd, 30), locked[0] ?? null, 7);
    } else if (this.special === 'volley') {
      const right = f.right;
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1;
        const spread = right.clone().multiplyScalar(side * (18 + 10 * (i >> 1))).addScaledVector(f.up, -6 + 8 * (i >> 1));
        const target = locked.length ? locked[i % locked.length] : null;
        this.launch('micro', under.clone().addScaledVector(right, side * 2), f.vel.clone().addScaledVector(f.fwd, 20).add(spread), target, 6);
      }
    } else if (this.special === 'flak') {
      for (let i = 0; i < 3; i++) {
        const dir = f.fwd.clone().addScaledVector(f.right, (i - 1) * 0.025).addScaledVector(f.up, (Math.random() - 0.5) * 0.02).normalize();
        this.launch('flak', f.pos.clone().addScaledVector(f.fwd, 8), f.vel.clone().addScaledVector(dir, 950), null, 1.5);
      }
    } else {
      this.launch('orb', f.pos.clone().addScaledVector(f.fwd, 12), f.fwd.clone().multiplyScalar(Math.max(340, f.speed + 150)), locked[0] ?? null, 8);
      effects.fire.emit({ pos: f.pos.clone().addScaledVector(f.fwd, 12), vel: f.vel, spread: 30, life: 0.4, size: [4, 1], color: [1, 6, 5], drag: 3 }, 20);
    }
  }

  private launch(kind: ProjectileKind, pos: THREE.Vector3, vel: THREE.Vector3, target: Fighter | null, life: number) {
    const obj = new THREE.Group();
    if (kind === 'missile' || kind === 'micro') {
      const body = new THREE.Mesh(this.missileGeo, this.missileMat);
      if (kind === 'micro') body.scale.setScalar(0.6);
      obj.add(body, makeGlowPoints({ positions: [0, 0, kind === 'micro' ? 1.1 : 1.8], colors: [8, 4, 1.5], sizes: [kind === 'micro' ? 1.6 : 2.4], minPx: 2 }));
    } else if (kind === 'flak') {
      obj.add(makeGlowPoints({ positions: [0, 0, 0, 0, 0, 1.5], colors: [12, 6, 1.5, 4, 2, 0.5], sizes: [2.6, 2], minPx: 2 }));
    } else {
      obj.add(
        new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 7, 6) })),
        makeGlowPoints({ positions: [0, 0, 0], colors: [1.2, 6, 5], sizes: [26], minPx: 3 }),
      );
    }
    obj.position.copy(pos);
    this.group.add(obj);
    this.projectiles.push({ kind, obj, pos: pos.clone(), vel, target, life, smokeT: 0 });
  }

  private fireRail(player: Player, aliens: Aliens, world: World, effects: Effects, alienEvents: AlienEvent[], events: WeaponEvent[]) {
    const f = player.flight;
    const start = new THREE.Vector3(0, 0, -player.model.length * 0.5).applyQuaternion(f.quat).add(f.pos);
    let range = RAIL_RANGE;
    const probe = new THREE.Vector3();
    for (let d = 20; d < RAIL_RANGE; d += 20) {
      if (world.hit(probe.copy(start).addScaledVector(f.fwd, d), 1)) {
        range = d;
        break;
      }
    }
    const end = start.clone().addScaledVector(f.fwd, range);
    for (const hit of aliens.hitAll(start, end, 16)) aliens.damage(hit, 999, effects, alienEvents);
    this.beam.position.copy(start);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), f.fwd);
    this.beam.scale.set(3.2, 1, range);
    this.beam.visible = true;
    this.beamUniforms.uFade.value = 1;
    dynLights.flash(start, [3, 5, 9], 70, 0.4);
    dynLights.flash(probe.copy(start).addScaledVector(f.fwd, Math.min(range, 400)), [2, 3.5, 7], 110, 0.4);
    for (let d = 0; d < range; d += 60) {
      effects.fire.emit({ pos: probe.copy(start).addScaledVector(f.fwd, d), spread: 10, life: 0.6, size: [2.5, 0.5], color: [1.5, 3, 7], drag: 2 }, 1);
    }
    if (range < RAIL_RANGE) effects.explosion(end, 0.5);
    events.push({ kind: 'launch', special: 'rail' });
    events.push({ kind: 'boom', pos: end, size: range < RAIL_RANGE ? 0.5 : 0 });
  }

  private updateBullets(dt: number, damage: number, aliens: Aliens, world: World, effects: Effects, alienEvents: AlienEvent[]) {
    const g = GUNS[this.gun];
    const survivors: Bullet[] = [];
    for (const b of this.bullets) {
      b.life -= dt;
      const prev = this.tmp.copy(b.pos);
      const next = b.pos.clone().addScaledVector(b.vel, dt);
      if (b.life <= 0) continue;
      const hit = aliens.hitTest(prev, next, this.gun === 'plasma' ? 11 : 9);
      if (hit) {
        aliens.damage(hit, damage, effects, alienEvents);
        if (this.gun === 'plasma') effects.fire.emit({ pos: next, spread: 20, life: 0.4, size: [3, 0.5], color: [1, 6, 5], drag: 2 }, 8);
        continue;
      }
      for (const fi of aliens.fighters) if (fi.alive && !aliens.isAggro(fi) && fi.pos.distanceToSquared(next) < 70 * 70) aliens.provoke(fi);
      if (world.hit(next, 0.5)) {
        const col: [number, number, number] = this.gun === 'plasma' ? [1, 6, 5] : [6, 3.5, 1.2];
        effects.fire.emit({ pos: next, spread: 18, life: 0.3, size: [1.2, 0.3], color: col, drag: 2, rise: -20 }, 4);
        dynLights.flash(next, [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5], 16, 0.1);
        continue;
      }
      b.pos.copy(next);
      survivors.push(b);
    }
    this.bullets = survivors;

    const posAttr = this.tracers.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.bullets[i];
      for (let k = 0; k < 3; k++) {
        const o = (i * 3 + k) * 3;
        if (b) {
          arr[o] = b.pos.x - b.vel.x * g.trail * k;
          arr[o + 1] = b.pos.y - b.vel.y * g.trail * k;
          arr[o + 2] = b.pos.z - b.vel.z * g.trail * k;
        } else arr[o + 1] = -1000;
      }
    }
    posAttr.needsUpdate = true;
  }

  private burst(p: Projectile, aliens: Aliens, effects: Effects, alienEvents: AlienEvent[], events: WeaponEvent[]) {
    if (p.kind === 'flak') {
      for (const f of aliens.within(p.pos, 65)) aliens.damage(f, f.pos.distanceTo(p.pos) < 30 ? 999 : 25, effects, alienEvents);
      effects.fire.emit({ pos: p.pos, life: 0.12, size: [16, 26], color: [5, 3, 1.4], drag: 0 }, 1);
      effects.fire.emit({ pos: p.pos, spread: 70, life: 0.7, size: [1.2, 0.3], color: [6, 3, 1], drag: 1.5 }, 26);
      effects.smoke.emit({ pos: p.pos, spread: 10, life: 3, size: [10, 26], color: [0.03, 0.028, 0.03], alpha: 0.85, drag: 1.5, rise: 2 }, 8);
      dynLights.flash(p.pos, [10, 6, 2], 90, 0.5);
      events.push({ kind: 'boom', pos: p.pos.clone(), size: 0.45 });
    } else if (p.kind === 'orb') {
      for (const f of aliens.within(p.pos, 120)) aliens.damage(f, 999, effects, alienEvents);
      dynLights.flash(p.pos, [2, 10, 8], 130, 0.9);
      effects.fire.emit({ pos: p.pos, life: 0.25, size: [60, 120], color: [1.5, 6, 5], drag: 0 }, 1);
      effects.fire.emit({ pos: p.pos, spread: 240, life: 0.9, size: [8, 2], color: [0.8, 4.5, 4], drag: 3.5 }, 140);
      effects.fire.emit({ pos: p.pos, spread: 60, life: 1.4, size: [5, 18], color: [0.5, 3, 2.6], drag: 2, rise: 4 }, 40);
      events.push({ kind: 'boom', pos: p.pos.clone(), size: 1.6 });
    } else {
      effects.explosion(p.pos, p.kind === 'micro' ? 0.45 : 0.6);
      events.push({ kind: 'boom', pos: p.pos.clone(), size: p.kind === 'micro' ? 0.4 : 0.6 });
    }
  }

  private updateProjectiles(dt: number, aliens: Aliens, world: World, effects: Effects, alienEvents: AlienEvent[], events: WeaponEvent[]) {
    const flying: Projectile[] = [];
    for (const p of this.projectiles) {
      p.life -= dt;
      let dir = p.vel.clone().normalize();
      let speed = p.vel.length();
      let explode = false;
      if (p.kind === 'missile' || p.kind === 'micro') {
        speed = Math.min(speed + (p.kind === 'micro' ? 320 : 260) * dt, p.kind === 'micro' ? 620 : 560);
        if (p.target && p.target.alive) {
          const want = this.tmp.subVectors(p.target.pos, p.pos).normalize();
          const ang = Math.acos(Math.min(1, Math.max(-1, dir.dot(want))));
          const step = Math.min(ang, (p.kind === 'micro' ? 4.5 : 3.4) * dt);
          if (ang > 1e-4) dir = dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, want).normalize(), step);
          if (p.pos.distanceTo(p.target.pos) < 14) {
            aliens.damage(p.target, 999, effects, alienEvents);
            explode = true;
          }
        }
      } else if (p.kind === 'orb') {
        if (p.target && p.target.alive) {
          const want = this.tmp.subVectors(p.target.pos, p.pos).normalize();
          const ang = Math.acos(Math.min(1, Math.max(-1, dir.dot(want))));
          if (ang > 1e-4) dir = dir.applyAxisAngle(new THREE.Vector3().crossVectors(dir, want).normalize(), Math.min(ang, 1.7 * dt));
        }
        if (aliens.within(p.pos, 30).length) explode = true;
        p.obj.rotation.x += dt * 3;
        p.obj.rotation.y += dt * 2;
      } else if (aliens.within(p.pos, 35).length) explode = true;

      p.vel.copy(dir).multiplyScalar(speed);
      if (p.kind === 'flak') p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.obj.position.copy(p.pos);
      if (p.kind !== 'orb') p.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);

      p.smokeT -= dt;
      if (p.smokeT <= 0) {
        if (p.kind === 'missile' || p.kind === 'micro') {
          p.smokeT = 0.018;
          const s = p.kind === 'micro' ? 0.6 : 1;
          effects.smoke.emit({ pos: p.pos, life: 2.2 * s, size: [1.5 * s, 7 * s], color: [0.22, 0.2, 0.2], alpha: 0.5, drag: 2, rise: 1.5 });
          effects.fire.emit({ pos: p.pos, life: 0.12, size: [2.2 * s, 1], color: [5, 2.5, 0.8], drag: 0 });
        } else if (p.kind === 'orb') {
          p.smokeT = 0.03;
          effects.fire.emit({ pos: p.pos, spread: 8, life: 0.7, size: [6, 1], color: [0.6, 3.5, 3], drag: 2 });
        }
      }
      if (explode || p.life <= 0 || world.hit(p.pos, 1)) {
        this.burst(p, aliens, effects, alienEvents, events);
        this.group.remove(p.obj);
        continue;
      }
      flying.push(p);
    }
    this.projectiles = flying;
  }
}
