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

  // ─── Shadow mapping ────────────────────────────────────────

  enableShadows(renderer: THREE.WebGLRenderer): void {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);

    // Orthographic shadow camera encompassing the sphere
    const s = SPHERE_RADIUS * 1.5;
    this.sunLight.shadow.camera.near = SPHERE_RADIUS * 30;
    this.sunLight.shadow.camera.far = SPHERE_RADIUS * 70;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.camera.updateProjectionMatrix();

    // Force shadow map reallocation
    this.sunLight.shadow.map?.dispose();
    this.sunLight.shadow.map = null as any;
  }

  disableShadows(renderer: THREE.WebGLRenderer): void {
    renderer.shadowMap.enabled = false;
    this.sunLight.castShadow = false;
  }
}
