import * as THREE from 'three';
import { SPHERE_RADIUS, MOON_RADIUS } from '../utils/config';

export class HUD {
  private elCoords: HTMLElement;
  private elAlt: HTMLElement;
  private elResolution: HTMLElement;
  private elFps: HTMLElement;

  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 0;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private lastRaycastTime = 0;
  private mouseDirty = false;

  constructor() {
    this.elCoords = document.getElementById('hud-coords')!;
    this.elAlt = document.getElementById('hud-alt')!;
    this.elResolution = document.getElementById('hud-resolution')!;
    this.elFps = document.getElementById('hud-fps')!;

    window.addEventListener('mousemove', this.onMouseMove);
  }

  private onMouseMove = (e: MouseEvent) => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.mouseDirty = true;
  };

  update(
    camera: THREE.Camera,
    sceneRoot: THREE.Object3D,
    time: number
  ) {
    // FPS
    this.frameCount++;
    if (time - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = time;
      this.elFps.textContent = `FPS: ${this.fps}`;
    }

    // Altitude caméra (distance au centre - rayon sphère, convertie en km lunaires)
    const camDist = camera.position.length();
    const altKm = ((camDist - SPHERE_RADIUS) / SPHERE_RADIUS) * MOON_RADIUS;
    this.elAlt.textContent = `Altitude: ${altKm.toFixed(0)} km`;

    // Coordonnées sous le curseur (raycast throttlé à 100ms pour les perfs)
    if (this.mouseDirty && time - this.lastRaycastTime > 100) {
      this.lastRaycastTime = time;
      this.mouseDirty = false;

      this.raycaster.setFromCamera(this.mouse, camera);
      // Raycast sur toute la scène (globe + tuiles adaptatives)
      const intersects = this.raycaster.intersectObjects(sceneRoot.children, true);

      if (intersects.length > 0) {
        // Le point est en coordonnées world. Le mesh est fixe à l'origine
        // (OrbitControls déplace la caméra, pas le globe).
        const point = intersects[0].point;
        const r = point.length();
        const lat = Math.asin(point.y / r) * (180 / Math.PI);
        // x = r cos(lat) cos(lon), z = r cos(lat) sin(lon) → lon = atan2(z, x)
        const lon = Math.atan2(point.z, point.x) * (180 / Math.PI);

        // Normaliser lon en 0..360 puis afficher en -180..180
        const lonNorm = ((lon % 360) + 360) % 360;
        const lonDisplay = lonNorm > 180 ? lonNorm - 360 : lonNorm;
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lonDisplay >= 0 ? 'E' : 'W';
        this.elCoords.textContent =
          `Lat: ${Math.abs(lat).toFixed(2)}° ${latDir}  Lon: ${Math.abs(lonDisplay).toFixed(2)}° ${lonDir}`;
      } else {
        this.elCoords.textContent = 'Lat: --  Lon: --';
      }
    }
  }

  /** Met à jour la ligne d'info résolution */
  setResolutionInfo(text: string) {
    this.elResolution.textContent = text;
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove);
  }
}
