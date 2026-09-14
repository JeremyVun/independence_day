import * as THREE from 'three';
import { atmosphere, GLSL_COMMON } from '../core/atmosphere';
import { CITY_HALF, MAP_HALF, MAP_RES, PARK, RIVER_HALF } from './cityGen';

export function makeCityMapTexture(data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, MAP_RES, MAP_RES, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export const GLSL_RIVER = /* glsl */ `
float riverCenter(float z) { return 1150.0 + 260.0 * sin(z / 820.0 + 0.6) + 110.0 * sin(z / 310.0 + 1.9); }
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uCityMap;
uniform float uMapHalf;
uniform float uCityHalf;
uniform float uRiverHalf;
uniform vec4 uPark;
varying vec3 vWorld;
${GLSL_COMMON}
${GLSL_RIVER}

float dotLight(vec2 d, float sigma, float px) {
  float s = max(sigma, px * 0.7);
  return exp(-dot(d, d) / (2.0 * s * s)) * (sigma * sigma) / (s * s);
}

vec3 suburbs(vec2 xz, float px) {
  vec3 col = vec3(0.0);
  // Each neighbourhood has its own street angle and spacing, so the lights don't read as one grid from the air.
  vec2 region = floor(xz / 1700.0);
  float ang = (hash12(region + 5.1) - 0.5) * 1.3;
  vec2 rxz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * xz;
  vec2 q = rxz + (vec2(vnoise(xz * 0.0013), vnoise(xz * 0.0013 + 7.3)) - 0.5) * 260.0;
  float fall = exp(-max(length(xz) - 3200.0, 0.0) / 11000.0);
  float dens = smoothstep(0.3, 0.62, vnoise(xz * 0.0008 + 3.1)) * fall;
  dens *= 0.3 + 0.7 * smoothstep(0.25, 0.6, vnoise(xz * 0.0032 + 11.0));
  float strip = abs(fract(q.x / 780.0 + hash12(region + 9.0)) - 0.5) * 780.0;
  col += vec3(1.0, 0.72, 0.4) * 2.6 * dotLight(vec2(mod(q.y, 17.0) - 8.5, strip - 6.0), 1.1, px) * fall * step(0.3, hash12(region + 4.0));
  col += vec3(1.0, 0.62, 0.3) * 0.05 * exp(-strip * strip / 900.0) * fall * step(0.3, hash12(region + 4.0));
  vec2 cell = vec2(38.0 + 18.0 * hash12(region), 96.0 + 44.0 * hash12(region + 2.0));
  vec2 id = floor(q / cell);
  vec2 f = q - (id + 0.5) * cell;
  float lampOn = step(0.25, hash12(id * 0.13)) * dens;
  col += vec3(1.0, 0.55, 0.2) * 3.0 * dotLight(f, 1.4, px) * lampOn;
  col += vec3(1.0, 0.5, 0.18) * 0.1 * dotLight(f, 12.0, px) * lampOn;
  vec2 hcell = vec2(23.0, 29.0);
  vec2 hid = floor(q / hcell);
  vec2 hp = (vec2(hash12(hid), hash12(hid + 7.1)) - 0.5) * hcell * 0.6;
  vec2 hf = q - (hid + 0.5) * hcell - hp;
  float lit = step(0.72, hash12(hid * 1.37)) * dens;
  col += mix(vec3(1.0, 0.72, 0.42), vec3(0.6, 0.75, 1.0), step(0.85, hash12(hid + 3.3))) * 1.6 * dotLight(hf, 0.9, px) * lit;
  float hwy = abs(fract(xz.y / 2300.0 + 0.37) - 0.5) * 2300.0;
  float seg = floor(xz.x / 55.0);
  col += vec3(1.0, 0.6, 0.25) * 4.0 * dotLight(vec2(mod(xz.x, 55.0) - 27.5, hwy - 12.0), 1.3, px) * fall;
  float carT = fract(uTime * 0.18 + hash12(vec2(seg, 1.0)));
  float carX = (seg + carT) * 55.0;
  col += vec3(1.0, 0.1, 0.05) * 2.5 * dotLight(vec2(xz.x - carX, hwy - 4.0), 0.9, px) * step(0.35, hash12(vec2(seg, 2.0))) * fall;
  float carT2 = fract(-uTime * 0.2 + hash12(vec2(seg, 3.0)));
  col += vec3(1.0, 0.9, 0.7) * 2.5 * dotLight(vec2(xz.x - (seg + carT2) * 55.0, hwy + 4.0), 0.9, px) * step(0.4, hash12(vec2(seg, 4.0))) * fall;
  return col;
}

void main() {
  vec2 xz = vWorld.xz;
  float px = length(fwidth(xz));
  vec2 muv = (xz + uMapHalf) / (2.0 * uMapHalf);
  float inMap = step(max(abs(xz.x), abs(xz.y)), uMapHalf - 8.0);
  vec4 m = texture2D(uCityMap, muv) * inMap;
  float cityEdge = smoothstep(uCityHalf - 150.0, uCityHalf + 350.0, max(abs(xz.x), abs(xz.y)));

  float rd = abs(xz.x - riverCenter(xz.y)) - uRiverHalf;
  float park = step(uPark.x, xz.x) * step(xz.x, uPark.y) * step(uPark.z, xz.y) * step(xz.y, uPark.w);
  park = max(park, step(rd, 26.0) * step(0.0, rd));

  float n = fbm(xz * 0.045);
  vec3 lot = vec3(0.03, 0.028, 0.027) * (0.75 + 0.5 * n);
  vec3 asphalt = vec3(0.016, 0.016, 0.018) * (0.9 + 0.2 * vnoise(xz * 0.8));
  vec3 grass = vec3(0.01, 0.017, 0.01) * (0.6 + 0.8 * fbm(xz * 0.12));
  vec3 albedo = mix(lot, asphalt, m.r);
  albedo = mix(albedo, grass, park) * (1.0 - 0.35 * uWet);

  float power = cityPower(xz);
  vec3 light = vec3(0.022, 0.026, 0.04) + vec3(0.04, 0.05, 0.075) * uMoonDir.y;
  light += vec3(1.0, 0.5, 0.15) * m.a * 3.2 * (1.0 + 0.6 * m.r) * power;
  light += shipLight(vWorld, vec3(0.0, 1.0, 0.0)) + dynLight(vWorld, vec3(0.0, 1.0, 0.0));
  vec3 col = albedo * light;
  col += suburbs(xz, px) * cityEdge * (1.0 - step(rd, 0.0));

  vec3 toCam = cameraPosition - vWorld;
  float camDist = length(toCam);
  vec3 v = toCam / camDist;
  vec2 away = -normalize(v.xz + 1e-5) / (2.0 * uMapHalf);
  float sheen = 0.0;
  for (int i = 1; i <= 6; i++) sheen += texture2D(uCityMap, muv + away * (float(i) * 5.0 + 2.0)).a;
  float grazing = pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0);
  float shimmer = 0.6 + 0.4 * vnoise(xz * vec2(0.9, 0.3));
  col += vec3(1.0, 0.52, 0.18) * sheen * mix(m.r, 1.0, uWet * 0.6) * grazing * shimmer * (0.05 + 0.3 * uWet) * smoothstep(1400.0, 300.0, camDist) * inMap * power;

  if (rd < 0.0) {
    vec3 view = normalize(cameraPosition - vWorld);
    vec2 w = xz * 0.06 + vec2(uTime * 0.05, uTime * 0.03);
    vec3 nrm = normalize(vec3((vnoise(w) - 0.5) * 0.25, 1.0, (vnoise(w + 9.7) - 0.5) * 0.25));
    vec3 r = reflect(-view, nrm);
    float fres = 0.02 + 0.98 * pow(1.0 - max(view.y, 0.0), 5.0);
    vec3 refl = fogColorFor(r) * 1.4 + vec3(0.9, 0.95, 1.0) * pow(max(dot(r, uMoonDir), 0.0), 350.0) * 6.0;
    col = vec3(0.003, 0.005, 0.009) + refl * fres + vec3(1.0, 0.5, 0.15) * m.a * 0.6 * fres;
  }

  gl_FragColor = vec4(nightFog(col, vWorld), 1.0);
}
`;

export function buildGround(cityMap: THREE.Texture): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...atmosphere,
      uCityMap: { value: cityMap },
      uMapHalf: { value: MAP_HALF },
      uCityHalf: { value: CITY_HALF },
      uRiverHalf: { value: RIVER_HALF },
      uPark: { value: new THREE.Vector4(PARK.x0, PARK.x1, PARK.z0, PARK.z1) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  mesh.frustumCulled = false;
  return mesh;
}
