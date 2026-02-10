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
  category: Category;
  wikiEligible: boolean;
  wikiUrl: string;
}

/** Three display categories, each with its own slider, color and pool */
const enum Category { Maria = 0, Craters = 1, Other = 2 }
const CATEGORY_COUNT = 3;

// ─── Constants ───────────────────────────────────────────────────

const DEG2RAD = Math.PI / 180;
const SURFACE_OFFSET = 1.003;
const EDGE_MARGIN = 40;

/** Feature types classified as Maria */
const MARIA_TYPES = new Set(['Mare', 'Oceanus', 'Palus', 'Lacus', 'Sinus']);
/** Feature types classified as Craters */
const CRATER_TYPES = new Set(['Crater']);

/** Minimum diameter (km) for Wikipedia link eligibility */
const WIKI_MIN_DIAMETER = 25;

/** Style per category: [color, font, textShadow, opacity, charWidth, halfHeight] */
const CAT_STYLES: Record<Category, {
  color: string; font: string; textShadow: string;
  opacity: string; charWidth: number; hh: number;
}> = {
  [Category.Maria]: {
    color: '#c8a0ff', font: 'bold 13px "Segoe UI",sans-serif',
    textShadow: '0 0 4px #000,0 0 8px #000', opacity: '0.7',
    charWidth: 8, hh: 9,
  },
  [Category.Craters]: {
    color: '#f0d080', font: '11px "Segoe UI",sans-serif',
    textShadow: '0 0 3px #000,0 0 6px #000', opacity: '0.85',
    charWidth: 7, hh: 7,
  },
  [Category.Other]: {
    color: '#80d0d0', font: 'italic 11px "Segoe UI",sans-serif',
    textShadow: '0 0 3px #000,0 0 6px #000', opacity: '0.8',
    charWidth: 7, hh: 7,
  },
};

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

function classifyType(type: string): Category {
  if (MARIA_TYPES.has(type)) return Category.Maria;
  if (CRATER_TYPES.has(type)) return Category.Craters;
  return Category.Other;
}

// ─── Per-category data (pre-sorted by diameter) ──────────────────

interface CategoryData {
  /** Indices into allFeatures[], sorted by diameter descending */
  indices: number[];
  /** Max visible labels on screen (slider value) */
  maxVisible: number;
  /** DOM element pool */
  pool: HTMLDivElement[];
  /** Cache: feature index assigned to each pool slot (-1 = none) */
  poolFeatureIndex: number[];
  /** Cache: wiki state when slot was last styled */
  poolWikiState: boolean[];
}

// ─── FormationsOverlay ───────────────────────────────────────────

/**
 * Overlay displaying named lunar features as DOM labels on the globe.
 *
 * Three independent categories, each with its own slider and color:
 *   - Maria (Mare, Oceanus, Lacus, Sinus, Palus) — violet #c8a0ff
 *   - Craters — gold #f0d080
 *   - Other (Rima, Mons, Dorsum, Vallis, Catena, Rupes, ...) — cyan #80d0d0
 *
 * Each category has its own pool of DOM elements and per-frame visibility scan.
 * All optimizations from the previous version are preserved.
 */
export class FormationsOverlay {
  private labelContainer: HTMLDivElement;
  private visible = false;
  private wikiMode = false;

  /** All features from JSON */
  private allFeatures: LunarFeature[] = [];
  /** Metadata parallel to allFeatures */
  private allMeta: FeatureMeta[] = [];
  /** World positions parallel to allFeatures */
  private allWorldPositions: THREE.Vector3[] = [];

  /** Per-category state */
  private cats: CategoryData[] = [];

  // ─── Optim: pre-allocated placement arrays (shared across categories) ──
  private placedX = new Float64Array(120);
  private placedY = new Float64Array(120);
  private placedHW = new Float64Array(120);
  private placedHH = new Float64Array(120);

  // ─── Optim: stable wiki click handler ──
  private readonly _onWikiClick = (e: MouseEvent) => {
    const url = (e.currentTarget as HTMLDivElement).dataset.wikiUrl;
    if (url) window.open(url, '_blank');
  };

