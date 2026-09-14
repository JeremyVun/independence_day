import * as THREE from 'three';

export const MOON_DIR = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
export const MAX_DYN_LIGHTS = 8;
export const MAX_BLACKOUTS = 4;

export const atmosphere = {
  uDynPos: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
  uDynCol: { value: Array.from({ length: MAX_DYN_LIGHTS }, () => new THREE.Vector3()) },
  uDynCount: { value: 0 },
  uBlackout: { value: Array.from({ length: MAX_BLACKOUTS }, () => new THREE.Vector4(0, -1e5, 1, 0)) },
  uFogLow: { value: new THREE.Color(0.026, 0.019, 0.02) },
  uFogHigh: { value: new THREE.Color(0.005, 0.008, 0.019) },
  uFogDensity: { value: 0.00032 },
  uFogBase: { value: 0.000045 },
  uFogFalloff: { value: 1 / 320 },
  uMoonDir: { value: MOON_DIR.clone() },
  uTime: { value: 0 },
  uShipLightPos: { value: new THREE.Vector3(0, 700, 0) },
  uShipLightColor: { value: new THREE.Color(0.05, 0.3, 0.26) },
  uWet: { value: 0 },
  uLightning: { value: 0 },
  uFlashDir: { value: new THREE.Vector3(1, 0.3, 0).normalize() },
  uCloudCover: { value: 0.35 },
  uHaze: { value: 0 },
  uRain: { value: 0 },
  uHalo: { value: 0.15 },
};

export const CLEAR_FOG = {
  low: new THREE.Color(0.026, 0.019, 0.02),
  high: new THREE.Color(0.005, 0.008, 0.019),
  density: 0.00032,
  base: 0.000045,
  falloff: 1 / 320,
};
export const RAIN_FOG = {
  low: new THREE.Color(0.026, 0.022, 0.022),
  high: new THREE.Color(0.011, 0.012, 0.016),
  density: 0.0008,
  base: 0.00035,
  falloff: 1 / 700,
};

export type AtmosphereUniforms = typeof atmosphere;

export const GLSL_COMMON = /* glsl */ `
uniform vec3 uFogLow;
uniform vec3 uFogHigh;
uniform float uFogDensity;
uniform float uFogBase;
uniform float uFogFalloff;
uniform vec3 uMoonDir;
uniform float uTime;
uniform vec3 uShipLightPos;
uniform vec3 uShipLightColor;
uniform float uWet;
uniform float uLightning;
uniform vec3 uFlashDir;
uniform float uCloudCover;
uniform float uRain;
uniform float uHalo;
uniform vec4 uDynPos[${MAX_DYN_LIGHTS}];
uniform vec3 uDynCol[${MAX_DYN_LIGHTS}];
uniform float uDynCount;
uniform vec4 uBlackout[${MAX_BLACKOUTS}];

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// A lightning flash lights one part of the sky, not the whole view.
float flashAt(vec3 dir) {
  return uLightning * (0.2 + 0.8 * pow(max(dot(dir, uFlashDir), 0.0), 3.0));
}

vec3 fogColorFor(vec3 dir) {
  return mix(uFogLow, uFogHigh, clamp(dir.y * 2.2 + 0.25, 0.0, 1.0)) + vec3(0.75, 0.8, 1.0) * 0.11 * flashAt(dir);
}

// Analytic exponential height fog: density(h) = a * exp(-b * h), plus a thin uniform haze.
vec3 nightFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float b = uFogFalloff;
  float dy = d.y;
  float k = abs(b * dy) > 1e-4 ? (1.0 - exp(-b * dy)) / (b * dy) : 1.0;
  float optical = uFogDensity * exp(-b * max(cameraPosition.y, 0.0)) * k * dist + uFogBase * dist;
  float f = 1.0 - exp(-optical);
  return mix(col, fogColorFor(d / max(dist, 1e-3)), clamp(f, 0.0, 1.0));
}

float fogTransmittance(vec3 wpos) {
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float b = uFogFalloff;
  float k = abs(b * d.y) > 1e-4 ? (1.0 - exp(-b * d.y)) / (b * d.y) : 1.0;
  return exp(-(uFogDensity * exp(-b * max(cameraPosition.y, 0.0)) * k * dist + uFogBase * dist));
}

vec3 shipLight(vec3 wpos, vec3 n) {
  vec3 l = uShipLightPos - wpos;
  float dist = length(l);
  float fall = 1.0 / (1.0 + dist * dist * 0.0000035);
  return uShipLightColor * fall * (0.35 + 0.65 * max(dot(n, l / dist), 0.0)) + vec3(0.15, 0.17, 0.23) * uLightning * (0.35 + 0.65 * max(n.y, 0.0));
}

// Short-range lights from gameplay: afterburners, gunfire, explosions, fires. w is the radius.
vec3 dynLight(vec3 wpos, vec3 n) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_DYN_LIGHTS}; i++) {
    if (float(i) >= uDynCount) break;
    vec3 l = uDynPos[i].xyz - wpos;
    float d2 = dot(l, l);
    float r = uDynPos[i].w;
    float fall = max(1.0 - d2 / (r * r), 0.0);
    sum += uDynCol[i] * fall * fall * (0.2 + 0.8 * max(dot(n, l * inversesqrt(max(d2, 1e-4))), 0.0));
  }
  return sum;
}

// 1 where the grid is up, falling to 0 inside a blacked-out district.
float cityPower(vec2 xz) {
  float p = 1.0;
  for (int i = 0; i < ${MAX_BLACKOUTS}; i++) {
    vec4 b = uBlackout[i];
    if (b.w <= 0.0) continue;
    p *= 1.0 - b.w * smoothstep(b.z, b.z * 0.75, length(xz - b.xy));
  }
  return p;
}
`;

// Replace three's fog in a built-in material's shader with the shared height fog.
export function patchNightFog(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, atmosphere);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorld;')
    .replace(
      '#include <fog_vertex>',
      `vec4 fogWp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
fogWp = instanceMatrix * fogWp;
#endif
vFogWorld = (modelMatrix * fogWp).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vFogWorld;\n${GLSL_COMMON}`)
    .replace('#include <fog_fragment>', 'gl_FragColor.rgb = nightFog(gl_FragColor.rgb, vFogWorld);');
}

export function applyNightFog<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = patchNightFog;
  material.customProgramCacheKey = () => 'nightfog';
  return material;
}
