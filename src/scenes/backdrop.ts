import * as THREE from 'three';
import type { World } from '../world/world';

// The real city seen from the airfield at its edge, re-rendered at low resolution every other frame so the
// searchlights sweep, fires burn and rain falls beyond the open hangar doors.
export class LiveBackdrop {
  readonly texture: THREE.Texture;
  private rt = new THREE.WebGLRenderTarget(1024, 512, { type: THREE.HalfFloatType, samples: 2 });
  private camera = new THREE.PerspectiveCamera(44, 2, 1, 60000);
  private frame = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private world: World,
  ) {
    this.camera.position.set(-3100, 80, 2900);
    this.camera.lookAt(-250, 640, 0);
    this.camera.layers.enable(1);
    this.texture = this.rt.texture;
    this.update(0, 40);
  }

  get listener(): THREE.Vector3 {
    return this.camera.position;
  }

  update(dt: number, time: number) {
    this.world.update(dt, time, this.camera, this.rt.height);
    if (this.frame++ % 2) return;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.world.scene, this.camera);
    this.renderer.setRenderTarget(null);
  }
}
