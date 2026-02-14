import * as THREE from 'three';
import { SPHERE_RADIUS, MOON_RADIUS } from '../utils/config';
import { type WidgetPosition, savePreferences, loadPreferences } from '../utils/preferences';

const KM_TO_MI = 0.621371;

// ─── Draggable widget helper ─────────────────────────────────────

interface DragState {
  el: HTMLElement;
  prefKey: 'hudPosition' | 'scalebarPosition';
  dragging: boolean;
  offsetX: number;
  offsetY: number;
}

/**
 * Make an absolutely-positioned element draggable via mouse.
 * When dragged, the element switches from its default CSS anchor
 * (bottom/left or bottom/right) to top/left positioning.
 */
function makeDraggable(
  el: HTMLElement,
  prefKey: 'hudPosition' | 'scalebarPosition',
  savedPos: WidgetPosition | null,
): DragState {
  const state: DragState = { el, prefKey, dragging: false, offsetX: 0, offsetY: 0 };

  // Apply saved position (switch to top/left mode)
  if (savedPos) {
    applyPosition(el, savedPos);
  }

  el.addEventListener('mousedown', (e: MouseEvent) => {
    // Only primary button
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Get current position on screen
    const rect = el.getBoundingClientRect();
    state.dragging = true;
    state.offsetX = e.clientX - rect.left;
    state.offsetY = e.clientY - rect.top;
    el.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      if (!state.dragging) return;
      const x = clampX(ev.clientX - state.offsetX, el);
      const y = clampY(ev.clientY - state.offsetY, el);
      applyPosition(el, { x, y });
    };

    const onUp = () => {
      if (!state.dragging) return;
      state.dragging = false;
      el.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      // Save position
      const rect2 = el.getBoundingClientRect();
      const pos: WidgetPosition = { x: rect2.left, y: rect2.top };
      savePreferences({ [prefKey]: pos } as any);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return state;
}

function applyPosition(el: HTMLElement, pos: WidgetPosition): void {
  // Switch from default anchoring to top/left
  el.style.top = `${pos.y}px`;
  el.style.left = `${pos.x}px`;
  el.style.bottom = 'auto';
  el.style.right = 'auto';
}

function clampX(x: number, el: HTMLElement): number {
  return Math.max(0, Math.min(x, window.innerWidth - el.offsetWidth));
}

function clampY(y: number, el: HTMLElement): number {
  return Math.max(0, Math.min(y, window.innerHeight - el.offsetHeight));
}

// ─── HUD ─────────────────────────────────────────────────────────

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

  // Drag states
  private hudDrag: DragState;
  private scalebarDrag: DragState;

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

    // Setup draggable widgets
    const prefs = loadPreferences();
    const hudEl = document.getElementById('hud')!;
    const scalebarEl = document.getElementById('scalebar')!;
    this.hudDrag = makeDraggable(hudEl, 'hudPosition', prefs.hudPosition);
    this.scalebarDrag = makeDraggable(scalebarEl, 'scalebarPosition', prefs.scalebarPosition);

    // Keep widgets in-bounds on resize
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    for (const drag of [this.hudDrag, this.scalebarDrag]) {
      const el = drag.el;
      // Only clamp if we have a custom position (top/left mode)
      if (el.style.top && el.style.top !== 'auto') {
        const rect = el.getBoundingClientRect();
        const x = clampX(rect.left, el);
        const y = clampY(rect.top, el);
        applyPosition(el, { x, y });
      }
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    // Don't update raycast mouse during widget drag
    if (this.hudDrag.dragging || this.scalebarDrag.dragging) return;
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

  /**
   * Update only the scale bar from a Workshop-style camera
   * where coordinates are directly in km (no sphere conversion needed).
   */
  updateScaleBarKm(camera: THREE.PerspectiveCamera, targetDist: number): void {
    const BAR_PX = 65;
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    // Distance from camera to the target point (brick center)
    const viewHeightKm = 2 * targetDist * Math.tan(fovRad / 2);
    const kmPerPx = viewHeightKm / window.innerHeight;
    const km = kmPerPx * BAR_PX;
    const mi = km * KM_TO_MI;

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
    window.removeEventListener('resize', this.onResize);
  }
}
