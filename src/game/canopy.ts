import * as THREE from 'three';
import { applyNightFog } from '../core/atmosphere';
import { makeGlowPoints } from '../world/lights';

function bar(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(radius, radius, len, 6, 1);
  g.translate(0, len / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

// Cockpit framing seen from the pilot's eye: windscreen posts, the canopy bow overhead, canopy rails and the top
// of the instrument panel. Built in eye space (x right, y up, -z ahead) and parented to the jet, so it stays put
// when the pilot looks around.
export function makeCanopy(eye: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.position.copy(eye);
  const frame = applyNightFog(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.5 }));
  const panel = applyNightFog(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85, metalness: 0.15 }));

  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (const s of [-1, 1]) {
    group.add(bar(V(s * 0.74, -0.62, -1.18), V(s * 0.6, 0.56, -0.6), 0.032, frame));
    group.add(bar(V(s * 0.6, 0.56, -0.6), V(s * 0.66, 0.5, 0.2), 0.03, frame));
    group.add(bar(V(s * 0.74, -0.62, -1.18), V(s * 0.95, -0.42, 0.4), 0.045, frame));
  }
  group.add(bar(V(-0.6, 0.56, -0.6), V(0.6, 0.56, -0.6), 0.03, frame));

  const coaming = new THREE.BoxGeometry(1.9, 0.3, 0.7);
  coaming.translate(0, -0.8, -1.02);
  const pos = coaming.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (pos.getY(i) > -0.8) pos.setY(i, pos.getY(i) + 0.06 * (1 - (x * x) / 0.95));
  }
  coaming.computeVertexNormals();
  group.add(new THREE.Mesh(coaming, panel));

  const lights = makeGlowPoints({
    positions: [-0.3, -0.62, -1.38, -0.25, -0.62, -1.38, 0.25, -0.62, -1.38, 0.3, -0.62, -1.38],
    colors: [0.9, 0.5, 0.1, 0.12, 0.8, 0.25, 0.12, 0.8, 0.25, 0.9, 0.12, 0.08],
    sizes: [0.012, 0.012, 0.012, 0.012],
    minPx: 3,
  });
  group.add(lights);
  group.traverse((o) => (o.frustumCulled = false));
  return group;
}
