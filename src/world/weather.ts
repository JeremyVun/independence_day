import * as THREE from 'three';
import { atmosphere, CLEAR_FOG, GLSL_COMMON, RAIN_FOG } from '../core/atmosphere';
import { damp, Rng } from '../core/rng';
import { screenSize } from './lights';

const RAIN_DROPS = 20000;
const CURTAINS = [45, 110, 230, 430];
const RAIN_BOX = new THREE.Vector3(90, 70, 90);
const RAIN_FALL = new THREE.Vector3(5, -28, 2.5);
const CLOUDS = 70;
const PUFFS = 8;
const CLOUD_SPAN = 11000;
const WIND = new THREE.Vector3(3.2, 0, 1.4);

type Phase = 'clear' | 'building' | 'raining' | 'clearing';

// Each drop is a screen-aligned quad stretched along its motion relative to the camera, at least ~2 px wide.
const rainVertex = /* glsl */ `
attribute vec3 aBase;
attribute vec2 aCorner;
uniform vec3 uBox;
uniform vec3 uFall;
uniform vec3 uRel;
uniform vec2 uScreen;
uniform sampler2D uCityMap;
uniform float uMapHalf;
varying float vA;
varying float vSide;
varying float vLamp;
varying vec3 vWorld;
${GLSL_COMMON}
void main() {
  vec3 head = aBase * uBox + uFall * uTime;
  head = mod(head - cameraPosition + uBox * 0.5, uBox) + cameraPosition - uBox * 0.5;
  float rel = length(uRel);
  vec3 tail = head - uRel * mix(0.05, 0.014, clamp(rel / 300.0, 0.0, 1.0));
  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  float keep = step(aBase.x * 0.37 + aBase.z * 0.63, uRain) * step(0.5, ch.w) * step(0.5, ct.w);
  vec2 d = (ct.xy / ct.w - ch.xy / ch.w) * uScreen;
  vec2 dir = length(d) > 1e-3 ? normalize(d) : vec2(0.0, 1.0);
  vec4 c = mix(ch, ct, aCorner.y);
  c.xy += vec2(-dir.y, dir.x) * aCorner.x * 2.0 / uScreen * c.w;
  vA = keep * (1.0 - aCorner.y * 0.85) / (1.0 + rel / 60.0 + rel * rel / 9000.0);
  vSide = aCorner.x;
  vWorld = mix(head, tail, aCorner.y);
  vLamp = texture2D(uCityMap, (head.xz + uMapHalf) / (2.0 * uMapHalf)).a * exp(-max(head.y - 8.0, 0.0) / 28.0);
  gl_Position = keep > 0.5 ? c : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const rainFragment = /* glsl */ `
