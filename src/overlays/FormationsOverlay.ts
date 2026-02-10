import * as THREE from 'three';
import { SPHERE_RADIUS } from '../utils/config';

// ─── Types ───────────────────────────────────────────────────────

interface LunarFeature {
  name: string;
  lat: number;   // degrees, -90 to +90
  lon: number;   // degrees, -180 to +180
  diameter: number; // km
  type: string;  // "Crater", "Mare", "Mons", etc.
}

interface FeatureMeta {
  isMare: boolean;
  wikiEligible: boolean;
  wikiUrl: string;
}

// ─── Constants ───────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;

/** Slight offset above the surface to avoid z-fighting */
const SURFACE_OFFSET = 1.003;

/** Margin in pixels from screen edges to hide labels */
const EDGE_MARGIN = 40;

/** Feature types considered as "maria" (large font, different color) */
const MARIA_TYPES = new Set(['Mare', 'Oceanus', 'Palus', 'Lacus', 'Sinus']);

/** Minimum diameter (km) for Wikipedia link eligibility */
const WIKI_MIN_DIAMETER = 25;

// ─── Helpers ─────────────────────────────────────────────────────

function latLonToVec3(latDeg: number, lonDeg: number, r: number, out: THREE.Vector3): void {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  out.set(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    r * Math.cos(lat) * Math.sin(lon),
  );
}

function makeWikiUrl(feature: LunarFeature): string {
  const encoded = feature.name.replace(/ /g, '_');
  const t = feature.type;

  if (t === 'Mare' || t === 'Oceanus')
    return `https://en.wikipedia.org/wiki/${encoded}`;
  if (t === 'Palus' || t === 'Lacus' || t === 'Sinus')
    return `https://en.wikipedia.org/wiki/${encoded}`;
  if (t === 'Mons' || t === 'Montes')
    return `https://en.wikipedia.org/wiki/${encoded}`;
  if (t === 'Vallis')
    return `https://en.wikipedia.org/wiki/${encoded}`;
  if (t === 'Rupes')
    return `https://en.wikipedia.org/wiki/${encoded}`;
  // Default: crater
  return `https://en.wikipedia.org/wiki/${encoded}_(crater)`;
}

// ─── FormationsOverlay ───────────────────────────────────────────

/**
 * Overlay displaying named lunar features (craters, maria, mountains, etc.)
 * as DOM labels projected onto the globe surface.
 *
 * Features are sorted by diameter (largest first). A slider controls the max
 * number of VISIBLE labels on screen. Each frame, the system scans ALL features,
 * picks the top N visible ones (backface culling + screen bounds), and renders
 * them with overlap avoidance using a fixed-size DOM element pool.
 *
 * Optimizations:
 * - Pool slot → feature index cache: skip applyLabel() when same feature stays on same slot
 * - Pre-allocated placement arrays: zero GC pressure per frame
 * - Stable wiki click handler: no closure allocation per frame
 * - Camera dirty check: skip entire update when view hasn't changed
 */
export class FormationsOverlay {
  private labelContainer: HTMLDivElement;
  private visible = false;
  private wikiMode = false;
  private count = 10;

  /** All features, sorted by diameter descending (loaded from JSON) */
  private allFeatures: LunarFeature[] = [];
  /** Pre-computed metadata per feature (parallel to allFeatures) */
  private allMeta: FeatureMeta[] = [];
  /** Pre-computed world positions for ALL features (parallel to allFeatures) */
  private allWorldPositions: THREE.Vector3[] = [];

  /** Pool of reusable DOM label elements (size = count) */
  private pool: HTMLDivElement[] = [];

  // ─── Optim #1: cache feature→slot mapping ─────────────────
  /** Feature index currently assigned to each pool slot (-1 = none) */
  private poolFeatureIndex: number[] = [];
  /** Wiki mode state when the slot was last styled */
  private poolWikiState: boolean[] = [];

  // ─── Optim #2: pre-allocated placement arrays ─────────────
  private placedX = new Float64Array(50);
  private placedY = new Float64Array(50);
  private placedHW = new Float64Array(50);
  private placedHH = new Float64Array(50);

  // ─── Optim #3: stable wiki click handler ──────────────────
  private readonly _onWikiClick = (e: MouseEvent) => {
    const url = (e.currentTarget as HTMLDivElement).dataset.wikiUrl;
    if (url) window.open(url, '_blank');
  };

