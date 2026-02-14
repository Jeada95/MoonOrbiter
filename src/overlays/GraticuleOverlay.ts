import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Nombre de segments pour dessiner chaque arc */
const ARC_SEGMENTS = 120;

/** Léger offset au-dessus de la surface pour éviter le z-fighting */
const SURFACE_OFFSET = 1.002;

/** Marge en pixels depuis les bords de l'écran pour masquer les labels */
const EDGE_MARGIN = 80;

/** Espacement minimum en pixels entre deux labels longitude pour rester lisible */
const MIN_LON_LABEL_SPACING = 70;

/** Couleur des parallèles (latitude) — bleu clair */
const LAT_COLOR = 0x6cb4ee;
const LAT_COLOR_CSS = '#6cb4ee';

/** Couleur des méridiens (longitude) — orange */
const LON_COLOR = 0xe89040;
const LON_COLOR_CSS = '#e89040';

/** Max de lignes visibles par axe */
const MAX_VISIBLE_LINES = 10;

function latLonToVec3(latDeg: number, lonDeg: number, r: number, out: THREE.Vector3): void {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  out.set(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  );
}

/**
 * Grille lat/lon adaptative.
 *
 * Les pas latitude et longitude sont choisis séparément
 * en comptant les lignes visibles dans le viewport (backface + marge).
 *
 * Code couleur :
 * - Parallèles (latitude constante) : bleu clair — labels SOUS la ligne
 * - Méridiens (longitude constante) : orange — labels AU-DESSUS de la ligne
 */
export class GraticuleOverlay {
  private group = new THREE.Group();
  private labelContainer: HTMLDivElement;
  private visible = false;

  /** Pas courants — quand ils changent, on reconstruit lignes + labels */
  private currentLatStep = 0;
  private currentLonStep = 0;

  // Objets Three.js pour les lignes
  private latLines: THREE.LineSegments | null = null;
  private lonLines: THREE.LineSegments | null = null;
  private latMat: THREE.LineBasicMaterial;
  private lonMat: THREE.LineBasicMaterial;

  // Labels DOM
  private latLabels: { el: HTMLDivElement; lat: number }[] = [];
  private lonLabels: { el: HTMLDivElement; lon: number }[] = [];

  // Reusable objects (avoid per-frame allocations)
  private _tmpVec = new THREE.Vector3();
  private _lonVisible: { el: HTMLDivElement; x: number; y: number }[] = [];
  private _lastCamX = NaN;
  private _lastCamY = NaN;
  private _lastCamZ = NaN;

  constructor(private parent: THREE.Object3D) {
    this.group.visible = false;
    this.parent.add(this.group);

    this.latMat = new THREE.LineBasicMaterial({
      color: LAT_COLOR, transparent: true, opacity: 0.35,
      depthTest: true, depthWrite: false,
    });
    this.lonMat = new THREE.LineBasicMaterial({
      color: LON_COLOR, transparent: true, opacity: 0.35,
      depthTest: true, depthWrite: false,
    });

    this.labelContainer = document.createElement('div');
    this.labelContainer.id = 'graticule-labels';
    this.labelContainer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none;';
    document.body.appendChild(this.labelContainer);
  }

  // ─── Construction dynamique ──────────────────────────────────────

