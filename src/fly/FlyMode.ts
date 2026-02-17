import * as THREE from 'three';
import { SPHERE_RADIUS, MOON_RADIUS } from '../utils/config';
import type { Globe } from '../moon/Globe';

/**
 * FlyMode — contrôleur de vol au-dessus de la surface lunaire.
 *
 * Entrées :
 *  - Bouton gauche maintenu → avancer
 *  - Bouton droit maintenu  → reculer
 *  - Mouvement souris       → orientation (yaw/pitch)
 *  - Molette                → ajuster le multiplicateur de vitesse
 *
 * La caméra se déplace sur la surface courbe (lat/lon) et maintient
 * une altitude constante au-dessus du terrain (via Globe.getElevationAtLatLon).
 */

// ─── Constants ────────────────────────────────────────────────

/** Base speed in Three.js units/s (≈ 3.47 km/s at multiplier 1.0) */
const BASE_SPEED = 0.02;

/** Default altitude above surface in Three.js units (≈ 5.2 km) */
const DEFAULT_ALTITUDE = 0.03;

/** Minimum altitude — can't go below this (≈ 350 m) */
const MIN_ALTITUDE = 0.002;

/** Maximum altitude (≈ 174 km) */
const MAX_ALTITUDE = 1.0;

/** Mouse sensitivity for yaw/pitch (radians per pixel) */
const MOUSE_SENSITIVITY = 0.003;

/** Speed multiplier min/max */
const MIN_SPEED_MULT = 0.1;
const MAX_SPEED_MULT = 20.0;

/** Pitch clamp (radians) — don't allow looking straight down/up more than ±80° */
const MAX_PITCH = (80 * Math.PI) / 180;

/** Moon radius in meters (for elevation → Three.js unit conversion) */
const MOON_RADIUS_M = MOON_RADIUS * 1000;

// ─── FlyMode class ────────────────────────────────────────────

export interface FlyModeCallbacks {
  /** Called when fly mode is exited (Escape) */
  onExit: () => void;
}

export class FlyMode {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly globe: Globe;
  private readonly callbacks: FlyModeCallbacks;
  private readonly exaggeration: number;

  /** Current lat/lon in radians */
  private lat = 0;
  private lon = 0;

  /** Heading (yaw) in radians — 0 = North, π/2 = East */
  private yaw = 0;
  /** Pitch in radians — 0 = horizontal, >0 = looking up */
  private pitch = 0;

  /** Dynamic altitude above terrain in Three.js units */
  private altitude = DEFAULT_ALTITUDE;

  /** Speed multiplier (adjusted with scroll wheel) */
  private speedMult = 1.0;

  /** Mouse button state */
  private leftDown = false;
  private rightDown = false;

  /** Whether pointer lock is active */
  private locked = false;

  /** Saved camera near value to restore on exit */
  private savedNear = 0.1;

  /** Whether fly mode is currently active */
  private active = false;

  /** Previous frame timestamp (ms) */
  private prevTime = 0;

  // Bound handlers (for proper removal)
  private _onMouseDown: (e: MouseEvent) => void;
  private _onMouseUp: (e: MouseEvent) => void;
  private _onMouseMove: (e: MouseEvent) => void;
  private _onWheel: (e: WheelEvent) => void;
  private _onPointerLockChange: () => void;
  private _onContextMenu: (e: Event) => void;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    globe: Globe,
    exaggeration: number,
    callbacks: FlyModeCallbacks,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.globe = globe;
    this.exaggeration = exaggeration;
    this.callbacks = callbacks;

