import * as THREE from 'three';
import { atmosphere, GLSL_COMMON, MOON_DIR } from '../core/atmosphere';
import { Rng } from '../core/rng';

const SKY_R = 45000;

function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${GLSL_COMMON}
      void main() {
        vec3 d = normalize(vDir);
        vec3 zenith = vec3(0.0025, 0.004, 0.011);
        vec3 col = mix(fogColorFor(d), zenith, smoothstep(0.02, 0.55, d.y));
        float m = max(dot(d, uMoonDir), 0.0);
        col += (vec3(0.05, 0.06, 0.09) * pow(m, 24.0) + vec3(0.02, 0.025, 0.04) * pow(m, 4.0)) * (1.0 - 0.8 * uCloudCover);
        col = mix(col, fogColorFor(d) * 1.15, smoothstep(0.4, 1.0, uCloudCover) * (0.6 + 0.4 * uRain));
        col += vec3(0.1, 0.11, 0.16) * flashAt(d) * (0.4 + 0.6 * smoothstep(-0.1, 0.5, d.y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function stars(): THREE.Points {
  const rng = new Rng(31);
  const pos: number[] = [];
  const mag: number[] = [];
  for (let i = 0; i < 3500; i++) {
    const u = rng.range(0.03, 1);
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - u * u);
    pos.push(Math.cos(a) * r * SKY_R * 0.9, u * SKY_R * 0.9, Math.sin(a) * r * SKY_R * 0.9);
    mag.push(Math.pow(rng.next(), 6) * 2.2 + 0.08);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.Float32BufferAttribute(mag, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      attribute float aMag;
      varying float vB;
      uniform float uTime;
      uniform float uCloudCover;
      void main() {
        vec3 d = normalize(position);
        float tw = 0.75 + 0.25 * sin(uTime * (1.3 + fract(aMag * 91.0) * 3.0) + aMag * 400.0);
        vB = aMag * tw * smoothstep(0.02, 0.35, d.y) * (1.0 - 0.95 * smoothstep(0.35, 0.9, uCloudCover));
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
        gl_PointSize = 1.6 + aMag * 0.8;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vB;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = exp(-dot(c, c) * 18.0);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vB * a, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.renderOrder = -9;
  pts.frustumCulled = false;
  return pts;
}

function moon(): THREE.Mesh {
  const size = 2600;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uCloudCover: atmosphere.uCloudCover },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uCloudCover;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float r = length(vUv) / 0.34;
        float disc = smoothstep(1.0, 0.97, r);
        vec2 q = vUv / 0.34;
        float maria = n(q * 2.6 + 3.0) * 0.6 + n(q * 6.0) * 0.4;
        float limb = sqrt(max(1.0 - r * r, 0.0));
        vec3 surface = vec3(1.0, 0.97, 0.9) * (0.55 + 0.45 * limb) * (0.72 + 0.28 * smoothstep(0.35, 0.7, maria));
        vec3 col = surface * disc * 1.9;
        col += vec3(0.5, 0.55, 0.7) * exp(-max(r - 1.0, 0.0) * 2.8) * 0.18 * (1.0 - disc);
        gl_FragColor = vec4(col * (1.0 - 0.85 * smoothstep(0.35, 0.9, uCloudCover)), 1.0);
      }
    `,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.position.copy(MOON_DIR).multiplyScalar(SKY_R * 0.85);
  mesh.lookAt(0, 0, 0);
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  return mesh;
}

function clouds(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      ${GLSL_COMMON}
      void main() {
        vec2 p = vWorld.xz * 0.00022 + vec2(uTime * 0.0012, uTime * 0.0004);
        float c = fbm(p) * 0.65 + fbm(p * 3.1 + 4.0) * 0.35;
        float cover = smoothstep(0.5 - 0.25 * uCloudCover, 0.8 - 0.12 * uCloudCover, c);
        float below = step(cameraPosition.y, vWorld.y);
        float cityGlow = exp(-length(vWorld.xz) / 9000.0);
        vec3 under = vec3(0.09, 0.055, 0.035) * (0.4 + 1.2 * cityGlow) * (0.6 + 0.8 * c);
        vec3 over = vec3(0.05, 0.06, 0.085) * (0.5 + c);
        under += vec3(0.5, 0.55, 0.72) * flashAt(normalize(vWorld - cameraPosition)) * 1.8 * (0.5 + c);
        vec3 col = mix(over, under, below);
        float dist = length(vWorld - cameraPosition);
        float fade = 1.0 - smoothstep(18000.0, 36000.0, dist);
        gl_FragColor = vec4(nightFog(col, vWorld), cover * 0.88 * fade);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 3000;
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

export class Sky {
  readonly dome = new THREE.Group();
  readonly clouds = clouds();

  constructor(scene: THREE.Scene) {
    this.dome.add(skyDome(), stars(), moon());
    scene.add(this.dome, this.clouds);
  }

  follow(camera: THREE.Camera) {
    this.dome.position.copy(camera.position);
  }
}
