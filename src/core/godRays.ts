import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Only the teal of the ship's core feeds the shafts, so lit windows and street lamps don't streak.
const maskShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uLight;
uniform float uAspect;
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float teal = clamp(min(c.g, c.b) - c.r * 1.3, 0.0, 4.0);
  vec2 d = (vUv - uLight) * vec2(uAspect, 1.0);
  float window = exp(-dot(d, d) / (uRadius * uRadius));
  gl_FragColor = vec4(vec3(0.25, 1.0, 0.88) * teal * window, 1.0);
}
`;

const blurShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uLight;
uniform float uSpan;
varying vec2 vUv;
void main() {
  vec2 delta = (vUv - uLight) * uSpan / 40.0;
  vec2 uv = vUv;
  vec3 sum = vec3(0.0);
  float w = 1.0;
  float total = 0.0;
  for (int i = 0; i < 40; i++) {
    sum += texture2D(tDiffuse, uv).rgb * w;
    total += w;
    uv -= delta;
    w *= 0.955;
  }
  gl_FragColor = vec4(sum / total, 1.0);
}
`;

const compositeShader = /* glsl */ `
uniform sampler2D tRays;
uniform float uIntensity;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tRays, vUv).rgb * uIntensity, 1.0); }
`;

// Screen-space light shafts from one bright world-space source: buildings and the hull cut dark gaps in its glow.
export class GodRaysPass extends Pass {
  readonly source = new THREE.Vector3();
  camera: THREE.PerspectiveCamera | null = null;
  strength = 0.12;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private mask = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uLight: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uRadius: { value: 0.2 } },
    vertexShader,
    fragmentShader: maskShader,
    depthTest: false,
    depthWrite: false,
  });
  private blur = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uLight: { value: new THREE.Vector2() }, uSpan: { value: 1 } },
    vertexShader,
    fragmentShader: blurShader,
    depthTest: false,
    depthWrite: false,
  });
  private composite = new THREE.ShaderMaterial({
    uniforms: { tRays: { value: null }, uIntensity: { value: 0 } },
    vertexShader,
    fragmentShader: compositeShader,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.mask);
  private ndc = new THREE.Vector3();
  private view = new THREE.Vector3();

  constructor(width: number, height: number) {
    super();
    this.needsSwap = false;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(Math.max(1, width >> 2), Math.max(1, height >> 2), opts);
    this.b = this.a.clone();
  }

  setSize(width: number, height: number) {
    this.a.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.b.setSize(Math.max(1, width >> 2), Math.max(1, height >> 2));
    this.mask.uniforms.uAspect.value = width / height;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const cam = this.camera;
    if (!cam) return;
    this.view.copy(this.source).applyMatrix4(cam.matrixWorldInverse);
    if (this.view.z > -1) return;
    this.ndc.copy(this.source).project(cam);
    const offscreen = Math.max(Math.abs(this.ndc.x), Math.abs(this.ndc.y));
    const fade = THREE.MathUtils.smoothstep(1.5, 0.95, offscreen);
    if (fade <= 0) return;
    const light = new THREE.Vector2(this.ndc.x * 0.5 + 0.5, this.ndc.y * 0.5 + 0.5);
    const dist = -this.view.z;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);

    this.mask.uniforms.tDiffuse.value = read.texture;
    this.mask.uniforms.uLight.value.copy(light);
    this.mask.uniforms.uRadius.value = THREE.MathUtils.clamp(600 / dist / (2 * tanHalf), 0.05, 0.5);
    this.quad.material = this.mask;
    renderer.setRenderTarget(this.a);
    this.quad.render(renderer);

    this.quad.material = this.blur;
    this.blur.uniforms.uLight.value.copy(light);
    for (const [src, dst, span] of [
      [this.a, this.b, 1.0],
      [this.b, this.a, 0.35],
    ] as const) {
      this.blur.uniforms.tDiffuse.value = src.texture;
      this.blur.uniforms.uSpan.value = span;
      renderer.setRenderTarget(dst);
      this.quad.render(renderer);
    }

    this.composite.uniforms.tRays.value = this.a.texture;
    this.composite.uniforms.uIntensity.value = this.strength * fade;
    this.quad.material = this.composite;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(read);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.mask.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