  // ─── Optim #4: camera dirty check ─────────────────────────
  private readonly _lastCamPos = new THREE.Vector3();
  private _lastProjMatSig = 0;  // cheap signature of projection matrix
  private _lastW = 0;
  private _lastH = 0;
  private _dirty = true;  // force first update

  /** Temp vector for projection (avoid per-frame alloc) */
  private readonly _tmpVec = new THREE.Vector3();

  constructor() {
    this.labelContainer = document.createElement('div');
    this.labelContainer.id = 'formations-labels';
    this.labelContainer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none;';
    document.body.appendChild(this.labelContainer);
  }

  // ─── Data loading ────────────────────────────────────────────

  async loadData(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    this.allFeatures = await response.json();

    // Pre-compute world positions and metadata for ALL features
    const r = SPHERE_RADIUS * SURFACE_OFFSET;
    this.allWorldPositions = [];
    this.allMeta = [];

    for (const f of this.allFeatures) {
      const wp = new THREE.Vector3();
      latLonToVec3(f.lat, f.lon, r, wp);
      this.allWorldPositions.push(wp);

      const isMare = MARIA_TYPES.has(f.type);
      this.allMeta.push({
        isMare,
        wikiEligible: f.diameter >= WIKI_MIN_DIAMETER,
        wikiUrl: makeWikiUrl(f),
      });
    }

    console.log(`Loaded ${this.allFeatures.length} lunar features`);
    this.ensurePool();
  }

  // ─── Public API ──────────────────────────────────────────────

  setVisible(v: boolean): void {
    this.visible = v;
    this.labelContainer.style.display = v ? '' : 'none';
    if (v) {
      this._dirty = true;
    } else {
      for (const el of this.pool) el.style.display = 'none';
    }
  }

  setCount(n: number): void {
    if (n === this.count) return;
    this.count = n;
    this.ensurePool();
    this._dirty = true;
  }

  setWikiMode(v: boolean): void {
    if (v === this.wikiMode) return;
    this.wikiMode = v;
    this._dirty = true;
  }

  // ─── DOM pool management ───────────────────────────────────

  /**
   * Ensure the pool has exactly `count` DOM elements.
   * Grow or shrink as needed. Reset slot cache accordingly.
   */
  private ensurePool(): void {
    // Shrink
    while (this.pool.length > this.count) {
      const el = this.pool.pop()!;
      el.remove();
    }
    // Grow
    while (this.pool.length < this.count) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;display:none;';
      this.labelContainer.appendChild(el);
      this.pool.push(el);
    }

    // Resize slot cache
    this.poolFeatureIndex = new Array(this.count).fill(-1);
    this.poolWikiState = new Array(this.count).fill(false);