  private rebuild(latStep: number, lonStep: number): void {
    if (latStep === this.currentLatStep && lonStep === this.currentLonStep) return;
    this.currentLatStep = latStep;
    this.currentLonStep = lonStep;

    // Nettoyer
    if (this.latLines) {
      this.group.remove(this.latLines);
      this.latLines.geometry.dispose();
      this.latLines = null;
    }
    if (this.lonLines) {
      this.group.remove(this.lonLines);
      this.lonLines.geometry.dispose();
      this.lonLines = null;
    }
    for (const { el } of this.latLabels) el.remove();
    for (const { el } of this.lonLabels) el.remove();
    this.latLabels = [];
    this.lonLabels = [];

    const r = SPHERE_RADIUS * SURFACE_OFFSET;

    // --- Parallèles (y compris équateur) ---
    const latPositions: number[] = [];
    const latValues: number[] = [];
    for (let lat = -90 + latStep; lat <= 90 - latStep; lat += latStep) {
      latValues.push(lat);
    }
    // S'assurer que 0 est inclus
    if (!latValues.includes(0) && latStep <= 90) latValues.push(0);
    latValues.sort((a, b) => a - b);

    for (const lat of latValues) {
      const latRad = lat * DEG2RAD;
      const cosLat = Math.cos(latRad);
      const sinLat = Math.sin(latRad);
      for (let i = 0; i < ARC_SEGMENTS; i++) {
        const lon0 = (i / ARC_SEGMENTS) * 360 * DEG2RAD;
        const lon1 = ((i + 1) / ARC_SEGMENTS) * 360 * DEG2RAD;
        latPositions.push(
          r * cosLat * Math.cos(lon0), r * sinLat, r * cosLat * Math.sin(lon0),
          r * cosLat * Math.cos(lon1), r * sinLat, r * cosLat * Math.sin(lon1),
        );
      }
    }

    const latGeo = new THREE.BufferGeometry();
    latGeo.setAttribute('position', new THREE.Float32BufferAttribute(latPositions, 3));
    this.latLines = new THREE.LineSegments(latGeo, this.latMat);
    this.group.add(this.latLines);

    // --- Méridiens ---
    const lonPositions: number[] = [];
    for (let lon = 0; lon < 360; lon += lonStep) {
      const lonRad = lon * DEG2RAD;
      const cosLon = Math.cos(lonRad);
      const sinLon = Math.sin(lonRad);
      for (let i = 0; i < ARC_SEGMENTS; i++) {
        const lat0 = -90 + (i / ARC_SEGMENTS) * 180;
        const lat1 = -90 + ((i + 1) / ARC_SEGMENTS) * 180;
        const lat0Rad = lat0 * DEG2RAD;
        const lat1Rad = lat1 * DEG2RAD;
        lonPositions.push(
          r * Math.cos(lat0Rad) * cosLon, r * Math.sin(lat0Rad), r * Math.cos(lat0Rad) * sinLon,
          r * Math.cos(lat1Rad) * cosLon, r * Math.sin(lat1Rad), r * Math.cos(lat1Rad) * sinLon,
        );
      }
    }

    const lonGeo = new THREE.BufferGeometry();
    lonGeo.setAttribute('position', new THREE.Float32BufferAttribute(lonPositions, 3));
    this.lonLines = new THREE.LineSegments(lonGeo, this.lonMat);
    this.group.add(this.lonLines);

    // --- Labels latitude ---
    for (const lat of latValues) {
      const text = lat === 0 ? '0°' : `${lat > 0 ? '+' : ''}${lat}° (${lat > 0 ? 'N' : 'S'})`;
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText =
        `position:absolute;left:0;top:0;color:${LAT_COLOR_CSS};font:10px Consolas,monospace;` +
        'text-shadow:0 0 3px #000,0 0 6px #000;white-space:nowrap;opacity:0.85;' +
        'will-change:transform;';
      this.labelContainer.appendChild(el);
      this.latLabels.push({ el, lat });
    }

    // --- Labels longitude ---
    for (let lon = 0; lon < 360; lon += lonStep) {
      const lonDisplay = lon > 180 ? lon - 360 : lon;
      const text = lonDisplay === 0 ? '0°'
        : `${lonDisplay > 0 ? '+' : ''}${lonDisplay}° (${lonDisplay > 0 ? 'E' : 'W'})`;
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText =
        `position:absolute;left:0;top:0;color:${LON_COLOR_CSS};font:10px Consolas,monospace;` +
        'text-shadow:0 0 3px #000,0 0 6px #000;white-space:nowrap;opacity:0.85;' +
        'will-change:transform;';
      this.labelContainer.appendChild(el);
      this.lonLabels.push({ el, lon });
    }
  }

  // ─── Choix des pas adaptatifs ──────────────────────────────────────

  /** Pas candidats, du plus fin au plus grossier */
  private static readonly STEP_LEVELS = [1, 2, 5, 10, 15, 20, 25, 30];

