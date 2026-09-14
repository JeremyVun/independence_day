import * as THREE from 'three';
import { clamp, damp } from '../core/rng';
import type { Flight } from './flight';

export type CameraMode = 'chase' | 'cockpit' | 'flyby';
export const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit', 'flyby'];

export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(52, 1, 1, 60000);
  mode: CameraMode = 'chase';
  shake = 0;
  private smoothQ = new THREE.Quaternion();
  private look = new THREE.Vector2();
  private flybyPos = new THREE.Vector3();
  private flybyAge = Infinity;
  private tmp = new THREE.Vector3();
  private tq = new THREE.Quaternion();

  snap(f: Flight) {
    this.smoothQ.copy(f.quat);
    this.flybyAge = Infinity;
  }

  cycle() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.flybyAge = Infinity;
  }

  update(dt: number, f: Flight, length: number, cockpit: THREE.Vector3, lookX: number, lookY: number, maxSpeed: number, cruise: number) {
    const cam = this.camera;
    const fast = clamp((f.speed - cruise) / (maxSpeed - cruise), 0, 1);
    this.look.x = damp(this.look.x, lookX * Math.PI * 0.75, 6, dt);
    this.look.y = damp(this.look.y, -lookY * 0.6, 6, dt);
    const lookQ = this.tq.setFromEuler(new THREE.Euler(this.look.y, -this.look.x, 0, 'YXZ'));

    if (this.mode === 'chase') {
      this.smoothQ.slerp(f.quat, 1 - Math.exp(-dt * 12));
      const q = this.smoothQ.clone().multiply(lookQ);
      this.tmp.set(0, length * 0.3, length * 1.3).applyQuaternion(q);
      cam.position.copy(f.pos).add(this.tmp);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.07));
      cam.near = 1;
      this.setFov(dt, 52 + fast * 4);
    } else if (this.mode === 'cockpit') {
      this.smoothQ.copy(f.quat);
      cam.position.copy(cockpit).applyQuaternion(f.quat).add(f.pos);
      cam.quaternion.copy(f.quat).multiply(lookQ);
      cam.near = 0.3;
      this.setFov(dt, 60 + fast * 3);
    } else {
      this.flybyAge += dt;
      const toJet = this.tmp.subVectors(f.pos, this.flybyPos);
      const behind = toJet.dot(f.fwd) > 160 || this.flybyAge > 9;
      if (behind) {
        const side = new THREE.Vector3().crossVectors(f.fwd, new THREE.Vector3(0, 1, 0)).normalize();
        if (side.lengthSq() < 0.1) side.set(1, 0, 0);
        const s = Math.random() < 0.5 ? -1 : 1;
        this.flybyPos
          .copy(f.pos)
          .addScaledVector(f.fwd, Math.min(f.speed * 2.2, 420))
          .addScaledVector(side, s * (14 + Math.random() * 20))
          .add(new THREE.Vector3(0, -6 + Math.random() * 14, 0));
        this.flybyPos.y = Math.max(this.flybyPos.y, 3);
        this.flybyAge = 0;
      }
      cam.position.copy(this.flybyPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(f.pos);
      cam.near = 1;
      this.setFov(dt, 42);
    }

    if (this.shake > 0) {
      cam.rotateX((Math.random() - 0.5) * this.shake * 0.01);
      cam.rotateY((Math.random() - 0.5) * this.shake * 0.01);
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    cam.updateProjectionMatrix();
  }

  private setFov(dt: number, target: number) {
    this.camera.fov = damp(this.camera.fov, target, 3, dt);
  }
}
