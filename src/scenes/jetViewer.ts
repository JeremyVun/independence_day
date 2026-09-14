import * as THREE from 'three';
import { atmosphere } from '../core/atmosphere';
import { makeEnvironment } from '../core/env';
import { makeFlames, makeNavLights } from '../aircraft/fx';
import { ROSTER, jetById } from '../aircraft/roster';
import type { JetModel } from '../aircraft/types';
import type { Mode } from './mode';

// QA view: ?scene=jets&jet=<id|all>&view=<azimuthDeg>,<elevationDeg>,<distance>&throttle=0..1&boost=0..1
export function jetViewer(renderer: THREE.WebGLRenderer, params: URLSearchParams): Mode {
  atmosphere.uFogDensity.value = 0;
  atmosphere.uFogBase.value = 0;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.environment = makeEnvironment(renderer, {
    sky: 0x0c1220,
    horizon: 0x3a2a22,
    ground: 0x1a120c,
    spots: [{ dir: new THREE.Vector3(0.3, 1, 0.4), color: 0xffffff, size: 2.5 }],
  });
  scene.environmentIntensity = 1.2;
  const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
  key.position.set(8, 14, 6);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 1.4);
  rim.position.set(-10, 5, -12);
  scene.add(key, rim, new THREE.HemisphereLight(0x33405a, 0x2a1d14, 0.8));

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(40, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6, metalness: 0.2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  scene.add(floor);

  const which = params.get('jet') ?? ROSTER[0].id;
  const specs = which === 'all' ? ROSTER : [jetById(which)];
  const models: { model: JetModel; flames: ReturnType<typeof makeFlames> }[] = [];
  const cols = Math.ceil(Math.sqrt(specs.length));
  specs.forEach((spec, i) => {
    const model = spec.build();
    const flames = makeFlames(model, spec.engine.flame);
    model.root.add(flames.group, makeNavLights(model, new THREE.Vector3(0, 1, model.length / 2)));
    if (specs.length > 1) model.root.position.set(((i % cols) - (cols - 1) / 2) * 26, 0, (Math.floor(i / cols) - (cols - 1) / 2) * 30);
    scene.add(model.root);
    models.push({ model, flames });
  });

  const [az, el, dist] = (params.get('view') ?? `35,18,${specs.length > 1 ? 30 * cols : 30}`).split(',').map(Number);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  camera.position.set(Math.sin(a) * Math.cos(e) * dist, Math.sin(e) * dist, Math.cos(a) * Math.cos(e) * dist);
  camera.lookAt(0, 0, 0);
  const throttle = Number(params.get('throttle') ?? 0.6);
  const boost = Number(params.get('boost') ?? 0);

  return {
    scene,
    camera,
    update(_dt, time) {
      for (const { model, flames } of models) {
        const s = { time, throttle, boost, speed: 150, pitch: 0, roll: 0, yaw: 0 };
        flames.update(s);
        model.animate?.(s);
      }
    },
  };
}