    // Bind handlers
    this._onMouseDown = this.onMouseDown.bind(this);
    this._onMouseUp = this.onMouseUp.bind(this);
    this._onMouseMove = this.onMouseMove.bind(this);
    this._onWheel = this.onWheel.bind(this);
    this._onPointerLockChange = this.onPointerLockChange.bind(this);
    this._onContextMenu = (e: Event) => e.preventDefault();
  }

  // ─── Public API ───────────────────────────────────────────

  /**
   * Activate fly mode from a start point on the surface.
   * @param startPoint World-space intersection point on the sphere
   */
  activate(startPoint: THREE.Vector3): void {
    // Derive lat/lon from the start point
    const dir = startPoint.clone().normalize();
    this.lat = Math.asin(dir.y);
    this.lon = Math.atan2(-dir.z, dir.x);

    // Initial heading: North, looking horizontal, default altitude
    this.yaw = 0;
    this.pitch = 0;
    this.speedMult = 1.0;
    this.altitude = DEFAULT_ALTITUDE;
    this.leftDown = false;
    this.rightDown = false;
    this.prevTime = performance.now();

    // Reduce camera near for surface proximity
    this.savedNear = this.camera.near;
    this.camera.near = 0.001;
    this.camera.updateProjectionMatrix();

    // Position camera above the start point
    this.updateCameraPosition();

    // Attach listeners
    this.domElement.addEventListener('mousedown', this._onMouseDown);
    this.domElement.addEventListener('mouseup', this._onMouseUp);
    this.domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this.domElement.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Request pointer lock for mouse look
    this.domElement.requestPointerLock();

    this.active = true;
    console.log(
      `[FlyMode] Activated at lat=${(this.lat * 180 / Math.PI).toFixed(2)}° ` +
      `lon=${(this.lon * 180 / Math.PI).toFixed(2)}°`,
    );
  }

  /** Deactivate fly mode and restore camera */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    // Remove listeners
    this.domElement.removeEventListener('mousedown', this._onMouseDown);
    this.domElement.removeEventListener('mouseup', this._onMouseUp);
    this.domElement.removeEventListener('wheel', this._onWheel);
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);

    // Exit pointer lock
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }

    // Restore camera near
    this.camera.near = this.savedNear;
    this.camera.updateProjectionMatrix();

    this.leftDown = false;
    this.rightDown = false;

    console.log('[FlyMode] Deactivated');
  }

  /** Whether fly mode is currently active */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Update fly mode (called each frame from animate loop).
   * Moves the camera along the curved surface and orients it.
   */
  update(): void {
    if (!this.active) return;

    const now = performance.now();
    const dt = Math.min((now - this.prevTime) / 1000, 0.1); // cap at 100ms
    this.prevTime = now;

    // Movement direction: +1 forward, -1 backward, 0 none
    let moveDir = 0;
    if (this.leftDown) moveDir += 1;
    if (this.rightDown) moveDir -= 1;

    if (moveDir !== 0) {
      const speed = BASE_SPEED * this.speedMult * moveDir;

      // Horizontal component (along surface): scaled by cos(pitch)
      const horizSpeed = speed * Math.cos(this.pitch);
      const dAngle = (horizSpeed * dt) / SPHERE_RADIUS;

      // Project yaw into lat/lon changes
      // yaw = 0 → North (increase lat), yaw = π/2 → East (increase lon)
      const dLat = dAngle * Math.cos(this.yaw);
      const cosLat = Math.cos(this.lat);
      const dLon = cosLat > 0.001 ? (dAngle * Math.sin(this.yaw)) / cosLat : 0;

      this.lat += dLat;
      this.lon += dLon;

      // Vertical component: pitch drives altitude change
      const vertSpeed = speed * Math.sin(this.pitch);
      this.altitude += vertSpeed * dt;
      this.altitude = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, this.altitude));

      // Clamp latitude
      this.lat = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.lat));

      // Wrap longitude
      if (this.lon > Math.PI) this.lon -= 2 * Math.PI;
      if (this.lon < -Math.PI) this.lon += 2 * Math.PI;
    }

    this.updateCameraPosition();
  }

  /** Current flight info for HUD */
  getInfo(): { latDeg: number; lonDeg: number; headingDeg: number; speedMult: number; altitudeKm: number } {
    const latDeg = this.lat * (180 / Math.PI);
    const lonDeg = this.lon * (180 / Math.PI);
    const headingDeg = ((this.yaw * 180 / Math.PI) % 360 + 360) % 360;

    // Altitude above surface in km
    const altitudeKm = this.altitude * (MOON_RADIUS / SPHERE_RADIUS);

    return { latDeg, lonDeg, headingDeg, speedMult: this.speedMult, altitudeKm };
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Position camera at current lat/lon, altitude above terrain,
   * and orient using local tangent frame + yaw/pitch.
   */
  private updateCameraPosition(): void {
    const latDeg = this.lat * (180 / Math.PI);
    const lonDeg = this.lon * (180 / Math.PI);

    // Get terrain elevation at current lat/lon
    const elevM = this.globe.getElevationAtLatLon(latDeg, lonDeg);
    // Convert elevation to Three.js radius offset (matching tile formula with exaggeration)
    const elevRadius = SPHERE_RADIUS * (this.exaggeration * elevM / MOON_RADIUS_M);
    const totalRadius = SPHERE_RADIUS + elevRadius + this.altitude;

    // Camera position on sphere
    const cosLat = Math.cos(this.lat);
    const sinLat = Math.sin(this.lat);
    const cosLon = Math.cos(this.lon);
    const sinLon = Math.sin(this.lon);

    // Position (same convention as Globe.ts: z = -cos(lat)*sin(lon))
    const px = cosLat * cosLon * totalRadius;
    const py = sinLat * totalRadius;
    const pz = -cosLat * sinLon * totalRadius;

    this.camera.position.set(px, py, pz);

    // ─── Local tangent frame ─────────────────────────────
    // Up = radial (outward from center)
    const up = new THREE.Vector3(
      cosLat * cosLon,
      sinLat,
      -cosLat * sinLon,
    ).normalize();

    // North = d(position)/d(lat) normalized — points toward north pole
    const north = new THREE.Vector3(
      -sinLat * cosLon,
      cosLat,
      sinLat * sinLon,
    ).normalize();

    // East = Up × North (right-hand rule) — but we want East = cross(north, up)?
    // Actually: East = d(position)/d(lon) normalized
    const east = new THREE.Vector3(
      -sinLon,
      0,
      -cosLon,
    ).normalize();

    // ─── Apply yaw/pitch to get look direction ──────────
    // Horizontal direction = cos(yaw)*north + sin(yaw)*east
    const horizontal = new THREE.Vector3()
      .copy(north).multiplyScalar(Math.cos(this.yaw))
      .addScaledVector(east, Math.sin(this.yaw));

    // Forward = cos(pitch)*horizontal + sin(pitch)*up
    const forward = new THREE.Vector3()
      .copy(horizontal).multiplyScalar(Math.cos(this.pitch))
      .addScaledVector(up, Math.sin(this.pitch));

    // Look at target = position + forward
    const target = new THREE.Vector3().copy(this.camera.position).add(forward);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
  }

  // ─── Event handlers ───────────────────────────────────────

  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = true;
    if (e.button === 2) this.rightDown = true;
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.leftDown = false;
    if (e.button === 2) this.rightDown = false;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;

    // movementX → yaw (left/right)
    this.yaw += e.movementX * MOUSE_SENSITIVITY;
    // movementY → pitch (up/down) — invert Y: moving mouse up = look up
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Scroll up → faster, scroll down → slower
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.speedMult = Math.max(
      MIN_SPEED_MULT,
      Math.min(MAX_SPEED_MULT, this.speedMult * factor),
    );
  }

  private onPointerLockChange(): void {
    this.locked = document.pointerLockElement === this.domElement;
    if (!this.locked && this.active) {
      // Pointer lock lost (Escape or other) → exit fly mode
      this.deactivate();
      this.callbacks.onExit();
    }
  }
}
