import * as THREE from 'three';
import { makeGlowPoints } from '../world/lights';
import type { JetAnimState, JetModel } from './types';

const flameVertex = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const flameFragment = /* glsl */ `
uniform float uPower;
uniform float uBoost;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uOuter;
uniform float uGain;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float t = clamp(vT, 0.0, 1.0);
  float edge = pow(clamp(abs(dot(vN, vV)), 0.0, 1.0), 1.4);
  float flick = 0.82 + 0.18 * sin(uTime * 71.0 + t * 23.0) * sin(uTime * 37.0);
  float fall = pow(1.0 - t, 1.6);
  float diamonds = uBoost * pow(clamp(0.5 + 0.5 * cos(t * 30.0 - uTime * 4.0), 0.0, 1.0), 8.0) * (1.0 - t) * 1.5;
  vec3 col = mix(uCore, uOuter, smoothstep(0.0, 0.7, t)) * fall * edge * flick * uPower + uCore * diamonds * edge;
  gl_FragColor = vec4(col * uGain, 1.0);
}
`;

export interface Flame {
  group: THREE.Group;
  update(s: JetAnimState): void;
}

export function makeFlames(model: JetModel, color: [number, number, number]): Flame {
  const group = new THREE.Group();
  const uniforms = {
    uPower: { value: 0.5 },
    uBoost: { value: 0 },
    uTime: { value: 0 },
    uCore: { value: new THREE.Color(0.75, 0.85, 1.0) },
    uOuter: { value: new THREE.Color(...color) },
    uGain: { value: 3.0 },
  };
  const coreUniforms = { ...uniforms, uGain: { value: 3.2 }, uOuter: { value: new THREE.Color(1.0, 0.9, 0.8) } };
  const mat = (u: typeof uniforms) =>
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: flameVertex,
      fragmentShader: flameFragment,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
  const outerMat = mat(uniforms);
  const coreMat = mat(coreUniforms);
  const flames: THREE.Object3D[] = [];
  for (const n of model.nozzles) {
    const holder = new THREE.Group();
    holder.position.copy(n.pos);
    const outer = new THREE.ConeGeometry(n.r * 0.95, n.r * 9, 14, 1, true);
    outer.rotateX(Math.PI / 2);
    outer.translate(0, 0, n.r * 4.5);
    const core = new THREE.ConeGeometry(n.r * 0.55, n.r * 5, 12, 1, true);
    core.rotateX(Math.PI / 2);
    core.translate(0, 0, n.r * 2.5);
    holder.add(new THREE.Mesh(outer, outerMat), new THREE.Mesh(core, coreMat));
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(n.r * 0.85, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...color).multiplyScalar(0.5) }),
    );
    disc.position.z = -0.3;
    holder.add(disc);
    group.add(holder);
    flames.push(holder);
  }
  return {
    group,
    update(s) {
      const power = 0.05 + 0.22 * s.throttle * s.throttle + 1.15 * s.boost;
      uniforms.uPower.value = coreUniforms.uPower.value = power;
      uniforms.uBoost.value = coreUniforms.uBoost.value = s.boost;
      uniforms.uTime.value = coreUniforms.uTime.value = s.time;
      const len = 0.35 + 0.5 * s.throttle + 0.9 * s.boost + 0.05 * Math.sin(s.time * 40);
      for (const f of flames) f.scale.set(1, 1, len);
    },
  };
}

export function makeNavLights(model: JetModel, tail: THREE.Vector3): THREE.Points {
  const [l, r] = model.wingtips;
  return makeGlowPoints({
    positions: [l.x, l.y, l.z, r.x, r.y, r.z, tail.x, tail.y, tail.z, l.x, l.y, l.z + 0.3, r.x, r.y, r.z + 0.3],
    colors: [3, 0.1, 0.05, 0.1, 3, 0.6, 2.2, 2.2, 2.5, 3, 3, 3.3, 3, 3, 3.3],
    sizes: [0.9, 0.9, 0.8, 1.0, 1.0],
    blink: [0, 0, 0, 0, 1.3, 0.1, 1.3, 0.5, 1.3, 0.5],
    minPx: 1.4,
  });
}
