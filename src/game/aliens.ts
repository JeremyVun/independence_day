import * as THREE from 'three';
import { makeFlames } from '../aircraft/fx';
import { ROSTER } from '../aircraft/roster';
import { jetMaterials } from '../aircraft/materials';
import { mergeGeometries, surface } from '../aircraft/kit';
import type { JetModel } from '../aircraft/types';
import { dynLights } from '../core/dynLights';
import { clamp, Rng } from '../core/rng';
import type { World } from '../world/world';
import { makeGlowPoints } from '../world/lights';
import { orientation } from './flight';
import type { Effects } from './particles';
import type { Player } from './player';

const COUNT = 15;
const SQUAD = 3;
const HP = 30;
const BOLT_SPEED = 380;
const MAX_BOLTS = 160;
const RESPAWN = 25;
const AGGRO_TIME = 35;

function placeholderModel(): JetModel {
  const m = jetMaterials({ body: 0x1d2320, accent: 0x2b3a35 });
  const root = new THREE.Group();
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = surface(
      [
        { s: 1.5, le: -2.5, te: 2.5, t: 1.0 },
        { s: 7.5, le: 3.5, te: 5.2, t: 0.2 },
      ],
      { root: [0, 0, 0], cant: (i / 3) * Math.PI * 2 + Math.PI / 6 },
    );
    blades.push(g);
  }
  root.add(new THREE.Mesh(mergeGeometries(blades), m.body));
  root.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 4, 3.2) })));
  return {
    root,
    nozzles: [{ pos: new THREE.Vector3(0, 0, 2.2), r: 0.9 }],
    wingtips: [new THREE.Vector3(-6, -3, 4), new THREE.Vector3(6, -3, 4)],
    guns: [new THREE.Vector3(0, 0, -3)],
    cockpit: new THREE.Vector3(0, 1, -1),
    length: 10,
    radius: 7,
  };
}

function alienModel(): JetModel {
  const spec = ROSTER.find((j) => j.id === 'alien');
  return spec ? spec.build() : placeholderModel();
}

export interface Fighter {
  root: THREE.Group;
  model: JetModel;
  flames: ReturnType<typeof makeFlames>;
  pos: THREE.Vector3;
  fwd: THREE.Vector3;
  bank: number;
  speed: number;
  hp: number;
  alive: boolean;
  respawn: number;
  squad: number;
  slot: number;
  orbitR: number;
  orbitA: number;
  orbitDir: number;
  alt: number;
  phase: number;
  fireCd: number;
  burst: number;
  breakOff: number;
}

