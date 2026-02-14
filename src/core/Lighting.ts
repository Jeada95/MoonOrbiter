import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

const SUN_DIST = SPHERE_RADIUS * 50;

export class Lighting {
  readonly sunLight: THREE.DirectionalLight;

  constructor(scene: THREE.Scene) {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    // Default position until astronomical mode sets it
    this.sunLight.position.set(SUN_DIST, 0, 0);
    scene.add(this.sunLight);
  }

  /** Set sun position from a normalized direction vector (astronomical mode) */
  setSunDirection(dir: THREE.Vector3): void {
    this.sunLight.position.copy(dir).multiplyScalar(SUN_DIST);
  }
}