varying float vA;
varying float vSide;
varying float vLamp;
varying vec3 vWorld;
${GLSL_COMMON}
void main() {
  float near = smoothstep(1.5, 8.0, length(vWorld - cameraPosition));
  vec3 lit = vec3(0.22, 0.22, 0.24) + vec3(0.32, 0.21, 0.11) * exp(-max(vWorld.y, 0.0) / 300.0) + vec3(0.8, 0.85, 1.0) * flashAt(normalize(vWorld - cameraPosition)) * 0.5;
  lit += vec3(1.0, 0.62, 0.32) * vLamp * 1.1;
  gl_FragColor = vec4(lit * 0.5 * vA * sqrt(max(1.0 - abs(vSide), 0.0)) * near, 1.0);
}
`;

const curtainVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

// Sheets of rain in the middle distance: scrolling streak columns on cylinders centred on the camera.
const curtainFragment = /* glsl */ `
uniform float uLayer;
varying vec2 vUv;
varying vec3 vWorld;
${GLSL_COMMON}
void main() {
  float cols = 300.0 + uLayer * 200.0;
  float x = vUv.x * cols;
  float id = floor(x);
  float h = hash12(vec2(id, uLayer * 7.0 + 1.0));
  float col = smoothstep(0.12, 0.0, abs(fract(x) - 0.5));
  float y = vUv.y * (18.0 + 10.0 * h) + uTime * (3.0 + 2.0 * h) + h * 20.0;
  float on = step(hash12(vec2(id, floor(y))), 0.3);
  float streak = smoothstep(0.0, 0.04, fract(y)) * smoothstep(0.32, 0.06, fract(y));
  float edge = smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  vec3 dir = normalize(vWorld - cameraPosition);
  vec3 lit = fogColorFor(dir) * 3.0 * (0.4 + 0.6 * smoothstep(0.35, -0.1, dir.y));
  float a = col * streak * on * edge * uRain;
  gl_FragColor = vec4(lit * a * 0.28 * (0.35 + 0.65 * fogTransmittance(vWorld)), 1.0);
}
`;

const cloudVertex = /* glsl */ `
attribute vec3 aCenter;
attribute vec3 aInfo;
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vWorld;
varying float vNear;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float size = aInfo.x;
  vec3 wp = aCenter + (right * position.x + up * position.y * 0.62) * size;
  vUv = uv;
  vInfo = aInfo;
  vWorld = wp;
  vNear = smoothstep(size * 0.12, size * 0.55, distance(cameraPosition, aCenter));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const cloudFragment = /* glsl */ `
varying vec2 vUv;
varying vec3 vInfo;
varying vec3 vWorld;
varying float vNear;
${GLSL_COMMON}
void main() {
  float seed = vInfo.y;
  float n = fbm(vUv * 2.6 + seed * 17.0 + uTime * 0.008);
  float r = length((vUv - 0.5) * vec2(1.0, 1.3)) * 2.0;
  float dens = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9);
  vec3 under = vec3(0.1, 0.063, 0.042) * (0.45 + 0.9 * exp(-length(vWorld.xz) / 5000.0));
  vec3 over = vec3(0.045, 0.055, 0.08);
  vec3 col = mix(under, over, smoothstep(0.25, 0.95, vUv.y)) * (0.65 + 0.7 * n);
  col += shipLight(vWorld, vec3(0.0, -1.0, 0.0)) * 0.9;
  col += vec3(0.55, 0.6, 0.78) * flashAt(normalize(vWorld - cameraPosition)) * 1.6;
  float a = dens * vInfo.z * uCloudCover * vNear;
  gl_FragColor = vec4(nightFog(col, vWorld), a);
}
`;

interface Puff {
  base: THREE.Vector3;
  pos: THREE.Vector3;
  size: number;
  seed: number;
  opacity: number;
}

// Periodic rain, drifting low cloud banks and lightning. Forced with ?weather=rain|clear.
export class Weather {
  readonly group = new THREE.Group();
  rain = 0;
  cover = 0.35;
  wet = 0;
  lightning = 0;
  thunderIn = -1;
  thunderStrength = 0;
  private phase: Phase = 'clear';
  private timer: number;
  private rng = new Rng(777);
  private rainMat: THREE.ShaderMaterial;
  private rainRel = new THREE.Vector3();
  private lastCam = new THREE.Vector3();
  private puffs: Puff[] = [];
  private cloudGeo: THREE.InstancedBufferGeometry;
  private centers: Float32Array;
  private infos: Float32Array;
  private flashT = 0;
  private flashNext = 8;
  private forced: 'rain' | 'clear' | null;
  private light = new THREE.HemisphereLight(0x9aa8d0, 0x202030, 0);
  private curtains = new THREE.Group();
  private flashDir = new THREE.Vector3();