  // ─── Optim: camera dirty check ──
  private readonly _lastCamPos = new THREE.Vector3();
  private _lastProjMatSig = 0;
  private _lastW = 0;
  private _lastH = 0;
  private _dirty = true;

  private readonly _tmpVec = new THREE.Vector3();

  constructor() {
    this.labelContainer = document.createElement('div');
    this.labelContainer.id = 'formations-labels';
    this.labelContainer.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;display:none;';
    document.body.appendChild(this.labelContainer);

    // Initialize 3 empty categories with default maxVisible
    for (let c = 0; c < CATEGORY_COUNT; c++) {
      this.cats.push({
        indices: [],
        maxVisible: c === Category.Maria ? 10 : 10,
        pool: [],
        poolFeatureIndex: [],
        poolWikiState: [],
      });
    }
  }

  // ─── Data loading ────────────────────────────────────────────

  async loadData(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
    this.allFeatures = await response.json();

    const r = SPHERE_RADIUS * SURFACE_OFFSET;
    this.allWorldPositions = [];
    this.allMeta = [];

    // Temporary per-category lists (to sort by diameter within each category)
    const catIndices: number[][] = [[], [], []];

    for (let i = 0; i < this.allFeatures.length; i++) {
      const f = this.allFeatures[i];
      const wp = new THREE.Vector3();
      latLonToVec3(f.lat, f.lon, r, wp);
      this.allWorldPositions.push(wp);

      const cat = classifyType(f.type);
      this.allMeta.push({
        category: cat,
        wikiEligible: f.diameter >= WIKI_MIN_DIAMETER,
        wikiUrl: makeWikiUrl(f),
      });

      catIndices[cat].push(i);
    }

    // Sort each category by diameter descending
    for (let c = 0; c < CATEGORY_COUNT; c++) {
      catIndices[c].sort((a, b) => this.allFeatures[b].diameter - this.allFeatures[a].diameter);
      this.cats[c].indices = catIndices[c];
    }

    console.log(
      `Loaded ${this.allFeatures.length} lunar features: ` +
      `${catIndices[0].length} maria, ${catIndices[1].length} craters, ${catIndices[2].length} other`
    );

    this.rebuildPools();
  }

  // ─── Public API ──────────────────────────────────────────────

  setVisible(v: boolean): void {
    this.visible = v;
    this.labelContainer.style.display = v ? '' : 'none';
    if (v) {
      this._dirty = true;
    } else {
      for (const cat of this.cats)
        for (const el of cat.pool) el.style.display = 'none';
    }
  }

  /** Set max visible count for a category: 0=Maria, 1=Craters, 2=Other */
  setCategoryCount(category: number, n: number): void {
    const cat = this.cats[category];
    if (!cat || n === cat.maxVisible) return;
    cat.maxVisible = n;
    this.rebuildPool(category);
    this._dirty = true;
  }

  setWikiMode(v: boolean): void {
    if (v === this.wikiMode) return;
    this.wikiMode = v;
    this._dirty = true;
  }

  // ─── DOM pool management ───────────────────────────────────

  private rebuildPools(): void {
    for (let c = 0; c < CATEGORY_COUNT; c++) this.rebuildPool(c);
    this.resizePlacedArrays();
  }

  private rebuildPool(c: number): void {
    const cat = this.cats[c];
    const target = cat.maxVisible;

    // Shrink
    while (cat.pool.length > target) {
      const el = cat.pool.pop()!;
      el.remove();
    }
    // Grow
    while (cat.pool.length < target) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;pointer-events:none;display:none;';
      this.labelContainer.appendChild(el);
      cat.pool.push(el);
    }

