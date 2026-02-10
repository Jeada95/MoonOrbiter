import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

const SUN_DIST = SPHERE_RADIUS * 50;

export class Lighting {
  readonly sunLight: THREE.DirectionalLight;

  /** Sun angle in radians (manual mode, 0 = +X direction, rotates in XZ plane) */
  private sunAngle = Math.PI / 4;

  constructor(scene: THREE.Scene) {
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.updateManualPosition();
    scene.add(this.sunLight);
  }

  // ─── Manual mode ───────────────────────────────────────────

  /** Set sun angle in degrees (0-360), equatorial plane (Y=0) */
  setSunAngle(degrees: number): void {
    this.sunAngle = THREE.MathUtils.degToRad(degrees);
    this.updateManualPosition();
  }

  getSunAngleDegrees(): number {
    return THREE.MathUtils.radToDeg(this.sunAngle);
  }

  private updateManualPosition(): void {
    this.sunLight.position.set(
      SUN_DIST * Math.cos(this.sunAngle),
      0, // no Y-offset — equatorial illumination for dramatic terminator
      SUN_DIST * Math.sin(this.sunAngle),
    );
  }

  // ─── Astronomical mode ─────────────────────────────────────

  /** Set sun position from a normalized direction vector (astronomical mode) */
  setSunDirection(dir: THREE.Vector3): void {
    this.sunLight.position.copy(dir).multiplyScalar(SUN_DIST);
  }

}
