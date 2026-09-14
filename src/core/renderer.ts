import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { atmosphere } from './atmosphere';
import { GodRaysPass } from './godRays';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1.0 },
    uTime: { value: 0 },
    uVignette: { value: 0.9 },
    uFlash: { value: 0 },
    uSpeed: { value: 0 },
    uHaze: { value: 0 },
    uLightning: { value: 0 },
    uDrops: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uTime, uVignette, uFlash, uSpeed, uHaze, uLightning, uDrops;
    uniform vec2 uRes;
    varying vec2 vUv;
    vec3 aces(vec3 x) {
      return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 sampleLens(vec2 uv, vec2 q) {
      vec2 off = q * dot(q, q) * 0.0045;
      return vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
    }
    // Raindrops on the canopy or lens: short-lived beads that slide down and refract the scene behind them.
    vec2 drops(vec2 uv) {
      vec2 off = vec2(0.0);
      float aspect = uRes.x / uRes.y;
      for (int L = 0; L < 2; L++) {
        float fl = float(L);
        vec2 grid = vec2((11.0 + fl * 9.0) * aspect, 11.0 + fl * 9.0);
        vec2 p = uv * grid;
        vec2 id = floor(p);
        vec2 f = fract(p) - 0.5;
        float h = hash(id + fl * 17.3);
        float life = fract(uTime * (0.07 + 0.1 * h) + h * 7.0);
        vec2 centre = (vec2(hash(id + 3.1), hash(id + 5.7)) - 0.5) * 0.55;
        centre.y += life * 0.3 * step(0.6, h);
        vec2 d = (f - centre) * vec2(1.0, 0.8);
        float r = 0.07 + 0.09 * hash(id + 9.2);
        float m = smoothstep(r, r * 0.3, length(d)) * step(h, uDrops * 0.55) * (1.0 - life * life);
        off += d * m * 0.9 / grid;
      }
      return off;
    }
    void main() {
      vec2 q = vUv - 0.5;
      vec2 uv = vUv;
      if (uDrops > 0.01) uv -= drops(vUv);
      vec3 c = sampleLens(uv, q);
      if (uSpeed > 0.01) {
        float k = uSpeed * length(q) * 0.05;
        vec3 acc = c;
        for (int i = 1; i <= 6; i++) acc += sampleLens(uv - q * k * float(i) / 6.0, q);
        c = acc / 7.0;
      }
      c *= uExposure * (1.0 + uLightning * 0.12);
      c = mix(c, vec3(0.055, 0.05, 0.05), uHaze * 0.85);
      c += uFlash * vec3(1.0, 0.85, 0.7);
      c *= 1.0 - dot(q, q) * uVignette;
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(-0.003, 0.002, 0.011) * (1.0 - smoothstep(0.0, 0.3, l));
      c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.35, 1.0, l));
      c = max(mix(vec3(l), c, 1.08), 0.0);
      c = toSRGB(c);
      float g = hash(vUv * uRes + fract(uTime * 7.13) * 91.7) - 0.5;
      c += g * (0.028 * (1.0 - c) + 0.004);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly final: ShaderPass;
  readonly rays: GodRaysPass;
  private renderPass: RenderPass;
  pixelRatio: number;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    });
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(window.innerWidth, window.innerHeight, false);
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;

    const size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.gl, target);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.rays = new GodRaysPass(size.x, size.y);
    this.composer.addPass(this.rays);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.6, 0.95);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.final.uniforms.uHaze = atmosphere.uHaze;
    this.final.uniforms.uLightning = atmosphere.uLightning;
    this.composer.addPass(this.final);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.final.uniforms.uRes.value.set(w * this.pixelRatio, h * this.pixelRatio);
  }

  setSpeedBlur(amount: number) {
    this.final.uniforms.uSpeed.value = amount;
  }

  setRain(rain: number, drops: number) {
    this.bloom.strength = 0.5 + 0.12 * rain;
    this.bloom.radius = 0.6 + 0.08 * rain;
    this.final.uniforms.uDrops.value = drops;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, time: number) {
    const aspect = window.innerWidth / window.innerHeight;
    if (camera.aspect !== aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.rays.camera = camera;
    this.final.uniforms.uTime.value = time;
    this.composer.render();
  }
}
