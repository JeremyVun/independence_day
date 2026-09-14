import * as THREE from 'three';
import { BRIDGE_DECK, RIVER_HALF, riverX, type CityData } from './cityGen';

const CELL = 50;

export type HitKind = 'ground' | 'water' | 'building' | 'ship';

export class CityCollision {
  private boxes: number[] = [];
  private grid = new Map<number, number[]>();

  constructor(city: CityData) {
    for (const b of city.buildings) {
      for (const t of b.tiers) this.add(b.x - t.w / 2, t.y0, b.z - t.d / 2, b.x + t.w / 2, t.y1, b.z + t.d / 2);
      if (b.tip > b.top + 2) this.add(b.x - 2, b.top, b.z - 2, b.x + 2, b.tip, b.z + 2);
    }
    for (const br of city.bridges) {
      this.add(br.x0 + 60, BRIDGE_DECK - 3, br.z - br.width / 2, br.x1 - 60, BRIDGE_DECK + 1, br.z + br.width / 2);
      if (br.suspension) {
        const rx = riverX(br.z);
        for (const tx of [rx - RIVER_HALF * 0.55, rx + RIVER_HALF * 0.55]) {
          this.add(tx - 5, 0, br.z - br.width / 2 - 3, tx + 5, BRIDGE_DECK + 96, br.z + br.width / 2 + 3);
        }
      }
    }
  }

  private key(ix: number, iz: number) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  private add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const id = this.boxes.length / 6;
    this.boxes.push(x0, y0, z0, x1, y1, z1);
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = this.key(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(id);
      }
    }
  }

  hit(p: THREE.Vector3, r: number): HitKind | null {
    if (p.y < r) return Math.abs(p.x - riverX(p.z)) < RIVER_HALF ? 'water' : 'ground';
    const list = this.grid.get(this.key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    if (!list) return null;
    const b = this.boxes;
    for (const id of list) {
      const o = id * 6;
      const dx = Math.max(b[o] - p.x, 0, p.x - b[o + 3]);
      const dy = Math.max(b[o + 1] - p.y, 0, p.y - b[o + 4]);
      const dz = Math.max(b[o + 2] - p.z, 0, p.z - b[o + 5]);
      if (dx * dx + dy * dy + dz * dz < r * r) return 'building';
    }
    return null;
  }

  heightAt(x: number, z: number): number {
    const list = this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let h = 0;
    if (!list) return h;
    const b = this.boxes;
    for (const id of list) {
      const o = id * 6;
      if (x >= b[o] - 10 && x <= b[o + 3] + 10 && z >= b[o + 2] - 10 && z <= b[o + 5] + 10) h = Math.max(h, b[o + 4]);
    }
    return h;
  }
}
