import * as THREE from 'three';
import { dynLights } from '../core/dynLights';
import type { Controls } from '../core/input';
import { makeFlames, makeNavLights, type Flame } from '../aircraft/fx';
import type { JetModel, JetSpec } from '../aircraft/types';
import type { HitKind } from '../world/collision';
import type { World } from '../world/world';
import { Flight } from './flight';
import type { Effects } from './particles';

export type PlayerEvent = { kind: 'crashed'; hit: HitKind } | { kind: 'shotDown' } | { kind: 'respawned' };

const RESPAWN_DELAY = 3.5;

export class Player {
  readonly model: JetModel;
  readonly flight: Flight;
  readonly flames: Flame;
  readonly root = new THREE.Group();
  health = 100;
  boostFuel = 1;
  alive = true;
  respawnIn = 0;
  private lastSafe = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
  private exhaust = new THREE.Vector3();

  constructor(readonly spec: JetSpec) {
    this.model = spec.build();
    this.flight = new Flight(spec.flight);
    this.flames = makeFlames(this.model, spec.engine.flame);
    this.model.root.add(this.flames.group, makeNavLights(this.model, new THREE.Vector3(0, 1.2, this.model.length * 0.45)));
    this.root.add(this.model.root);
  }

  spawn(pos: THREE.Vector3, dir: THREE.Vector3, bankDeg = 0) {
    this.flight.reset(pos, dir, bankDeg);
    this.alive = true;
    this.health = 100;
    this.boostFuel = 1;
    this.root.visible = true;
    this.sync();
  }

  damage(amount: number, effects: Effects): PlayerEvent | null {
    if (!this.alive) return null;
    this.health -= amount * (1.6 - this.spec.stats.armour * 0.1);
    if (this.health > 0) return null;
    this.destroy(effects);
    return { kind: 'shotDown' };
  }

  private destroy(effects: Effects) {
    this.alive = false;
    this.respawnIn = RESPAWN_DELAY;
    this.root.visible = false;
    effects.explosion(this.flight.pos, 1.3, this.flight.vel);
  }

  update(dt: number, c: Controls, time: number, world: World, effects: Effects, frozen = false): PlayerEvent | null {
    if (!this.alive) {
      this.respawnIn -= dt;
      if (this.respawnIn > 0) return null;
      const p = this.lastSafe.pos.clone();
      p.y = Math.max(p.y, world.collision.heightAt(p.x, p.z) + 120, 220);
      this.spawn(p, this.lastSafe.dir);
      return { kind: 'respawned' };
    }
    if (this.boostFuel <= 0.02) c.boost = 0;
    this.boostFuel = Math.min(1, Math.max(0, this.boostFuel + (c.boost > 0.1 ? -c.boost / 12 : 1 / 8) * dt));
    if (!frozen) this.flight.step(dt, c);
    if (this.health < 100) this.health = Math.min(100, this.health + dt * 4);
    this.sync();
    const anim = { time, throttle: this.flight.throttle, boost: this.flight.boost, speed: this.flight.speed, pitch: c.pitch, roll: c.roll, yaw: c.yaw };
    this.flames.update(anim);
    this.model.animate?.(anim);
    this.engineLight();

    const hit = world.hit(this.flight.pos, this.model.radius * 0.6);
    if (hit) {
      this.destroy(effects);
      return { kind: 'crashed', hit };
    }
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2) && this.flight.pos.y > 150 && !this.flight.outOfBounds) {
      this.lastSafe.pos.copy(this.flight.pos).addScaledVector(this.flight.fwd, -400);
      this.lastSafe.dir.copy(this.flight.fwd).setY(0).normalize();
    }
    return null;
  }

  private sync() {
    this.root.position.copy(this.flight.pos);
    this.root.quaternion.copy(this.flight.quat);
  }

  // The exhaust glow reaches nearby walls, streets and water; the afterburner floods them.
  private engineLight() {
    const nozzles = this.model.nozzles;
    if (!nozzles.length) return;
    this.exhaust.set(0, 0, 0);
    for (const n of nozzles) this.exhaust.add(n.pos);
    this.exhaust.divideScalar(nozzles.length).setZ(this.exhaust.z + 4).applyQuaternion(this.flight.quat).add(this.flight.pos);
    const [r, g, b] = this.spec.engine.flame;
    const k = 0.4 + 0.9 * this.flight.throttle + 6 * this.flight.boost;
    dynLights.add(this.exhaust, [r * k, g * k, b * k], 24 + 70 * this.flight.boost);
  }
}
