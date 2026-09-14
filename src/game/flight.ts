import * as THREE from 'three';
import type { Controls } from '../core/input';
import { clamp, damp, lerp } from '../core/rng';
import type { FlightSpec } from '../aircraft/types';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const BOUNDARY = 3900;
const CEILING = 4200;

export function orientation(dir: THREE.Vector3, bankDeg = 0): THREE.Quaternion {
  const f = dir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(f, WORLD_UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, f).normalize();
  const m = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-bankDeg)));
}

export class Flight {
  readonly pos = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly vel = new THREE.Vector3();
  readonly rates = new THREE.Vector3();
  readonly fwd = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  readonly right = new THREE.Vector3(1, 0, 0);
  speed = 0;
  boost = 0;
  throttle = 0.5;
  gLoad = 1;
  outOfBounds = false;
  private tq = new THREE.Quaternion();
  private te = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(public spec: FlightSpec) {}

  reset(pos: THREE.Vector3, dir: THREE.Vector3, bankDeg = 0) {
    this.pos.copy(pos);
    this.quat.copy(orientation(dir, bankDeg));
    this.speed = this.spec.cruise;
    this.rates.set(0, 0, 0);
    this.updateAxes();
    this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  private updateAxes() {
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  step(dt: number, c: Controls) {
    const s = this.spec;
    this.updateAxes();

    this.boost = damp(this.boost, c.boost, 4, dt);
    const target = c.brake > 0 ? lerp(s.cruise, s.min, c.brake) : lerp(s.cruise, s.max, this.boost);
    const diff = target - this.speed;
    this.speed += clamp(diff, -s.accel * 1.5 * dt, s.accel * (0.6 + this.boost) * dt);
    this.speed -= this.fwd.y * 9.8 * 0.55 * dt;
    this.speed = clamp(this.speed, s.min * 0.85, s.max * 1.12);
    this.throttle = clamp((this.speed - s.min) / (s.max - s.min), 0, 1);

    const authority = clamp(0.45 + 0.55 * (this.speed / s.cruise), 0.5, 1) * (this.speed > s.cruise * 1.4 ? 0.85 : 1);
    let pitchT = c.pitch * s.pitchRate * authority;
    let rollT = -c.roll * s.rollRate * authority;
    const yawT = -c.yaw * s.yawRate;


    this.outOfBounds = Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > BOUNDARY || this.pos.y > CEILING;
    let worldYaw = 0;
    if (this.outOfBounds) {
      const home = new THREE.Vector3(-this.pos.x, 0, -this.pos.z).normalize();
      const flat = new THREE.Vector3(this.fwd.x, 0, this.fwd.z).normalize();
      const side = flat.x * home.z - flat.z * home.x;
      worldYaw += clamp(-side * 2, -0.5, 0.5) + (flat.dot(home) < 0 ? 0.4 : 0);
      if (this.pos.y > CEILING) pitchT -= 0.4;
    }

    // Rotation builds up slowly for weight but stops promptly when the stick is released, like real roll damping.
    const respond = (cur: number, target: number, build: number) => {
      const easing = Math.abs(target) < Math.abs(cur) || Math.sign(target) !== Math.sign(cur) ? 12 : build;
      return cur + (target - cur) * (1 - Math.exp(-easing * dt));
    };
    this.rates.x = respond(this.rates.x, pitchT, 5);
    this.rates.y = respond(this.rates.y, yawT, 5);
    this.rates.z = respond(this.rates.z, rollT, 7);

    this.te.set(this.rates.x * dt, this.rates.y * dt, this.rates.z * dt, 'YXZ');
    this.quat.multiply(this.tq.setFromEuler(this.te));
    this.quat.premultiply(this.tq.setFromAxisAngle(WORLD_UP, worldYaw * dt));
    this.quat.normalize();
    this.updateAxes();

    this.gLoad = 1 + (Math.abs(this.rates.x) * this.speed) / 9.8;
    const desired = this.fwd.clone().multiplyScalar(this.speed);
    this.vel.lerp(desired, 1 - Math.exp(-s.grip * dt));
    this.pos.addScaledVector(this.vel, dt);
  }
}
