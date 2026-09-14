import * as THREE from 'three';
import { makeEnvironment } from '../core/env';
import { applyNightFog } from '../core/atmosphere';
import { damp, Rng } from '../core/rng';
import { makeNavLights } from '../aircraft/fx';
import { Particles } from '../game/particles';
import { ROSTER } from '../aircraft/roster';
import type { JetModel } from '../aircraft/types';
import { makeGlowPoints } from '../world/lights';
import { makeReflector } from '../world/water';
import type { Mode } from './mode';

const JET_Y = 3.4;

function floorTexture(): THREE.CanvasTexture {
  const size = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#3a3a3c';
  c.fillRect(0, 0, size, size);
  const rng = new Rng(3);
  for (let i = 0; i < 26000; i++) {
    const v = 40 + rng.range(-14, 14);
    c.fillStyle = `rgba(${v},${v},${v + 2},0.35)`;
    c.fillRect(rng.range(0, size), rng.range(0, size), rng.range(2, 14), rng.range(2, 14));
  }
  c.strokeStyle = 'rgba(20,20,22,0.8)';
  c.lineWidth = 3;
  for (let x = 0; x <= size; x += 256) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, size);
    c.moveTo(0, x);
    c.lineTo(size, x);
    c.stroke();
  }
  for (let i = 0; i < 60; i++) {
    c.fillStyle = `rgba(10,10,12,${rng.range(0.08, 0.25)})`;
    c.beginPath();
    c.ellipse(rng.range(0, size), rng.range(0, size), rng.range(20, 120), rng.range(10, 60), rng.range(0, 3), 0, Math.PI * 2);
    c.fill();
  }
  const cx = size / 2;
  c.strokeStyle = 'rgba(214,168,40,0.85)';
  c.lineWidth = 16;
  c.beginPath();
  c.arc(cx, cx, 330, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([60, 40]);
  c.lineWidth = 10;
  c.beginPath();
  c.arc(cx, cx, 380, 0, Math.PI * 2);
  c.stroke();
  c.setLineDash([]);
  c.lineWidth = 14;
  c.beginPath();
  c.moveTo(cx, cx - 380);
  c.lineTo(cx, 0);
  c.stroke();
  for (let y = 60; y < cx - 420; y += 110) {
    c.fillStyle = 'rgba(214,168,40,0.8)';
    c.beginPath();
    c.moveTo(cx - 34, y + 40);
    c.lineTo(cx, y);
    c.lineTo(cx + 34, y + 40);
    c.lineTo(cx + 34, y + 60);
    c.lineTo(cx, y + 20);
    c.lineTo(cx - 34, y + 60);
    c.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lightCone(height: number, radius: number, color: THREE.Color, strength: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.5, radius, height, 32, 1, true);
  g.translate(0, -height / 2, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uStrength: { value: strength }, uHeight: { value: height } },
    vertexShader: /* glsl */ `
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vY = -position.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uHeight;
      varying float vY;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float t = clamp(vY / uHeight, 0.0, 1.0);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float fall = (1.0 - t) * (1.0 - t) * 0.85 + 0.15 * (1.0 - t);
        gl_FragColor = vec4(uColor * edge * fall * uStrength, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(g, m);
}

const GlassShader = {
  name: 'BlackGlass',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
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
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec3 view = normalize(cameraPosition - vWorld);
      float fres = 0.04 + 0.96 * pow(1.0 - max(view.y, 0.0), 5.0);
      float r = length(vWorld.xz) / 9.7;
      vec3 refl = texture2DProj(tDiffuse, vUv).rgb;
      vec3 col = vec3(0.004, 0.0045, 0.005) + refl * mix(0.28, 0.85, fres) * (1.0 - 0.35 * r * r);
      col += vec3(0.02, 0.018, 0.015) * smoothstep(0.93, 1.0, r);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export interface HangarMode extends Mode {
  index: number;
  select(delta: number): void;
  // A distant blast or thunderclap: the building shakes, the lamps stutter and dust falls from the roof.
  rumble(strength: number): void;
}

export function hangarMode(renderer: THREE.WebGLRenderer, backdrop: THREE.Texture | null, startIndex = 0): HangarMode {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  scene.environment = makeEnvironment(renderer, {
    sky: 0x0a0a0c,
    horizon: 0x1a1612,
    ground: 0x141414,
    spots: [
      { dir: new THREE.Vector3(0, 1, 0.1), color: 0xfff2dd, size: 1.4 },
      { dir: new THREE.Vector3(-0.35, 0.25, -1), color: 0x33476a, size: 3.2 },
      { dir: new THREE.Vector3(0.8, 0.9, 0.3), color: 0x806850, size: 0.8 },
    ],
  });
  scene.environmentIntensity = 0.9;

  const std = (color: number, roughness: number, metalness = 0.2) => applyNightFog(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const floorMap = floorTexture();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), new THREE.MeshStandardMaterial({ map: floorMap, roughness: 0.42, metalness: 0.05, envMapIntensity: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  const outerFloor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), std(0x0e0e10, 0.7));
  outerFloor.rotation.x = -Math.PI / 2;
  outerFloor.position.y = -0.02;
  scene.add(floor, outerFloor);

  const wallMat = std(0x16171a, 0.85);
  const steel = std(0x2a2c31, 0.55, 0.6);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat = wallMat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  const doorX = -24;
  const doorW = 84;
  const doorH = 34;
  box(120, 40, 1, doorX - doorW / 2 - 60, 20, -58);
  box(120, 40, 1, doorX + doorW / 2 + 60, 20, -58);
  box(doorW, 40 - doorH, 1, doorX, doorH + (40 - doorH) / 2, -58);
  box(doorW + 4, 1.4, 2, doorX, doorH, -57.5, steel);
  for (const s of [-1, 1]) box(1.6, doorH, 2, doorX + s * (doorW / 2 + 0.8), doorH / 2, -57.5, steel);
  box(1, 40, 140, -70, 20, 10);
  box(1, 40, 140, 70, 20, 10);
  box(140, 1, 140, 0, 40, 10);
  for (let z = -50; z <= 70; z += 13) {
    box(140, 1.2, 0.8, 0, 33, z, steel);
    box(140, 0.6, 0.5, 0, 38.5, z, steel);
    for (let x = -66; x <= 66; x += 11) {
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7.5, 0.35), steel);
      diag.position.set(x + 2.75, 35.75, z);
      diag.rotation.z = (x / 11) % 2 === 0 ? 0.73 : -0.73;
      scene.add(diag);
    }
  }
  for (const [x, z] of [
    [-40, -40],
    [40, -40],
    [-40, 30],
    [40, 30],
  ]) {
    const crate = box(4, 2.4, 3, x, 1.2, z, std(0x2d3026, 0.8));
    crate.rotation.y = x * 0.01;
  }

  if (backdrop) {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(190, 95), new THREE.MeshBasicMaterial({ map: backdrop, toneMapped: false }));
    back.position.set(doorX - 18, 34, -150);
    scene.add(back);
    const doorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW, doorH),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.025, 0.04), transparent: true, opacity: 0.4, depthWrite: false }),
    );
    doorGlow.position.set(doorX, doorH / 2, -57);
    scene.add(doorGlow);
  }

  const lamps: [number, number, number][] = [
    [0, 31, 0],
    [-26, 31, -24],
    [26, 31, -24],
    [-30, 31, 24],
    [30, 31, 24],
  ];
  const bulbColor = new THREE.Color(6, 5, 3.8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: bulbColor.clone() });
  const lampLights: THREE.SpotLight[] = [];
  lamps.forEach(([x, y, z], i) => {
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.4, 1.2, 12, 1, true), steel);
    shade.position.set(x, y, z);
    scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16), bulbMat);
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(x, y - 0.55, z);
    scene.add(bulb);
    const cone = lightCone(y - 0.6, i === 0 ? 11 : 9, new THREE.Color(1, 0.86, 0.66), i === 0 ? 0.16 : 0.07);
    cone.position.set(x, y - 0.6, z);
    scene.add(cone);
    if (i > 0) {
      const s = new THREE.SpotLight(0xffe2bb, 520, 0, 0.42, 0.7, 2);
      s.position.set(x, y - 1, z);
      s.target.position.set(x, 0, z);
      scene.add(s, s.target);
      lampLights.push(s);
    }
  });
  const key = new THREE.SpotLight(0xfff0dc, 1400, 0, 0.36, 0.55, 2);
  key.position.set(0, 30, 0);
  key.target.position.set(0, JET_Y, 0);
  scene.add(key, key.target);
  lampLights.push(key);
  const lampPower = lampLights.map((l) => l.intensity);

  // An airfield searchlight outside now and then sweeps across the floor through the open doors.
  const sweep = new THREE.SpotLight(0xdfe6ff, 0, 0, 0.055, 0.6, 0);
  sweep.position.set(doorX + 40, 45, -260);
  scene.add(sweep, sweep.target);
  const sweepBeam = lightCone(1, 7, new THREE.Color(0.85, 0.9, 1), 0.05);
  sweepBeam.visible = false;
  scene.add(sweepBeam);
  const beamStart = new THREE.Vector3();
  const beamDir = new THREE.Vector3();
  let sweepT = -6;

  const fallingDust = new Particles(400, false);
  scene.add(fallingDust.points);
  let shake = 0;
  let flicker = 0;
  for (const s of [-1, 1]) {
    const rim = new THREE.SpotLight(0x8fb0ff, 170, 0, 0.3, 0.8, 2);
    rim.position.set(s * 16, 9, -20);
    rim.target.position.set(0, JET_Y, 0);
    scene.add(rim, rim.target);
  }
  const fill = new THREE.SpotLight(0xffd9b0, 260, 0, 0.6, 0.9, 2);
  fill.position.set(14, 9, 22);
  fill.target.position.set(0, JET_Y, 0);
  scene.add(fill, fill.target);
  const doorLight = new THREE.DirectionalLight(0x6a7a98, 0.35);
  doorLight.position.set(doorX, 12, -60);
  scene.add(doorLight, new THREE.HemisphereLight(0x1c1f26, 0x0d0b09, 0.45));

  const tableMat = std(0x141518, 0.55, 0.45);
  tableMat.envMapIntensity = 0.35;
  const table = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.4, 0.45, 64), tableMat);
  table.position.y = 0.22;
  scene.add(table);
  const glass = makeReflector(new THREE.CircleGeometry(9.7, 64), GlassShader, 0.6);
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = 0.46;
  scene.add(glass);
  const ringPos: number[] = [];
  const ringCol: number[] = [];
  const ringSize: number[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ringPos.push(Math.cos(a) * 10.2, 0.5, Math.sin(a) * 10.2);
    ringCol.push(3.2, 2.4, 1.4);
    ringSize.push(0.28);
  }
  scene.add(makeGlowPoints({ positions: ringPos, colors: ringCol, sizes: ringSize, minPx: 1.5 }));

  const rng = new Rng(12);
  const dustPos: number[] = [];
  const dustCol: number[] = [];
  const dustSize: number[] = [];
  for (let i = 0; i < 700; i++) {
    const r = Math.sqrt(rng.next()) * 10;
    const a = rng.range(0, Math.PI * 2);
    const y = rng.range(0.5, 29);
    const inBeam = 1 - r / (0.5 + (10.5 * (30 - y)) / 30);
    const b = Math.max(0.05, inBeam) * rng.range(0.2, 0.9);
    dustPos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    dustCol.push(b * 1.6, b * 1.4, b * 1.1);
    dustSize.push(0.05);
  }
  const dust = makeGlowPoints({ positions: dustPos, colors: dustCol, sizes: dustSize, minPx: 1.2 });
  scene.add(dust);

  const turntable = new THREE.Group();
  turntable.position.y = JET_Y;
  scene.add(turntable);
  let current: JetModel | null = null;
  let framing = 10;
  let arrive = 1;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.3, 1200);
  let camDist = 30;

  const mode: HangarMode = {
    scene,
    camera,
    index: startIndex,
    select(delta: number) {
      mode.index = (mode.index + delta + ROSTER.length) % ROSTER.length;
      if (current) turntable.remove(current.root);
      current = ROSTER[mode.index].build();
      current.root.add(makeNavLights(current, new THREE.Vector3(0, 1.2, current.length * 0.45)));
      turntable.add(current.root);
      framing = new THREE.Box3().setFromObject(current.root).getBoundingSphere(new THREE.Sphere()).radius;
      arrive = 0;
    },
    rumble(strength) {
      shake = Math.max(shake, 0.5 * strength);
      flicker = Math.max(flicker, 0.4 + 0.4 * strength);
      const puffs = Math.round(6 + 14 * strength);
      for (let i = 0; i < puffs; i++) {
        const p = new THREE.Vector3(THREE.MathUtils.randFloat(-50, 50), 32.5, THREE.MathUtils.randFloat(-45, 60));
        fallingDust.emit({ pos: p, vel: new THREE.Vector3(0, -1.5, 0), spread: 0.8, life: 5, size: [0.4, 2.2], color: [0.1, 0.095, 0.09], alpha: 0.45, drag: 0.6, rise: -2.5 }, 3);
      }
    },
    update(dt, time) {
      arrive = Math.min(1, arrive + dt * 2.6);
      const ease = 1 - Math.pow(1 - arrive, 3);
      turntable.rotation.y += dt * 0.32;
      turntable.position.y = JET_Y + Math.sin(time * 0.8) * 0.12 + (1 - ease) * 2.5;
      turntable.scale.setScalar(0.85 + 0.15 * ease);
      if (current) {
        current.animate?.({ time, throttle: 0, boost: 0, speed: 0, pitch: Math.sin(time * 0.5) * 0.3, roll: 0, yaw: 0 });
        camDist = damp(camDist, framing * 2.7 + 7, 3, dt);
      }
      const a = 0.5 + Math.sin(time * 0.07) * 0.12;
      camera.position.set(Math.sin(a) * camDist, 7.2 + Math.sin(time * 0.11) * 0.6, Math.cos(a) * camDist);
      camera.lookAt(-camDist * 0.12, JET_Y + 0.4, -2);
      if (shake > 0) {
        camera.rotateX((Math.random() - 0.5) * shake * 0.01);
        camera.rotateY((Math.random() - 0.5) * shake * 0.01);
        shake = Math.max(0, shake - dt * 1.5);
      }
      flicker = Math.max(0, flicker - dt * 0.9);
      const stutter = flicker > 0 && Math.random() < flicker ? 0.25 + 0.5 * Math.random() : 1;
      lampLights.forEach((l, i) => (l.intensity = lampPower[i] * stutter));
      bulbMat.color.copy(bulbColor).multiplyScalar(stutter);
      fallingDust.update(dt);

      sweepT += dt;
      if (sweepT > 16) sweepT = -THREE.MathUtils.randFloat(4, 14);
      const pass = THREE.MathUtils.clamp(sweepT / 7, 0, 1);
      const on = sweepT > 0 && sweepT < 7 ? Math.sin(pass * Math.PI) : 0;
      sweep.intensity = 3.2 * on;
      sweep.target.position.set(-58 + 70 * pass, 0, -44 + 60 * pass);
      sweepBeam.visible = on > 0.01;
      if (sweepBeam.visible) {
        beamStart.set(doorX + 32, doorH - 2, -57);
        beamDir.subVectors(sweep.target.position, beamStart);
        const len = beamDir.length();
        sweepBeam.position.copy(beamStart);
        sweepBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamDir.normalize());
        sweepBeam.scale.set(1, len, 1);
        (sweepBeam.material as THREE.ShaderMaterial).uniforms.uStrength.value = 0.05 * on;
      }
      const d = dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = d.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (0.06 + (i % 7) * 0.01);
        arr[i] += Math.sin(time * 0.3 + i) * dt * 0.05;
        if (arr[i + 1] > 29) arr[i + 1] = 0.5;
      }
      d.needsUpdate = true;
    },
  };
  mode.select(0);
  return mode;
}
