import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

export class Lighting {
  readonly sunLight: THREE.DirectionalLight;

  /** Angle du soleil en radians (0 = droite, tourne autour de Y) */
  private sunAngle = Math.PI / 4;

  constructor(scene: THREE.Scene) {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.position.set(
      SPHERE_RADIUS * 50 * Math.cos(this.sunAngle),
      SPHERE_RADIUS * 10,
      SPHERE_RADIUS * 50 * Math.sin(this.sunAngle)
    );
    scene.add(this.sunLight);
  }

  /** Met à jour la position du soleil (angle en degrés, 0-360) */
  setSunAngle(degrees: number) {
    this.sunAngle = THREE.MathUtils.degToRad(degrees);
    this.sunLight.position.set(
      SPHERE_RADIUS * 50 * Math.cos(this.sunAngle),
      SPHERE_RADIUS * 10,
      SPHERE_RADIUS * 50 * Math.sin(this.sunAngle)
    );
  }

  getSunAngleDegrees(): number {
    return THREE.MathUtils.radToDeg(this.sunAngle);
  }
}
