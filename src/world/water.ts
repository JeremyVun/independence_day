import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { riverX, RIVER_HALF } from './cityGen';
import { GLSL_RIVER } from './ground';
import { pointScale } from './lights';

const Z_EXTENT = 9000;
const STEP = 40;

const WaterShader = {
  name: 'NightRiver',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uRiverHalf: { value: RIVER_HALF },
    ...atmosphere,
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uRiverHalf;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${GLSL_COMMON}
    ${GLSL_RIVER}
    void main() {
      if (abs(vWorld.x - riverCenter(vWorld.z)) > uRiverHalf) discard;
      vec3 view = normalize(cameraPosition - vWorld);
      vec2 w = vWorld.xz * vec2(0.09, 0.22);
      vec2 ripple = vec2(vnoise(w + vec2(uTime * 0.3, 0.0)) - 0.5, vnoise(w * 1.7 + vec2(4.0, -uTime * 0.25)) - 0.5);
      ripple += 0.6 * vec2(vnoise(w * 3.1 + uTime * 0.5) - 0.5, vnoise(w * 3.3 - uTime * 0.45 + 9.0) - 0.5);
      ripple += uRain * 0.9 * vec2(vnoise(vWorld.xz * 1.1 + uTime * 5.0) - 0.5, vnoise(vWorld.xz * 1.2 - uTime * 5.3 + 3.0) - 0.5);
      vec4 uv = vUv;
      uv.x += ripple.x * 0.007 * uv.w;
      uv.y += ripple.y * 0.003 * uv.w;
      vec3 refl = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 9; i++) {
        float o = float(i) - 4.0;
        float wt = exp(-o * o * 0.1);
        vec4 u2 = uv;
        u2.y += o * 0.013 * uv.w;
        refl += min(texture2DProj(tDiffuse, u2).rgb, vec3(2.5)) * wt;
        wsum += wt;
      }
      refl /= wsum;
      float fres = 0.05 + 0.95 * pow(1.0 - max(view.y, 0.0), 5.0);
      vec3 col = vec3(0.002, 0.0035, 0.006) + refl * mix(0.65, 1.0, fres);
      vec3 nrm = normalize(vec3(ripple.x * 0.2, 1.0, ripple.y * 0.2));
      col += vec3(0.9, 0.95, 1.0) * pow(max(dot(reflect(-view, nrm), uMoonDir), 0.0), 900.0) * 1.5;
      col += dynLight(vWorld, nrm) * 0.03;
      gl_FragColor = vec4(nightFog(col, vWorld), 1.0);
    }
  `,
};

function riverGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const half = RIVER_HALF + 6;
  for (let z = -Z_EXTENT, i = 0; z <= Z_EXTENT; z += STEP, i++) {
    const cx = riverX(z);
    pos.push(cx - half, -z, 0, cx + half, -z, 0);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Planar reflection at a fraction of screen resolution; glow points are resized to match the smaller target.
// Only layer 0 is reflected, so objects on other layers (enemy fighters) render once.
export function makeReflector(geometry: THREE.BufferGeometry, shader: object, scale: number): Reflector {
  const dpr = Math.min(window.devicePixelRatio, 1.5);
  const size = () => [Math.max(256, Math.floor(window.innerWidth * dpr * scale)), Math.max(128, Math.floor(window.innerHeight * dpr * scale))];
  const [w, h] = size();
  const mesh = new Reflector(geometry, { textureWidth: w, textureHeight: h, clipBias: 0.002, shader, multisample: 0 });
  const render = mesh.onBeforeRender;
  const reflectionCamera = (mesh as unknown as { getReflectionCamera(c: THREE.Camera): THREE.Camera }).getReflectionCamera.bind(mesh);
  mesh.onBeforeRender = (...args) => {
    reflectionCamera(args[2]).layers.set(0);
    const full = pointScale.value;
    pointScale.value = full * scale;
    render.apply(mesh, args);
    pointScale.value = full;
  };
  window.addEventListener('resize', () => {
    const [nw, nh] = size();
    mesh.getRenderTarget().setSize(nw, nh);
  });
  return mesh;
}

export class River {
  readonly mesh: Reflector;

  constructor() {
    this.mesh = makeReflector(riverGeometry(), WaterShader, 0.5);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.3;
    const mat = this.mesh.material as THREE.ShaderMaterial;
    mat.uniforms.uTime = atmosphere.uTime;
    mat.uniforms.uRain = atmosphere.uRain;
    mat.uniforms.uFogLow = atmosphere.uFogLow;
    mat.uniforms.uFogHigh = atmosphere.uFogHigh;
    mat.uniforms.uFogDensity = atmosphere.uFogDensity;
    mat.uniforms.uFogBase = atmosphere.uFogBase;
    mat.uniforms.uFogFalloff = atmosphere.uFogFalloff;
    mat.uniforms.uDynPos = atmosphere.uDynPos;
    mat.uniforms.uDynCol = atmosphere.uDynCol;
    mat.uniforms.uDynCount = atmosphere.uDynCount;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -4;
  }
}
