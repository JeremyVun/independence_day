import * as THREE from 'three';
import { atmosphere, MAX_DYN_LIGHTS } from './atmosphere';

export type Rgb = [number, number, number];

interface Light {
  x: number;
  y: number;
  z: number;
  color: Rgb;
  radius: number;
  scale: number;
}

interface Flash extends Light {
  life: number;
  age: number;
}

// Gameplay lights that reach the city: steady ones are re-added every frame, flashes fade on their own.
// Each frame the most visible few go to every world shader through `dynLight()`.
class DynamicLights {
  private steady: Light[] = [];
  private flashes: Flash[] = [];

  add(pos: THREE.Vector3, color: Rgb, radius: number) {
    this.steady.push({ x: pos.x, y: pos.y, z: pos.z, color, radius, scale: 1 });
  }

  flash(pos: THREE.Vector3, color: Rgb, radius: number, life: number) {
    if (this.flashes.length >= 48) this.flashes.shift();
    this.flashes.push({ x: pos.x, y: pos.y, z: pos.z, color, radius, scale: 1, life, age: 0 });
  }

  update(dt: number, camera: THREE.Vector3) {
    this.flashes = this.flashes.filter((f) => (f.age += dt) < f.life);
    for (const f of this.flashes) {
      const t = f.age / f.life;
      f.scale = (1 - t) * (1 - t);
    }
    const scored = [...this.steady, ...this.flashes].map((l) => {
      const d2 = (l.x - camera.x) ** 2 + (l.y - camera.y) ** 2 + (l.z - camera.z) ** 2;
      const r2 = l.radius * l.radius;
      return { l, score: Math.max(...l.color) * l.scale * (r2 / (d2 + r2)) };
    });
    scored.sort((a, b) => b.score - a.score);
    const pos = atmosphere.uDynPos.value;
    const col = atmosphere.uDynCol.value;
    atmosphere.uDynCount.value = Math.min(scored.length, MAX_DYN_LIGHTS);
    for (let i = 0; i < MAX_DYN_LIGHTS; i++) {
      const l = scored[i]?.l;
      if (l) {
        pos[i].set(l.x, l.y, l.z, l.radius);
        col[i].set(l.color[0] * l.scale, l.color[1] * l.scale, l.color[2] * l.scale);
      } else {
        pos[i].set(0, -1e5, 0, 1);
        col[i].set(0, 0, 0);
      }
    }
    this.steady.length = 0;
  }
}

export const dynLights = new DynamicLights();