  /**
   * Demi-angle de surface visible pour un demi-FOV donné (phi, en radians).
   * Si le globe entier tient dans le FOV → 90° (hémisphère complet).
   * Sinon → intersection rayon-sphère convertie en angle au centre.
   */
  private static betaForPhi(R: number, D: number, phi: number): number {
    const alpha = Math.asin(Math.min(1, R / D)); // demi-angle disque apparent
    if (phi >= alpha) return Math.PI * 0.5;       // globe entier visible → 90°

    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const s = Math.sqrt(Math.max(0, R * R - D * D * sinPhi * sinPhi));
    const cosBeta = (D * sinPhi * sinPhi + cosPhi * s) / R;
    return Math.acos(Math.max(-1, Math.min(1, cosBeta)));
  }

  /** Champ de vue visible en degrés de latitude (axe vertical) */
  private visibleLatRange(camera: THREE.Camera): number {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return 180;

    const D = cam.position.length();
    const phiV = cam.fov * 0.5 * DEG2RAD;
    const beta = GraticuleOverlay.betaForPhi(SPHERE_RADIUS, D, phiV);

    return Math.min(180, 2 * beta * RAD2DEG);
  }

  /** Champ de vue visible en degrés de longitude (axe horizontal) */
  private visibleLonRange(camera: THREE.Camera): number {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return 360;

    const D = cam.position.length();
    const phiV = cam.fov * 0.5 * DEG2RAD;
    const aspect = cam.aspect || (window.innerWidth / window.innerHeight);
    const phiH = Math.atan(Math.tan(phiV) * aspect);
    const beta = GraticuleOverlay.betaForPhi(SPHERE_RADIUS, D, phiH);

    // Correction convergence méridiens aux pôles
    const camLatRad = Math.asin(
      Math.min(1, Math.max(-1, cam.position.y / Math.max(D, 1e-6))),
    );
    const cosLat = Math.max(1e-3, Math.cos(camLatRad));

    return Math.min(360, (2 * beta * RAD2DEG) / cosLat);
  }

  /** Plus petit pas latitude tel que visibleLatRange / pas <= MAX_VISIBLE_LINES */
  private chooseLatStep(camera: THREE.Camera): number {
    const range = this.visibleLatRange(camera);
    const steps = GraticuleOverlay.STEP_LEVELS;
    if (!Number.isFinite(range) || range <= 0) return steps[steps.length - 1];

    for (const step of steps) {
      if (range / step <= MAX_VISIBLE_LINES) return step;
    }
    return steps[steps.length - 1];
  }

  /** Plus petit pas longitude tel que visibleLonRange / pas <= MAX_VISIBLE_LINES */
  private chooseLonStep(camera: THREE.Camera): number {
    const range = this.visibleLonRange(camera);
    const steps = GraticuleOverlay.STEP_LEVELS;
    if (!Number.isFinite(range) || range <= 0) return steps[steps.length - 1];

    for (const step of steps) {
      if (range / step <= MAX_VISIBLE_LINES) return step;
    }
    return steps[steps.length - 1];
  }

  // ─── Update ──────────────────────────────────────────────────────

