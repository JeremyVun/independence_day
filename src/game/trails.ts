import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';

const MAX = 64;
const LIFE = 1.1;

// Faint wingtip vapour ribbon, visible when the jet pulls hard.
export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: { p: THREE.Vector3; age: number; k: number }[] = [];
  private pos = new Float32Array(MAX * 2 * 3);
  private alpha = new Float32Array(MAX * 2);
  private geo = new THREE.BufferGeometry();
  private side = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private view = new THREE.Vector3();

  constructor(width = 0.45) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: { ...atmosphere },
        vertexShader: /* glsl */ `
          attribute float aAlpha;
          varying float vA;
          varying vec3 vWorld;
          void main() {
            vA = aAlpha;
            vWorld = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vA;
          varying vec3 vWorld;
          ${GLSL_COMMON}
          void main() {
            float near = smoothstep(10.0, 45.0, length(vWorld - cameraPosition));
            gl_FragColor = vec4(vec3(0.3, 0.33, 0.4) * 0.3 * vA * near * fogTransmittance(vWorld), 1.0);
          }
        `,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.width = width;
  }

  private width: number;

  reset() {
    this.pts.length = 0;
    this.geo.setDrawRange(0, 0);
  }

  update(dt: number, head: THREE.Vector3, intensity: number, camera: THREE.Camera) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[0].age > LIFE) this.pts.shift();
    const last = this.pts[this.pts.length - 1];
    if (!last || last.p.distanceToSquared(head) > 4) {
      if (this.pts.length >= MAX) this.pts.shift();
      this.pts.push({ p: head.clone(), age: 0, k: intensity });
    } else {
      last.p.copy(head);
      last.k = Math.max(last.k, intensity);
    }
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const cur = this.pts[i].p;
      const next = this.pts[Math.min(i + 1, n - 1)].p;
      const prev = this.pts[Math.max(i - 1, 0)].p;
      this.dir.subVectors(next, prev);
      this.view.subVectors(camera.position, cur);
      this.side.crossVectors(this.dir, this.view).normalize().multiplyScalar(this.width * (0.4 + (0.6 * i) / Math.max(n - 1, 1)));
      this.pos.set([cur.x + this.side.x, cur.y + this.side.y, cur.z + this.side.z, cur.x - this.side.x, cur.y - this.side.y, cur.z - this.side.z], i * 6);
      const a = this.pts[i].k * (1 - this.pts[i].age / LIFE) * (i / Math.max(n - 1, 1));
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
  }
}
