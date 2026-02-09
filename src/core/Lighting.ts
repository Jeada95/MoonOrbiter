import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

export class Lighting {
  readonly sunLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.AmbientLight;

  /** Angle du soleil en radians (0 = droite, tourne autour de Y) */
  private sunAngle = Math.PI / 4;

  constructor(scene: THREE.Scene) {
    // Lumière directionnelle (soleil)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.position.set(
      SPHERE_RADIUS * 50 * Math.cos(this.sunAngle),
      SPHERE_RADIUS * 10,
      SPHERE_RADIUS * 50 * Math.sin(this.sunAngle)
    );
    scene.add(this.sunLight);

    // Lumière ambiante faible (lumière cendrée / earthshine)
    this.ambientLight = new THREE.AmbientLight(0x222233, 0.15);
    scene.add(this.ambientLight);
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
