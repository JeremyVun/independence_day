import * as THREE from 'three';
import type { World } from '../world/world';
import type { Mode } from './mode';

export function titleMode(world: World, bufferHeight: () => number): Mode {
  const camera = new THREE.PerspectiveCamera(46, 1, 1, 60000);
  camera.layers.enable(1);
  const target = new THREE.Vector3();
  return {
    scene: world.scene,
    camera,
    update(dt, time) {
      const a = 2.35 + time * 0.018;
      const r = 2500 + 200 * Math.sin(time * 0.05);
      camera.position.set(Math.cos(a) * r, 300 + 70 * Math.sin(time * 0.07), Math.sin(a) * r);
      target.set(Math.cos(a + 0.5) * 300, 520, Math.sin(a + 0.5) * 300);
      camera.lookAt(target);
      world.update(dt, time, camera, bufferHeight());
    },
  };
}