  update(camera: THREE.Camera): void {
    if (!this.visible) return;

    const cameraPos = camera.position;

    // Dirty check: skip if camera hasn't moved
    if (cameraPos.x === this._lastCamX &&
        cameraPos.y === this._lastCamY &&
        cameraPos.z === this._lastCamZ) {
      return;
    }
    this._lastCamX = cameraPos.x;
    this._lastCamY = cameraPos.y;
    this._lastCamZ = cameraPos.z;

    // Choisir les pas adaptatifs
    const latStep = this.chooseLatStep(camera);
    const lonStep = this.chooseLonStep(camera);

    // Parallèle pour le positionnement des labels lon
    const camLat = Math.asin(cameraPos.y / cameraPos.length()) * RAD2DEG;
    const labelLat = Math.max(-80, Math.min(80, camLat));

    this.rebuild(latStep, lonStep);

    const r = SPHERE_RADIUS * SURFACE_OFFSET;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tmp = this._tmpVec;

    // Méridien central pour placer les labels lat (snap sur lonStep)
    const camLon = Math.atan2(cameraPos.z, cameraPos.x) * RAD2DEG;
    const centralLon = Math.round(camLon / lonStep) * lonStep;

    // --- Labels de latitude : sur le méridien central, SOUS la ligne ---
    for (const { el, lat } of this.latLabels) {
      latLonToVec3(lat, centralLon, r, tmp);

      if (tmp.dot(cameraPos) < 0) {
        el.style.display = 'none';
        continue;
      }

      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;

      if (x < EDGE_MARGIN || x > w - EDGE_MARGIN || y < EDGE_MARGIN || y > h - EDGE_MARGIN || tmp.z > 1) {
        el.style.display = 'none';
        continue;
      }

      el.style.display = '';
      el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px + 2px))`;
    }

    // --- Labels de longitude : sur le parallèle central, AU-DESSUS de la ligne ---
    // 1) Projeter tous les labels et collecter ceux qui sont visibles (face + écran)
    const lonVisible = this._lonVisible;
    lonVisible.length = 0;
    for (const { el, lon } of this.lonLabels) {
      latLonToVec3(labelLat, lon, r, tmp);

      if (tmp.dot(cameraPos) < 0) {
        el.style.display = 'none';
        continue;
      }

      tmp.project(camera);
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;

      if (x < EDGE_MARGIN || x > w - EDGE_MARGIN || y < EDGE_MARGIN || y > h - EDGE_MARGIN || tmp.z > 1) {
        el.style.display = 'none';
        continue;
      }

      lonVisible.push({ el, x, y });
    }

    // 2) Trier par x croissant (ouest → est à l'écran)
    lonVisible.sort((a, b) => a.x - b.x);

    // 3) Retirer les extrémités tant qu'elles sont trop serrées
    while (lonVisible.length >= 2) {
      const first = lonVisible[0];
      const second = lonVisible[1];
      if (second.x - first.x < MIN_LON_LABEL_SPACING) {
        first.el.style.display = 'none';
        lonVisible.shift();
      } else {
        break;
      }
    }
    while (lonVisible.length >= 2) {
      const last = lonVisible[lonVisible.length - 1];
      const prev = lonVisible[lonVisible.length - 2];
      if (last.x - prev.x < MIN_LON_LABEL_SPACING) {
        last.el.style.display = 'none';
        lonVisible.pop();
      } else {
        break;
      }
    }

    // 4) Si encore trop de labels, n'en garder que MAX_VISIBLE_LINES
    //    centrés (on retire alternativement aux extrémités)
    while (lonVisible.length > MAX_VISIBLE_LINES) {
      const gapLeft = lonVisible.length >= 2 ? lonVisible[1].x - lonVisible[0].x : Infinity;
      const gapRight = lonVisible.length >= 2
        ? lonVisible[lonVisible.length - 1].x - lonVisible[lonVisible.length - 2].x
        : Infinity;
      if (gapLeft <= gapRight) {
        lonVisible[0].el.style.display = 'none';
        lonVisible.shift();
      } else {
        lonVisible[lonVisible.length - 1].el.style.display = 'none';
        lonVisible.pop();
      }
    }

    // 5) Afficher les labels restants
    for (const { el, x, y } of lonVisible) {
      el.style.display = '';
      el.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 100%))`;
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    this.labelContainer.style.display = v ? '' : 'none';

    // Invalidate dirty check so next update() rebuilds labels
    if (v) this._lastCamX = NaN;

    if (!v) {
      for (const { el } of this.latLabels) el.style.display = 'none';
      for (const { el } of this.lonLabels) el.style.display = 'none';
    }
  }

  isVisible(): boolean { return this.visible; }

  dispose(): void {
    this.parent.remove(this.group);
    if (this.latLines) { this.latLines.geometry.dispose(); }
    if (this.lonLines) { this.lonLines.geometry.dispose(); }
    this.latMat.dispose();
    this.lonMat.dispose();
    this.labelContainer.remove();
  }
}