  constructor(forced: string | null, cityMap: THREE.Texture, mapHalf: number) {
    this.forced = forced === 'rain' || forced === 'clear' ? forced : null;
    this.timer = Math.random() * 45 + 20;
    if (this.forced === 'rain') {
      this.phase = 'raining';
      this.rain = this.wet = 1;
      this.cover = 1;
    }

    const base = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS * 3; i++) base[i] = this.rng.next();
    const rainGeo = new THREE.InstancedBufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    rainGeo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    rainGeo.setIndex([0, 1, 2, 0, 2, 3]);
    rainGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 3));
    rainGeo.instanceCount = RAIN_DROPS;
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        ...atmosphere,
        uBox: { value: RAIN_BOX },
        uFall: { value: RAIN_FALL },
        uRel: { value: this.rainRel },
        uRain: { value: 0 },
        uScreen: screenSize,
        uCityMap: { value: cityMap },
        uMapHalf: { value: mapHalf },
      },
      vertexShader: rainVertex,
      fragmentShader: rainFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const rainLines = new THREE.Mesh(rainGeo, this.rainMat);
    rainLines.frustumCulled = false;
    rainLines.renderOrder = 6;

    for (let c = 0; c < CLOUDS; c++) {
      const cx = this.rng.range(-CLOUD_SPAN / 2, CLOUD_SPAN / 2);
      const cz = this.rng.range(-CLOUD_SPAN / 2, CLOUD_SPAN / 2);
      const cy = this.rng.range(330, 950);
      const spread = this.rng.range(140, 320);
      for (let p = 0; p < PUFFS; p++) {
        const base = new THREE.Vector3(cx + this.rng.gauss() * spread, cy + this.rng.gauss() * 35, cz + this.rng.gauss() * spread * 0.7);
        this.puffs.push({ base, pos: base.clone(), size: this.rng.range(110, 300), seed: this.rng.next(), opacity: this.rng.range(0.28, 0.55) });
      }
    }
    const plane = new THREE.PlaneGeometry(1, 1);
    this.cloudGeo = new THREE.InstancedBufferGeometry();
    this.cloudGeo.index = plane.index;
    this.cloudGeo.setAttribute('position', plane.getAttribute('position'));
    this.cloudGeo.setAttribute('uv', plane.getAttribute('uv'));
    this.centers = new Float32Array(this.puffs.length * 3);
    this.infos = new Float32Array(this.puffs.length * 3);
    this.cloudGeo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    this.cloudGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.infos, 3).setUsage(THREE.DynamicDrawUsage));
    this.cloudGeo.instanceCount = this.puffs.length;
    const clouds = new THREE.Mesh(
      this.cloudGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...atmosphere },
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    clouds.frustumCulled = false;
    clouds.renderOrder = 4;
    CURTAINS.forEach((r, i) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 700, 64, 1, true),
        new THREE.ShaderMaterial({
          uniforms: { ...atmosphere, uLayer: { value: i } },
          vertexShader: curtainVertex,
          fragmentShader: curtainFragment,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      m.frustumCulled = false;
      m.renderOrder = 6;
      this.curtains.add(m);
    });
    this.group.add(clouds, rainLines, this.curtains, this.light);
  }

  private advance(dt: number) {
    if (this.forced) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const next: Record<Phase, [Phase, number, number]> = {
      clear: ['building', 30, 45],
      building: ['raining', 150, 240],
      raining: ['clearing', 30, 45],
      clearing: ['clear', 90, 150],
    };
    const [phase, lo, hi] = next[this.phase];
    this.phase = phase;
    this.timer = this.rng.range(lo, hi);
  }

  update(dt: number, time: number, camera: THREE.Camera) {
    this.advance(dt);
    const wantRain = this.phase === 'raining' || (this.phase === 'building' && this.timer < 15) ? 1 : 0;
    const wantCover = this.phase === 'clear' ? 0.35 : this.phase === 'clearing' ? 0.55 : 1;
    this.rain = damp(this.rain, wantRain, 0.12, dt);
    this.cover = damp(this.cover, wantCover, 0.06, dt);
    this.wet = damp(this.wet, this.rain > 0.3 ? 1 : 0, this.rain > 0.3 ? 0.08 : 0.015, dt);

    if (dt > 0) this.rainRel.subVectors(RAIN_FALL, this.lastCam.subVectors(camera.position, this.lastCam).divideScalar(dt)).clampLength(0, 600);
    this.lastCam.copy(camera.position);
    this.rainMat.uniforms.uRain.value = this.rain;

    this.flashNext -= dt;
    if (this.rain > 0.7 && this.flashNext <= 0) {
      this.flashNext = this.rng.range(8, 24);
      const fwd = camera.getWorldDirection(this.flashDir);
      const az = Math.atan2(fwd.z, fwd.x) + this.rng.range(-1.3, 1.3);
      atmosphere.uFlashDir.value.set(Math.cos(az), this.rng.range(0.15, 0.45), Math.sin(az)).normalize();
      this.flashT = 0.55;
      this.thunderStrength = this.rng.range(0.5, 1);
      this.thunderIn = this.rng.range(0.8, 3);
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      const t = 0.55 - this.flashT;
      this.lightning = (t < 0.08 ? 1 : t < 0.14 ? 0.2 : t < 0.22 ? 0.8 : Math.max(0, 1 - (t - 0.22) * 3)) * this.thunderStrength;
    } else this.lightning = 0;
    this.light.intensity = this.lightning * 2.5;

    atmosphere.uWet.value = this.wet;
    atmosphere.uLightning.value = this.lightning;
    atmosphere.uCloudCover.value = this.cover;
    atmosphere.uRain.value = this.rain;
    atmosphere.uHalo.value = 0.15 + 0.75 * this.rain;
    const k = this.rain;
    atmosphere.uFogDensity.value = THREE.MathUtils.lerp(CLEAR_FOG.density, RAIN_FOG.density, k);
    atmosphere.uFogBase.value = THREE.MathUtils.lerp(CLEAR_FOG.base, RAIN_FOG.base, k);
    atmosphere.uFogFalloff.value = THREE.MathUtils.lerp(CLEAR_FOG.falloff, RAIN_FOG.falloff, k);
    atmosphere.uFogLow.value.lerpColors(CLEAR_FOG.low, RAIN_FOG.low, k);
    atmosphere.uFogHigh.value.lerpColors(CLEAR_FOG.high, RAIN_FOG.high, k);
    this.curtains.position.copy(camera.position);
    this.curtains.visible = this.rain > 0.02;

    const cam = camera.position;
    let inside = 0;
    const drift = time;
    for (const p of this.puffs) {
      p.pos.set(
        ((((p.base.x + WIND.x * drift + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2,
        p.base.y,
        ((((p.base.z + WIND.z * drift + CLOUD_SPAN / 2) % CLOUD_SPAN) + CLOUD_SPAN) % CLOUD_SPAN) - CLOUD_SPAN / 2,
      );
      const d = p.pos.distanceTo(cam);
      const r = p.size * 0.42;
      if (d < r) inside += (1 - d / r) * p.opacity;
    }
    const order = this.puffs.map((p, i) => [i, p.pos.distanceToSquared(cam)] as const).sort((a, b) => b[1] - a[1]);
    order.forEach(([i], k) => {
      const p = this.puffs[i];
      this.centers.set([p.pos.x, p.pos.y, p.pos.z], k * 3);
      this.infos.set([p.size, p.seed, p.opacity], k * 3);
    });
    (this.cloudGeo.getAttribute('aCenter') as THREE.BufferAttribute).needsUpdate = true;
    (this.cloudGeo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
    atmosphere.uHaze.value = damp(atmosphere.uHaze.value, Math.min(1, inside * this.cover * 1.6), 4, dt);

    if (this.thunderIn > 0) this.thunderIn -= dt;
  }

  // Returns a thunder strength once, when a delayed thunderclap is due.
  takeThunder(): number {
    if (this.thunderIn > 0 || this.thunderIn === -1) return 0;
    this.thunderIn = -1;
    return this.thunderStrength;
  }
}