interface Bolt {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export type AlienEvent = { kind: 'playerHit'; amount: number } | { kind: 'alienFire'; pos: THREE.Vector3 } | { kind: 'alienDown'; pos: THREE.Vector3 };

export class Aliens {
  readonly group = new THREE.Group();
  readonly fighters: Fighter[] = [];
  private aggro: number[] = [];
  private bolts: Bolt[] = [];
  private boltPoints: THREE.Points;
  private boltPos: Float32Array;
  private rng = new Rng(808);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      const model = alienModel();
      const flames = makeFlames(model, [0.2, 1.0, 0.8]);
      model.root.add(flames.group);
      const root = new THREE.Group();
      root.add(model.root);
      this.group.add(root);
      const squad = Math.floor(i / SQUAD);
      const f: Fighter = {
        root,
        model,
        flames,
        pos: new THREE.Vector3(),
        fwd: new THREE.Vector3(0, 0, -1),
        bank: 0,
        speed: 130,
        hp: HP,
        alive: true,
        respawn: 0,
        squad,
        slot: i % SQUAD,
        orbitR: 0,
        orbitA: 0,
        orbitDir: 1,
        alt: 0,
        phase: 0,
        fireCd: 0,
        burst: 0,
        breakOff: 0,
      };
      this.fighters.push(f);
      if (f.slot === 0) this.aggro[squad] = 0;
    }
    for (let s = 0; s < this.aggro.length; s++) {
      const r = this.rng.range(900, 3200);
      const a = this.rng.range(0, Math.PI * 2);
      const dir = this.rng.chance(0.5) ? 1 : -1;
      const alt = this.rng.range(380, 1100);
      const phase = this.rng.range(0, 6);
      for (const f of this.fighters.filter((x) => x.squad === s)) {
        f.orbitR = r + f.slot * 25;
        f.orbitA = a - f.slot * 0.035 * dir;
        f.orbitDir = dir;
        f.alt = alt + f.slot * 18;
        f.phase = phase;
        this.placeOnOrbit(f);
      }
    }
    this.boltPos = new Float32Array(MAX_BOLTS * 3 * 3);
    const col: number[] = [];
    const size: number[] = [];
    for (let i = 0; i < MAX_BOLTS; i++) {
      col.push(1.2, 6, 4.5, 0.5, 2.5, 2, 0.25, 1.2, 1);
      size.push(4.5, 3.4, 2.6);
    }
    this.boltPoints = makeGlowPoints({ positions: Array.from(this.boltPos), colors: col, sizes: size, minPx: 2 });
    this.boltPoints.frustumCulled = false;
    this.group.add(this.boltPoints);
  }

  private placeOnOrbit(f: Fighter) {
    f.pos.set(Math.cos(f.orbitA) * f.orbitR, f.alt, Math.sin(f.orbitA) * f.orbitR);
    f.fwd.set(-Math.sin(f.orbitA) * f.orbitDir, 0, Math.cos(f.orbitA) * f.orbitDir);
  }

  isAggro(f: Fighter) {
    return this.aggro[f.squad] > 0;
  }

  provoke(f: Fighter) {
    this.aggro[f.squad] = AGGRO_TIME;
  }

  // Returns the first live fighter within `radius` of the segment a→b.
  hitTest(a: THREE.Vector3, b: THREE.Vector3, radius: number): Fighter | null {
    const ab = this.tmp.subVectors(b, a);
    const len2 = Math.max(ab.lengthSq(), 1e-6);
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const t = clamp(this.tmp2.subVectors(f.pos, a).dot(ab) / len2, 0, 1);
      const cx = a.x + ab.x * t - f.pos.x;
      const cy = a.y + ab.y * t - f.pos.y;
      const cz = a.z + ab.z * t - f.pos.z;
      if (cx * cx + cy * cy + cz * cz < radius * radius) return f;
    }
    return null;
  }

  // Every live fighter within `radius` of the segment a→b.
  hitAll(a: THREE.Vector3, b: THREE.Vector3, radius: number): Fighter[] {
    const out: Fighter[] = [];
    const ab = new THREE.Vector3().subVectors(b, a);
    const len2 = Math.max(ab.lengthSq(), 1e-6);
    const c = new THREE.Vector3();
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const t = clamp(c.subVectors(f.pos, a).dot(ab) / len2, 0, 1);
      if (c.copy(a).addScaledVector(ab, t).distanceToSquared(f.pos) < radius * radius) out.push(f);
    }
    return out;
  }

  within(pos: THREE.Vector3, radius: number): Fighter[] {
    return this.fighters.filter((f) => f.alive && f.pos.distanceToSquared(pos) < radius * radius);
  }

  // Live fighters in a forward cone, nearest-first by distance weighted toward the centre.
  inCone(pos: THREE.Vector3, fwd: THREE.Vector3, cosLimit: number, range: number): Fighter[] {
    const scored: [Fighter, number][] = [];
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = this.tmp.subVectors(f.pos, pos);
      const dist = d.length();
      if (dist > range || dist < 1) continue;
      const c = d.dot(fwd) / dist;
      if (c >= cosLimit) scored.push([f, dist * (2 - c)]);
    }
    return scored.sort((x, y) => x[1] - y[1]).map(([f]) => f);
  }

  damage(f: Fighter, amount: number, effects: Effects, events: AlienEvent[]) {
    if (!f.alive) return;
    this.provoke(f);
    f.hp -= amount;
    effects.fire.emit({ pos: f.pos, spread: 25, life: 0.35, size: [1, 0.3], color: [6, 5, 3], drag: 1 }, 6);
    if (f.hp > 0) return;
    f.alive = false;
    f.respawn = RESPAWN;
    f.root.visible = false;
    effects.explosion(f.pos, 1.1, this.tmp.copy(f.fwd).multiplyScalar(f.speed));
    effects.fire.emit({ pos: f.pos, spread: 40, life: 1.2, size: [2.5, 1], color: [0.5, 5, 4], drag: 1.2 }, 30);
    events.push({ kind: 'alienDown', pos: f.pos.clone() });
  }

  nearestInCone(pos: THREE.Vector3, fwd: THREE.Vector3, cosLimit: number, range: number): Fighter | null {
    let best: Fighter | null = null;
    let bestScore = Infinity;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = this.tmp.subVectors(f.pos, pos);
      const dist = d.length();
      if (dist > range || dist < 1) continue;
      const c = d.dot(fwd) / dist;
      if (c < cosLimit) continue;
      const score = dist * (2 - c);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best;
  }

  update(dt: number, time: number, player: Player, world: World, effects: Effects, events: AlienEvent[]) {
    for (let s = 0; s < this.aggro.length; s++) this.aggro[s] = Math.max(0, this.aggro[s] - dt);
    const pp = player.flight.pos;
    const pv = player.flight.vel;

    for (const f of this.fighters) {
      if (!f.alive) {
        f.respawn -= dt;
        if (f.respawn <= 0) {
          f.alive = true;
          f.hp = HP;
          f.root.visible = true;
          f.orbitA = this.rng.range(0, Math.PI * 2);
          f.pos.set(Math.cos(f.orbitA) * 2600, 1780, Math.sin(f.orbitA) * 2600);
          f.fwd.set(Math.cos(f.orbitA), -0.3, Math.sin(f.orbitA)).normalize();
        }
        continue;
      }

      const aggro = this.aggro[f.squad] > 0 && player.alive;
      const toPlayer = this.tmp.subVectors(pp, f.pos);
      const dist = toPlayer.length();
      if (!aggro && player.alive && dist < 230) this.provoke(f);

      const target = new THREE.Vector3();
      let speedTarget = 130;
      if (aggro) {
        f.breakOff -= dt;
        const lead = dist / BOLT_SPEED;
        target.copy(pp).addScaledVector(pv, lead * 0.8);
        if (dist < 160 && f.breakOff <= 0) f.breakOff = 2.2;
        if (f.breakOff > 0) {
          target.copy(f.pos).addScaledVector(f.fwd, 300).add(new THREE.Vector3(0, 80, 0)).addScaledVector(toPlayer, -0.5);
        }
        target.x += Math.sin(time * 0.7 + f.slot * 2) * 40;
        target.y += Math.cos(time * 0.9 + f.slot) * 30;
        speedTarget = dist > 700 ? 200 : 165;
      } else {
        f.orbitA += (f.speed / f.orbitR) * f.orbitDir * dt;
        const ahead = f.orbitA + (380 / f.orbitR) * f.orbitDir;
        target.set(Math.cos(ahead) * f.orbitR, f.alt + 70 * Math.sin(ahead * 2 + f.phase), Math.sin(ahead) * f.orbitR);
      }
      const floor = Math.max(world.collision.heightAt(f.pos.x + f.fwd.x * 150, f.pos.z + f.fwd.z * 150) + 60, 90);
      if (target.y < floor) target.y = floor;
      if (f.pos.y < floor) target.y = floor + 120;
      if (world.ship.hit(this.tmp2.copy(f.pos).addScaledVector(f.fwd, 200), 40)) target.y = Math.min(target.y, 1200);

      const desired = this.tmp2.subVectors(target, f.pos).normalize();
      const prevX = f.fwd.x;
      const prevZ = f.fwd.z;
      const turn = (aggro ? 1.25 : 0.7) * dt;
      const ang = Math.acos(clamp(f.fwd.dot(desired), -1, 1));
      if (ang > 1e-4) {
        const axis = new THREE.Vector3().crossVectors(f.fwd, desired);
        if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
        f.fwd.applyAxisAngle(axis.normalize(), Math.min(ang, turn)).normalize();
      }
      const yawRate = (prevX * f.fwd.z - prevZ * f.fwd.x) / Math.max(dt, 1e-4);
      f.bank += (clamp(yawRate * 45, -65, 65) - f.bank) * (1 - Math.exp(-4 * dt));
      f.speed += clamp(speedTarget - f.speed, -40 * dt, 40 * dt);
      f.pos.addScaledVector(f.fwd, f.speed * dt);
      f.root.position.copy(f.pos);
      f.root.quaternion.copy(orientation(f.fwd, -f.bank));
      const anim = { time: time + f.phase, throttle: 0.6, boost: aggro ? 0.4 : 0, speed: f.speed, pitch: 0, roll: 0, yaw: 0 };
      f.flames.update(anim);
      f.model.animate?.(anim);

      if (world.collision.hit(f.pos, 4)) {
        this.damage(f, 999, effects, events);
        continue;
      }

      f.fireCd -= dt;
      if (aggro && f.fireCd <= 0 && dist < 950 && f.breakOff <= 0) {
        const cos = toPlayer.dot(f.fwd) / Math.max(dist, 1);
        if (cos > 0.985) {
          const aim = new THREE.Vector3().copy(pp).addScaledVector(pv, dist / BOLT_SPEED).sub(f.pos).normalize();
          aim.x += (Math.random() - 0.5) * 0.03;
          aim.y += (Math.random() - 0.5) * 0.03;
          aim.normalize();
          const start = f.pos.clone().addScaledVector(f.fwd, 8);
          if (this.bolts.length < MAX_BOLTS) this.bolts.push({ pos: start, vel: aim.multiplyScalar(BOLT_SPEED).addScaledVector(f.fwd, f.speed * 0.3), life: 3 });
          dynLights.flash(start, [0.6, 3.5, 2.8], 45, 0.12);
          events.push({ kind: 'alienFire', pos: start });
          f.burst++;
          f.fireCd = f.burst % 4 === 0 ? this.rng.range(1.4, 3) : 0.22;
        }
      }
    }

    const alive: Bolt[] = [];
    for (const b of this.bolts) {
      b.life -= dt;
      const prev = this.tmp.copy(b.pos);
      b.pos.addScaledVector(b.vel, dt);
      if (b.life <= 0) continue;
      if (player.alive) {
        const ab = this.tmp2.subVectors(b.pos, prev);
        const t = clamp(new THREE.Vector3().subVectors(pp, prev).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
        const closest = prev.clone().addScaledVector(ab, t);
        if (closest.distanceTo(pp) < player.model.radius * 0.9) {
          events.push({ kind: 'playerHit', amount: 7 });
          effects.fire.emit({ pos: b.pos, spread: 15, life: 0.4, size: [2, 0.5], color: [0.8, 5, 4], drag: 1 }, 10);
          continue;
        }
      }
      if (world.hit(b.pos, 1)) {
        effects.fire.emit({ pos: b.pos, spread: 12, life: 0.5, size: [3, 1], color: [0.8, 5, 4], drag: 2 }, 8);
        dynLights.flash(b.pos, [0.5, 3, 2.4], 30, 0.25);
        continue;
      }
      alive.push(b);
    }
    this.bolts = alive;
    const posAttr = this.boltPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = this.bolts[i];
      for (let k = 0; k < 3; k++) {
        const o = (i * 3 + k) * 3;
        if (b) {
          arr[o] = b.pos.x - b.vel.x * 0.012 * k;
          arr[o + 1] = b.pos.y - b.vel.y * 0.012 * k;
          arr[o + 2] = b.pos.z - b.vel.z * 0.012 * k;
        } else {
          arr[o] = 0;
          arr[o + 1] = -1000;
          arr[o + 2] = 0;
        }
      }
    }
    posAttr.needsUpdate = true;
  }
}