    // Resize placement arrays if needed
    if (this.count > this.placedX.length) {
      this.placedX = new Float64Array(this.count);
      this.placedY = new Float64Array(this.count);
      this.placedHW = new Float64Array(this.count);
      this.placedHH = new Float64Array(this.count);
    }
  }

  /**
   * Apply the correct style to a pool element for a given feature.
   * Only called when the feature assigned to a slot changes.
   */
  private applyLabel(el: HTMLDivElement, meta: FeatureMeta): void {
    if (meta.isMare) {
      el.style.color = '#c8a0ff';
      el.style.font = 'bold 13px "Segoe UI",sans-serif';
      el.style.textShadow = '0 0 4px #000,0 0 8px #000';
      el.style.opacity = '0.7';
    } else {
      el.style.color = '#f0d080';
      el.style.font = '11px "Segoe UI",sans-serif';
      el.style.textShadow = '0 0 3px #000,0 0 6px #000';
      el.style.opacity = '0.85';
    }
    el.style.whiteSpace = 'nowrap';
    el.style.transform = 'translate(-50%,-50%)';
  }

  /**
   * Apply wiki styling to a pool element. Separated from applyLabel
   * so it can be updated independently when wikiMode changes.
   */
  private applyWiki(el: HTMLDivElement, meta: FeatureMeta): void {
    if (this.wikiMode && meta.wikiEligible) {
      el.style.textDecoration = 'underline';
      el.style.cursor = 'pointer';
      el.style.pointerEvents = 'auto';
      el.dataset.wikiUrl = meta.wikiUrl;
      el.onclick = this._onWikiClick;
    } else {
      el.style.textDecoration = 'none';
      el.style.cursor = '';
      el.style.pointerEvents = 'none';
      el.onclick = null;
    }
  }

  // ─── Camera dirty check ────────────────────────────────────

  /**
   * Cheap check: has the camera or viewport changed since last frame?
   */
  private checkDirty(camera: THREE.Camera, w: number, h: number): boolean {
    if (this._dirty) return true;

    const pos = camera.position;
    if (pos.x !== this._lastCamPos.x ||
        pos.y !== this._lastCamPos.y ||
        pos.z !== this._lastCamPos.z) return true;

    // Quick projection matrix signature (sum of 4 diagonal elements)
    const pe = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    const sig = pe[0] + pe[5] + pe[10] + pe[15];
    if (sig !== this._lastProjMatSig) return true;

    if (w !== this._lastW || h !== this._lastH) return true;

    return false;
  }

  private saveCameraState(camera: THREE.Camera, w: number, h: number): void {
    this._lastCamPos.copy(camera.position);
    const pe = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    this._lastProjMatSig = pe[0] + pe[5] + pe[10] + pe[15];
    this._lastW = w;
    this._lastH = h;
    this._dirty = false;
  }

  // ─── Frame update ────────────────────────────────────────────

  update(camera: THREE.Camera): void {
    if (!this.visible || this.allFeatures.length === 0 || this.pool.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Optim #4: skip if nothing changed
    if (!this.checkDirty(camera, w, h)) return;
    this.saveCameraState(camera, w, h);

    const cameraPos = camera.position;
    const tmp = this._tmpVec;

    // Optim #2: reuse pre-allocated arrays
    const pX = this.placedX;
    const pY = this.placedY;
    const pHW = this.placedHW;
    const pHH = this.placedHH;
    let placedCount = 0;

    let used = 0;

    // Scan ALL features in diameter order (largest first).
    // Assign visible ones to pool slots until we reach `count`.
    for (let i = 0; i < this.allFeatures.length && used < this.count; i++) {
      const worldPos = this.allWorldPositions[i];

      // Backface culling: surface normal ≈ worldPos (sphere centered at origin)
      if (worldPos.dot(cameraPos) <= 0) continue;

      // Project to screen
      tmp.copy(worldPos);
      tmp.project(camera);

      // Behind camera
      if (tmp.z > 1) continue;

      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;

      // Edge margin
      if (x < EDGE_MARGIN || x > w - EDGE_MARGIN ||
          y < EDGE_MARGIN || y > h - EDGE_MARGIN) continue;

      // Overlap avoidance
      const meta = this.allMeta[i];
      const feature = this.allFeatures[i];
      const charWidth = meta.isMare ? 8 : 7;
      const hw = feature.name.length * charWidth * 0.5;
      const hh = meta.isMare ? 9 : 7;

      let overlaps = false;
      for (let p = 0; p < placedCount; p++) {
        if (Math.abs(x - pX[p]) < (hw + pHW[p]) &&
            Math.abs(y - pY[p]) < (hh + pHH[p])) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      // Assign this feature to the next pool element
      const el = this.pool[used];

      // Optim #1: only restyle if feature changed on this slot
      if (this.poolFeatureIndex[used] !== i) {
        el.textContent = feature.name;
        this.applyLabel(el, meta);
        this.applyWiki(el, meta);
        this.poolFeatureIndex[used] = i;
        this.poolWikiState[used] = this.wikiMode;
      } else if (this.poolWikiState[used] !== this.wikiMode) {
        // Same feature but wiki mode toggled
        this.applyWiki(el, meta);
        this.poolWikiState[used] = this.wikiMode;
      }

      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.display = '';

      pX[placedCount] = x;
      pY[placedCount] = y;
      pHW[placedCount] = hw;
      pHH[placedCount] = hh;
      placedCount++;
      used++;
    }

    // Hide unused pool elements and invalidate their cache
    for (let i = used; i < this.pool.length; i++) {
      this.pool[i].style.display = 'none';
      this.poolFeatureIndex[i] = -1;
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  dispose(): void {
    for (const el of this.pool) el.remove();
    this.pool = [];
    this.poolFeatureIndex = [];
    this.poolWikiState = [];
    this.allFeatures = [];
    this.allMeta = [];
    this.allWorldPositions = [];
    this.labelContainer.remove();
  }
}