    cat.poolFeatureIndex = new Array(target).fill(-1);
    cat.poolWikiState = new Array(target).fill(false);
    this.resizePlacedArrays();
  }

  private resizePlacedArrays(): void {
    const total = this.cats.reduce((s, c) => s + c.maxVisible, 0);
    if (total > this.placedX.length) {
      this.placedX = new Float64Array(total);
      this.placedY = new Float64Array(total);
      this.placedHW = new Float64Array(total);
      this.placedHH = new Float64Array(total);
    }
  }

  // ─── Styling ───────────────────────────────────────────────

  private applyLabel(el: HTMLDivElement, cat: Category): void {
    const s = CAT_STYLES[cat];
    el.style.color = s.color;
    el.style.font = s.font;
    el.style.textShadow = s.textShadow;
    el.style.opacity = s.opacity;
    el.style.whiteSpace = 'nowrap';
    el.style.transform = 'translate(-50%,-50%)';
  }

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

  private checkDirty(camera: THREE.Camera, w: number, h: number): boolean {
    if (this._dirty) return true;
    const pos = camera.position;
    if (pos.x !== this._lastCamPos.x ||
        pos.y !== this._lastCamPos.y ||
        pos.z !== this._lastCamPos.z) return true;
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
    if (!this.visible || this.allFeatures.length === 0) return;

    const w = window.innerWidth;
    const h = window.innerHeight;

    if (!this.checkDirty(camera, w, h)) return;
    this.saveCameraState(camera, w, h);

    const cameraPos = camera.position;
    const tmp = this._tmpVec;
    const pX = this.placedX;
    const pY = this.placedY;
    const pHW = this.placedHW;
    const pHH = this.placedHH;

    // Global placement count (shared across all categories for overlap avoidance)
    let placedCount = 0;

    // Process each category independently
    for (let c = 0; c < CATEGORY_COUNT; c++) {
      const cat = this.cats[c];
      if (cat.maxVisible === 0 || cat.pool.length === 0) continue;

      const style = CAT_STYLES[c as Category];
      let used = 0;

      for (let j = 0; j < cat.indices.length && used < cat.maxVisible; j++) {
        const fi = cat.indices[j]; // feature index in allFeatures
        const worldPos = this.allWorldPositions[fi];

        // Backface culling
        if (worldPos.dot(cameraPos) <= 0) continue;

        // Project to screen
        tmp.copy(worldPos);
        tmp.project(camera);
        if (tmp.z > 1) continue;

        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;

        // Edge margin
        if (x < EDGE_MARGIN || x > w - EDGE_MARGIN ||
            y < EDGE_MARGIN || y > h - EDGE_MARGIN) continue;

        // Overlap avoidance (against ALL categories already placed)
        const feature = this.allFeatures[fi];
        const hw = feature.name.length * style.charWidth * 0.5;
        const hh = style.hh;

        let overlaps = false;
        for (let p = 0; p < placedCount; p++) {
          if (Math.abs(x - pX[p]) < (hw + pHW[p]) &&
              Math.abs(y - pY[p]) < (hh + pHH[p])) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        // Assign to pool slot
        const el = cat.pool[used];

        // Only restyle if feature changed on this slot
        if (cat.poolFeatureIndex[used] !== fi) {
          el.textContent = feature.name;
          this.applyLabel(el, c as Category);
          this.applyWiki(el, this.allMeta[fi]);
          cat.poolFeatureIndex[used] = fi;
          cat.poolWikiState[used] = this.wikiMode;
        } else if (cat.poolWikiState[used] !== this.wikiMode) {
          this.applyWiki(el, this.allMeta[fi]);
          cat.poolWikiState[used] = this.wikiMode;
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

      // Hide unused pool slots
      for (let i = used; i < cat.pool.length; i++) {
        cat.pool[i].style.display = 'none';
        cat.poolFeatureIndex[i] = -1;
      }
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  dispose(): void {
    for (const cat of this.cats) {
      for (const el of cat.pool) el.remove();
      cat.pool = [];
      cat.indices = [];
      cat.poolFeatureIndex = [];
      cat.poolWikiState = [];
    }
    this.allFeatures = [];
    this.allMeta = [];
    this.allWorldPositions = [];
    this.labelContainer.remove();
  }
}
