import * as THREE from 'three';
import { applyNightFog, patchNightFog } from '../core/atmosphere';

export interface Paint {
  body: number;
  accent?: number;
  dark?: number;
  canopy?: 'gold' | 'smoke' | 'blue';
  metalness?: number;
  roughness?: number;
  camo?: number;
  camoScale?: number;
}

export interface JetMaterials {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
}

const CANOPY = { gold: 0x6b5520, smoke: 0x10141c, blue: 0x0e2233 };

// Scene-wide rim light on jet silhouettes; flight uses cool moonlight, the hangar sets its own.
export const jetLook = {
  uRimColor: { value: new THREE.Color(0.32, 0.4, 0.58) },
  uRimStrength: { value: 0.3 },
};

// Adds object-space panel lines, panel-to-panel shade variation, optional two-tone paint and a rim light.
function jetShading(material: THREE.MeshStandardMaterial, panels: number, camo: { color: THREE.Color; scale: number } | null) {
  material.onBeforeCompile = (shader) => {
    patchNightFog(shader);
    Object.assign(shader.uniforms, jetLook, {
      uPanels: { value: panels },
      uCamo: { value: camo?.color ?? new THREE.Color() },
      uCamoScale: { value: camo?.scale ?? 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;\nuniform float uPanels;\nuniform vec3 uCamo;\nuniform float uCamoScale;\nuniform vec3 uRimColor;\nuniform float uRimStrength;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 an = abs(vObjNormal);
          vec2 uvp = an.x > an.y && an.x > an.z ? vObjPos.zy : (an.y > an.z ? vObjPos.xz : vObjPos.xy);
          vec2 g = uvp / vec2(1.35, 0.85);
          g.x += mod(floor(g.y), 2.0) * 0.5;
          vec2 id = floor(g);
          vec2 f = fract(g);
          vec2 w = fwidth(g) * 1.3;
          vec2 m = smoothstep(vec2(0.0), w, f) * smoothstep(vec2(0.0), w, 1.0 - f);
          float line = (1.0 - m.x * m.y) * clamp(1.0 - max(w.x, w.y) * 2.5, 0.0, 1.0);
          float shade = 0.93 + 0.14 * hash12(id + floor(vObjPos.x * 0.2) * 7.0);
          diffuseColor.rgb *= mix(1.0, (1.0 - 0.3 * line) * shade, uPanels);
          if (uCamoScale > 0.0) {
            float c = smoothstep(0.47, 0.53, vnoise(vObjPos.xz * uCamoScale + vec2(vObjPos.y * 0.3, 3.1)));
            diffuseColor.rgb = mix(diffuseColor.rgb, uCamo * mix(1.0, (1.0 - 0.3 * line) * shade, uPanels), c);
          }
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight += uRimColor * uRimStrength * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `jet-${panels}-${camo ? 1 : 0}`;
  return material;
}

export function jetMaterials(p: Paint): JetMaterials {
  const std = (color: number, metalness: number, roughness: number) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });
  const camo = p.camo !== undefined ? { color: new THREE.Color(p.camo), scale: p.camoScale ?? 0.22 } : null;
  const glass = applyNightFog(std(CANOPY[p.canopy ?? 'smoke'], 1.0, 0.06));
  glass.emissive = new THREE.Color(0.0, 0.012, 0.009);
  return {
    body: jetShading(std(p.body, p.metalness ?? 0.4, p.roughness ?? 0.52), 1, camo),
    accent: jetShading(std(p.accent ?? p.body, p.metalness ?? 0.4, p.roughness ?? 0.55), 1, null),
    dark: jetShading(std(p.dark ?? 0x141518, 0.3, 0.7), 0.5, null),
    metal: jetShading(std(0x3a3632, 0.9, 0.35), 0, null),
    glass,
  };
}

// Self-lit parts (glowing intakes, seams, cores). Intensity ~2-4 so bloom picks them up.
export function glowMaterial(color: number, intensity = 3): THREE.MeshStandardMaterial {
  return applyNightFog(
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, metalness: 0, roughness: 1, flatShading: true }),
  );
}

// Dark shell whose reflections shift hue with viewing angle (thin-film iridescence).
export function iridescentMaterial(color: number): THREE.MeshPhysicalMaterial {
  return applyNightFog(
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.6,
      roughness: 0.38,
      iridescence: 1,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [250, 900],
      clearcoat: 0.2,
      clearcoatRoughness: 0.4,
      flatShading: true,
    }),
  );
}
