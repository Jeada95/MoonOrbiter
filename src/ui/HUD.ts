import * as THREE from 'three';
import { SPHERE_RADIUS, MOON_RADIUS } from '../utils/config';

const KM_TO_MI = 0.621371;

export class HUD {
  private elCoords: HTMLElement;
  private elAlt: HTMLElement;
  private elResolution: HTMLElement;
  private elSun: HTMLElement;
  private elFps: HTMLElement;

  // Scale bar elements
  private elScaleBar: HTMLElement;
  private elScaleKm: HTMLElement;
  private elScaleMi: HTMLElement;

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
    this.elSun = document.getElementById('hud-sun')!;
    this.elFps = document.getElementById('hud-fps')!;

    this.elScaleBar = document.getElementById('scalebar-bar')!;
    this.elScaleKm = document.getElementById('scalebar-km')!;
    this.elScaleMi = document.getElementById('scalebar-mi')!;

    window.addEventListener('mousemove', this.onMouseMove);
  }

  private onMouseMove = (e: MouseEvent) => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.mouseDirty = true;
  };

  update(
    camera: THREE.Camera,
    raycastTargets: THREE.Object3D[],
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

    // Barre d'échelle
    this.updateScaleBar(camera as THREE.PerspectiveCamera);

    // Coordonnées sous le curseur (raycast throttlé à 100ms pour les perfs)
    if (this.mouseDirty && time - this.lastRaycastTime > 100) {
      this.lastRaycastTime = time;
      this.mouseDirty = false;

      this.raycaster.setFromCamera(this.mouse, camera);
      const intersects = this.raycaster.intersectObjects(raycastTargets, false);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        const r = point.length();
        const lat = Math.asin(point.y / r) * (180 / Math.PI);
        const lon = Math.atan2(-point.z, point.x) * (180 / Math.PI);

        const lonNorm = ((lon % 360) + 360) % 360;
        const lonDisplay = lonNorm > 180 ? lonNorm - 360 : lonNorm;
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lonDisplay >= 0 ? 'E' : 'W';
        const latSign = lat >= 0 ? '+' : '';
        const lonSign = lonDisplay >= 0 ? '+' : '';
        this.elCoords.textContent =
          `Lat: ${latSign}${lat.toFixed(2)}° (${latDir})  Lon: ${lonSign}${lonDisplay.toFixed(2)}° (${lonDir})`;
      } else {
        this.elCoords.textContent = 'Lat: --  Lon: --';
      }
    }
  }

  /** Barre d'échelle fixe : calcule combien de km/mi représentent BAR_PX pixels. */
  private updateScaleBar(camera: THREE.PerspectiveCamera): void {
    const BAR_PX = 65;

    const camDist = camera.position.length();
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const surfaceDist = Math.max(camDist - SPHERE_RADIUS, 0.01);
    const viewHeightAtSurface = 2 * surfaceDist * Math.tan(fovRad / 2);

    const kmPerUnit = MOON_RADIUS / SPHERE_RADIUS;
    const viewHeightKm = viewHeightAtSurface * kmPerUnit;
    const kmPerPx = viewHeightKm / window.innerHeight;
    const km = kmPerPx * BAR_PX;
    const mi = km * KM_TO_MI;

    // Formater avec une précision adaptée
    const fmtKm = km >= 100 ? `${km.toFixed(0)} km` : km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
    const fmtMi = mi >= 100 ? `${mi.toFixed(0)} mi` : mi >= 10 ? `${mi.toFixed(1)} mi` : `${mi.toFixed(2)} mi`;

    this.elScaleKm.textContent = fmtKm;
    this.elScaleMi.textContent = fmtMi;
  }

  setResolutionInfo(text: string) {
    this.elResolution.textContent = text;
  }

  /** Display sub-solar coordinates and datetime */
  setSunInfo(lat: number, lon: number, date: Date): void {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const latSign = lat >= 0 ? '+' : '';
    const lonSign = lon >= 0 ? '+' : '';
    const utc = date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    this.elSun.textContent =
      `Sun: ${latSign}${lat.toFixed(1)}° (${latDir}) ${lonSign}${lon.toFixed(1)}° (${lonDir}) | ${utc}`;
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove);
  }
}
