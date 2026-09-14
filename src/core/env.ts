import * as THREE from 'three';

// Builds a reflection environment from a tiny procedural scene so metal and glass pick up the city glow.
export function makeEnvironment(
  renderer: THREE.WebGLRenderer,
  opts: { sky: THREE.ColorRepresentation; horizon: THREE.ColorRepresentation; ground: THREE.ColorRepresentation; spots?: { dir: THREE.Vector3; color: THREE.ColorRepresentation; size: number }[] },
): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uSky: { value: new THREE.Color(opts.sky) },
      uHorizon: { value: new THREE.Color(opts.horizon) },
      uGround: { value: new THREE.Color(opts.ground) },
    },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSky, uHorizon, uGround;
      varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;
        vec3 c = y > 0.0 ? mix(uHorizon, uSky, pow(y, 0.5)) : mix(uHorizon, uGround, pow(-y, 0.35));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  for (const s of opts.spots ?? []) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(s.size, 12, 8), new THREE.MeshBasicMaterial({ color: s.color }));
    m.position.copy(s.dir).normalize().multiplyScalar(8);
    scene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return tex;
}
