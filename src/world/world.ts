import * as THREE from 'three';
import { applyNightFog, atmosphere, MOON_DIR } from '../core/atmosphere';
import { dynLights } from '../core/dynLights';
import { buildBuildings } from './buildings';
import { BRIDGE_DECK, generateCity, MAP_HALF, RIVER_HALF, riverX, type Bridge, type CityData } from './cityGen';
import { CityCollision, type HitKind } from './collision';
import { buildGround, makeCityMapTexture } from './ground';
import { Horizon } from './horizon';
import { buildAviationLights, buildStreetLamps, buildTraffic, makeGlowPoints, updatePointScale } from './lights';
import { Mothership, SHIP_CORE } from './mothership';
import { Siege } from './siege';
import { Sky } from './sky';
import { River } from './water';
import { Weather } from './weather';

function bridgeMeshes(bridges: Bridge[]): { mesh: THREE.Mesh; lights: THREE.Points } {
  const geos: THREE.BufferGeometry[] = [];
  const lightPos: number[] = [];
  const lightCol: number[] = [];
  const lightSize: number[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    geos.push(g);
  };
  const ramp = (xa: number, xb: number, ya: number, yb: number, z: number, w: number) => {
    const len = Math.hypot(xb - xa, yb - ya);
    const g = new THREE.BoxGeometry(len, 2, w);
    g.rotateZ(Math.atan2(yb - ya, xb - xa));
    g.translate((xa + xb) / 2, (ya + yb) / 2 - 1, z);
    geos.push(g);
  };
  for (const br of bridges) {
    const rx = riverX(br.z);
    const d0 = br.x0 + 80;
    const d1 = br.x1 - 80;
    ramp(br.x0, d0, 0, BRIDGE_DECK, br.z, br.width);
    ramp(d1, br.x1, BRIDGE_DECK, 0, br.z, br.width);
    box(d0, BRIDGE_DECK - 3, br.z - br.width / 2, d1, BRIDGE_DECK, br.z + br.width / 2);
    for (const s of [-1, 1]) box(d0, BRIDGE_DECK, br.z + s * br.width / 2 - 0.6, d1, BRIDGE_DECK + 1.2, br.z + s * br.width / 2);
    if (!br.suspension) {
      for (let x = d0 + 45; x < d1 - 20; x += 55) box(x - 3, -2, br.z - br.width / 2 + 2, x + 3, BRIDGE_DECK - 3, br.z + br.width / 2 - 2);
      continue;
    }
    const towers = [rx - RIVER_HALF * 0.55, rx + RIVER_HALF * 0.55];
    const top = BRIDGE_DECK + 95;
    for (const tx of towers) {
      for (const s of [-1, 1]) box(tx - 3, -2, br.z + s * (br.width / 2 + 1) - 2, tx + 3, top, br.z + s * (br.width / 2 + 1) + 2);
      for (const y of [BRIDGE_DECK + 30, top - 8]) box(tx - 2.5, y, br.z - br.width / 2 - 1, tx + 2.5, y + 4, br.z + br.width / 2 + 1);
    }
    const cableY = (x: number) => {
      if (x < towers[0]) return top - (top - BRIDGE_DECK - 2) * Math.pow((towers[0] - x) / (towers[0] - d0), 1.4);
      if (x > towers[1]) return top - (top - BRIDGE_DECK - 2) * Math.pow((x - towers[1]) / (d1 - towers[1]), 1.4);
      const t = (x - towers[0]) / (towers[1] - towers[0]);
      return BRIDGE_DECK + 4 + (top - BRIDGE_DECK - 4) * Math.pow(2 * t - 1, 2);
    };
    for (let x = d0; x <= d1; x += 3.5) {
      for (const s of [-1, 1]) {
        lightPos.push(x, cableY(x), br.z + s * (br.width / 2 + 1));
        lightCol.push(2.4, 2.3, 2.0);
        lightSize.push(1.6);
      }
    }
    for (let x = d0; x < d1; x += 2) {
      const y = cableY(x);
      const y2 = cableY(x + 2);
      for (const s of [-1, 1]) {
        const len = Math.hypot(2, y2 - y);
        const g = new THREE.BoxGeometry(len, 0.7, 0.7);
        g.rotateZ(Math.atan2(y2 - y, 2));
        g.translate(x + 1, (y + y2) / 2, br.z + s * (br.width / 2 + 1));
        geos.push(g);
      }
    }
  }
  const merged = mergeBoxes(geos);
  const mat = applyNightFog(new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.8, metalness: 0.2 }));
  return {
    mesh: new THREE.Mesh(merged, mat),
    lights: makeGlowPoints({ positions: lightPos, colors: lightCol, sizes: lightSize }),
  };
}

function mergeBoxes(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vCount = 0;
  let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index!.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const idx = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, vo * 3);
    nrm.set(g.attributes.normal.array as Float32Array, vo * 3);
    const src = g.index!.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    vo += g.attributes.position.count;
    io += src.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly city: CityData;
  readonly collision: CityCollision;
  readonly sky: Sky;
  readonly ship = new Mothership();
  readonly siege: Siege;
  readonly weather: Weather;
  readonly horizon = new Horizon();

  constructor(opts: { weather?: string | null } = {}) {
    this.city = generateCity();
    this.collision = new CityCollision(this.city);
    const cityMap = makeCityMapTexture(this.city.map);
    this.scene.add(buildGround(cityMap));
    this.scene.add(buildBuildings(this.city, cityMap));
    this.scene.add(buildStreetLamps(this.city));
    this.scene.add(buildTraffic(this.city));
    this.scene.add(buildAviationLights(this.city));
    const bridges = bridgeMeshes(this.city.bridges);
    this.scene.add(bridges.mesh, bridges.lights);
    this.sky = new Sky(this.scene);
    this.scene.add(this.ship.group);
    this.siege = new Siege(this.city, this.ship);
    this.scene.add(this.siege.group, this.horizon.group);
    this.scene.add(new River().mesh);
    this.weather = new Weather(opts.weather ?? null, cityMap, MAP_HALF);
    this.scene.add(this.weather.group);
    atmosphere.uShipLightPos.value.copy(SHIP_CORE);

    const moon = new THREE.DirectionalLight(0xa9bbe6, 1.7);
    moon.position.copy(MOON_DIR).multiplyScalar(1000);
    this.scene.add(moon);
    this.scene.add(new THREE.HemisphereLight(0x22304e, 0xa8622a, 0.75));
  }

  hit(p: THREE.Vector3, r: number): HitKind | null {
    return this.collision.hit(p, r) ?? (this.ship.hit(p, r) ? 'ship' : null);
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, bufferHeight: number) {
    atmosphere.uTime.value = time;
    this.weather.update(dt, time, camera);
    this.ship.update(dt, time, camera.position);
    this.siege.update(dt, time, camera);
    this.horizon.update(dt, time);
    this.sky.follow(camera);
    dynLights.update(dt, camera.position);
    updatePointScale(camera, bufferHeight);
  }
}
