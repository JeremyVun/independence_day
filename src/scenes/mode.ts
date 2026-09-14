import type * as THREE from 'three';

export interface Mode {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(dt: number, time: number): void;
  dispose?(): void;
}
