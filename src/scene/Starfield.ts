/**
 * Procedural starfield background using THREE.Points.
 *
 * ~8000 stars on a large sphere (R=500), well beyond the camera maxDistance (100).
 * Stars have varying brightness and subtle color temperature variations.
 * No external textures needed — fully procedural.
 */

import * as THREE from 'three';

const STAR_COUNT = 8000;
const SPHERE_RADIUS = 500;

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Ensures the starfield is deterministic across reloads.
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Starfield {
  private points: THREE.Points;

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(STAR_COUNT * 3);
    const colors = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);

    const rng = mulberry32(42); // deterministic seed

    for (let i = 0; i < STAR_COUNT; i++) {
      // Marsaglia method for uniform distribution on sphere
      let u: number, v: number, s: number;
      do {
        u = rng() * 2 - 1;
        v = rng() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1);

      const f = Math.sqrt(1 - s);
      const x = 2 * u * f;
      const y = 2 * v * f;
      const z = 1 - 2 * s;

      positions[i * 3] = x * SPHERE_RADIUS;
      positions[i * 3 + 1] = y * SPHERE_RADIUS;
      positions[i * 3 + 2] = z * SPHERE_RADIUS;

      // Brightness: power-law distribution (most dim, few bright)
      const brightness = Math.pow(rng(), 2.5) * 0.7 + 0.3; // range 0.3 → 1.0

      // Subtle color temperature variation
      // Most stars white, some slightly blue, some slightly yellow/orange
      const temp = rng();
      let r: number, g: number, b: number;
      if (temp < 0.15) {
        // Blue-white (hot stars)
        r = 0.7 * brightness;
        g = 0.8 * brightness;
        b = 1.0 * brightness;
      } else if (temp > 0.85) {
        // Yellow-orange (cool stars)
        r = 1.0 * brightness;
        g = 0.85 * brightness;
        b = 0.6 * brightness;
      } else {
        // White (most stars)
        r = brightness;
        g = brightness;
        b = brightness;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Size: most stars 1px, a few brighter ones 2-3px
      sizes[i] = brightness > 0.85 ? 1.5 + rng() * 1.5 : 0.8 + rng() * 0.7;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: false,
      transparent: false,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.renderOrder = -1; // Render behind everything
    scene.add(this.points);
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.parent?.remove(this.points);
  }
}
