import * as THREE from 'three';
import { MoonScene } from './core/Scene';
import { Lighting } from './core/Lighting';
import { Globe } from './moon/Globe';
import { HUD } from './ui/HUD';
import { GuiControls } from './ui/GuiControls';
import { MultiResTileManager } from './adaptive/MultiResTileManager';
import { GraticuleOverlay } from './overlays/GraticuleOverlay';
import { FormationsOverlay } from './overlays/FormationsOverlay';
import { SPHERE_RADIUS } from './utils/config';
import { initDataBaseUrl, getDataUrl } from './utils/data-paths';
import { computeSunPosition, SunInfo } from './astro/SunPosition';
import { computeEarthViewPosition } from './astro/EarthView';
import { Starfield } from './scene/Starfield';
import { loadPreferences, savePreferences } from './utils/preferences';

// Fly mode imports
import { FlyMode } from './fly/FlyMode';
import { FlyHUD } from './fly/FlyHUD';

// Workshop mode imports
import { extractLDEMRegion } from './workshop/LDEMRangeLoader';
import { buildBrickGeometry, updateBrickExaggeration, type BrickResult } from './workshop/BrickMeshBuilder';
import { WorkshopScene } from './workshop/WorkshopScene';
import { WorkshopHubGui } from './workshop/WorkshopHubGui';
import { exportMeshAsSTL, makeSTLFilename, exportScaledMeshAsSTL, makePieceSTLFilename } from './workshop/STLExport';
import { type PieceCount, decomposePieceCount, computeAllPieceBounds, type PieceBounds } from './workshop/PieceDecomposer';
import { buildShellSegment, type ShellSegmentResult } from './workshop/SphericalShellBuilder';

// --- Initialization ---
const moonScene = new MoonScene();
const lighting = new Lighting(moonScene.scene);

// --- Starfield background ---
const starfield = new Starfield(moonScene.scene);

// Globe with real LOLA-deformed mesh
const globe = new Globe();
globe.addToScene(moonScene.scene);


// --- Resolve data base URL (Electron or Vite dev) ---
await initDataBaseUrl();

// --- Load data ---
const textureLoader = new THREE.TextureLoader();

// Shared LROC texture between Globe and TileManager
let lrocTexture: THREE.Texture | null = null;

// 1) LROC color texture
textureLoader.load(
  getDataUrl('/moon-data/moon_texture_4k.jpg'),
  (texture) => {
    lrocTexture = texture;
    globe.setTexture(texture);
    tileManager.setTexture(texture);
    console.log('LROC 4K texture loaded');
  },
  undefined,
  (err) => {
    console.warn('4K texture failed, trying 2K...', err);
    textureLoader.load(
      getDataUrl('/moon-data/moon_texture_2k.jpg'),
      (texture) => {
        lrocTexture = texture;
        globe.setTexture(texture);
        tileManager.setTexture(texture);
        console.log('LROC 2K texture loaded');
      },
      undefined,
      (err2) => console.error('Failed to load texture', err2)
    );
  }
);

// 2) Normal map (applied to both Globe and TileManager for consistent shading)
textureLoader.load(
  getDataUrl('/moon-data/moon_normal_16ppd.png'),
  (normalTexture) => {
    globe.setNormalMap(normalTexture, prefs.normalIntensity);
    tileManager.setNormalMap(normalTexture, prefs.normalIntensity);
  },
  undefined,
  () => {
    textureLoader.load(
      getDataUrl('/moon-data/moon_normal_4ppd.png'),
      (normalTexture) => {
        globe.setNormalMap(normalTexture, prefs.normalIntensity);
        tileManager.setNormalMap(normalTexture, prefs.normalIntensity);
      },
      undefined,
      () => {}
    );
  }
);

// 3) Elevation data — LOLA 4ppd (Float32, already in meters, 4 MB)
globe.loadElevationBin(getDataUrl('/moon-data/lola_elevation_4ppd.bin'), 1440, 720)
  .then(() => console.log('LOLA 4ppd elevation applied'))
  .catch((err) => console.error('Elevation loading error:', err));

// --- Multi-resolution adaptive tiling ---
const tileManager = new MultiResTileManager(moonScene.scene);
let adaptiveMode = false;

// --- Lat/lon grid ---
const graticule = new GraticuleOverlay(moonScene.scene);

// --- Lunar formations ---
const formations = new FormationsOverlay();
formations.setWorkshopCallback((name: string) => enterWorkshopHub(name));
formations.loadData(getDataUrl('/moon-data/lunar_features.json'))
  .then(() => {
    console.log('Lunar features loaded');
    gui.setFeatureNames(formations.getAllFeatureNames());
  })
  .catch((err) => console.warn('Failed to load lunar features:', err));

// --- Sun + Earth-view: astronomical positioning at startup ---
let currentDateTime = new Date();
const initialSun = computeSunPosition(currentDateTime);
lighting.setSunDirection(initialSun.direction);

// Position camera as seen from Earth (with libration)
const initialEarthView = computeEarthViewPosition(currentDateTime);
moonScene.camera.position.copy(initialEarthView.direction).multiplyScalar(SPHERE_RADIUS * 3.5);

function applySunPosition(date: Date): SunInfo {
  const info = computeSunPosition(date);
  lighting.setSunDirection(info.direction);
  hud.setSunInfo(info.subSolarLat, info.subSolarLon, date);
  return info;
}

// Resolution → HUD description
const RES_HUD_INFO: Record<number, string> = {
  513:  'Adaptive — ~889 m/px',
  1025: 'Adaptive — ~444 m/px',
  2049: 'Adaptive — ~222 m/px',
};
let currentAdaptiveRes = 513;

// UI
const prefs = loadPreferences();
const hud = new HUD();
const gui = new GuiControls(lighting, globe, {
  onToggleAdaptive: (enabled: boolean) => {
    adaptiveMode = enabled;
    globe.setVisible(!enabled);
    tileManager.setVisible(enabled);
    hud.setResolutionInfo(enabled ? RES_HUD_INFO[currentAdaptiveRes] : 'Photo — LOLA 4ppd');
    console.log(`Adaptive mode: ${enabled ? 'ON' : 'OFF'}`);
  },
  onResolutionChange: (resolution) => {
    currentAdaptiveRes = resolution;
    tileManager.setResolution(resolution);
    if (adaptiveMode) {
      hud.setResolutionInfo(RES_HUD_INFO[resolution] || `Adaptive — ${resolution}px`);
    }
    console.log(`Resolution: ${resolution}`);
  },
  onMaxErrorChange: (maxError: number) => {
    tileManager.setMaxError(maxError);
  },
  onExaggerationChange: (v: number) => {
    tileManager.setExaggeration(v);
  },
  onWireframeChange: (enabled: boolean) => {
    tileManager.setWireframe(enabled);
  },
  onToggleGraticule: (enabled: boolean) => {
    graticule.setVisible(enabled);
  },
  onToggleFormations: (enabled: boolean) => {
    formations.setVisible(enabled);
  },
  onMariaCountChange: (count: number) => {
    formations.setCategoryCount(0, count); // 0 = Maria
  },
  onCratersCountChange: (count: number) => {
    formations.setCategoryCount(1, count); // 1 = Craters
  },
  onOtherCountChange: (count: number) => {
    formations.setCategoryCount(2, count); // 2 = Other
  },
  onToggleWiki: (enabled: boolean) => {
    formations.setLinkMode(enabled);
  },
  onSearchFeature: (name: string) => {
    const result = formations.getFeatureWorldPos(name);
    if (!result) return;
    const { worldPos, diameter } = result;

    // Keep target at origin so OrbitControls zoom (minDistance) works normally
    moonScene.controls.target.set(0, 0, 0);

    // Camera distance from center, proportional to diameter
    // Small craters (30km) → tight zoom, large maria (1000km+) → wide view
    const distFactor = Math.max(1.15, diameter / 200);
    const camDist = SPHERE_RADIUS * distFactor;

    // Position camera along the formation→outward vector
    const dir = worldPos.clone().normalize();
    moonScene.camera.position.copy(dir.multiplyScalar(camDist));

    // Highlight the formation
    formations.highlightFeature(name);
  },
  onClearSearch: () => {
    formations.highlightFeature(null);
  },
  onDateTimeChange: (date: Date) => {
    currentDateTime = date;
    applySunPosition(date);
  },
  onNowPressed: (date: Date) => {
    currentDateTime = date;
    applySunPosition(date);
    // Reset camera to Earth-view for current time
    const earthView = computeEarthViewPosition(date);
    moonScene.camera.position.copy(earthView.direction).multiplyScalar(SPHERE_RADIUS * 3.5);
    moonScene.controls.target.set(0, 0, 0);
  },
  getStats: () => ({
    tiles: tileManager.renderedTileCount,
    triangles: tileManager.totalTriangles,
  }),
}, prefs);

// Set initial HUD sun info (after HUD is created)
hud.setSunInfo(initialSun.subSolarLat, initialSun.subSolarLon, currentDateTime);

// --- Workshop mode state ---
let workshopMode = false;
type WorkshopSubMode = 'idle' | 'feature' | 'fmp';
let workshopSubMode: WorkshopSubMode = 'idle';
let workshopScene: WorkshopScene | null = null;
let workshopHubGui: WorkshopHubGui | null = null;

// Feature Print state
let workshopBrick: BrickResult | null = null;
let workshopFeatureName = '';
let workshopExaggeration = prefs.adaptiveExaggeration;
let workshopBaseThickness = prefs.wsBaseThickness;

// Workshop zone bounds (degrees) — stored so we can expand/shrink per direction
let wsLatMin = 0;
let wsLatMax = 0;
let wsLonMin = 0;
let wsLonMax = 0;
let wsCenterLat = 0; // needed for km↔deg conversion

// State saved before entering workshop
let wsFormationsWasVisible = false;
let wsGraticuleWasVisible = false;

const MOON_RADIUS_KM = 1737.4;
const KM_PER_DEG_LAT = (Math.PI * MOON_RADIUS_KM) / 180; // ~30.33 km/deg

// Light preferences (shared across workshop sub-modes)
let workshopLightAzimuth = prefs.wsLightAzimuth;
let workshopLightElevation = prefs.wsLightElevation;

// FMP state
let fmpPieceCount = prefs.fmpPieceCount as PieceCount;
let fmpDiameterMM = prefs.fmpDiameterMM;
let fmpShellThicknessMM = prefs.fmpShellThicknessMM;
let fmpExaggeration = prefs.fmpExaggeration;
// FMP light prefs no longer needed — headlight mode follows camera
let fmpSegments: ShellSegmentResult[] = [];
let fmpPieces: PieceBounds[] = [];

// --- Fly mode state ---
let flyMode: FlyMode | null = null;
let flyHud: FlyHUD | null = null;
let flyPickMode = false; // true = waiting for user to click a start point
let flyFormationsWasVisible = false;
let flyGraticuleWasVisible = false;

// DOM elements to hide/show
const hudEl = document.getElementById('hud');
const titleEl = document.getElementById('title');
const scalebarEl = document.getElementById('scalebar');

// Loading overlay
const loadingOverlay = document.createElement('div');
loadingOverlay.style.cssText =
  'position:fixed;inset:0;display:none;z-index:10000;' +
  'background:rgba(0,0,0,0.75);color:#fff;' +
  'font:18px "Segoe UI",sans-serif;' +
  'justify-content:center;align-items:center;text-align:center;';
document.body.appendChild(loadingOverlay);

function showLoading(msg: string): void {
  loadingOverlay.textContent = msg;
  loadingOverlay.style.display = 'flex';
}
function hideLoading(): void {
  loadingOverlay.style.display = 'none';
}

// ─── Globe show/hide helpers ──────────────────────────────────

function hideGlobeElements(): void {
  wsGraticuleWasVisible = graticule.isVisible();
  wsFormationsWasVisible = formations.isVisible();
  globe.setVisible(false);
  tileManager.setVisible(false);
  starfield.setVisible(false);
  graticule.setVisible(false);
  formations.setVisible(false);
  if (hudEl) hudEl.style.display = 'none';
  if (titleEl) titleEl.style.display = 'none';
  gui.hide();
  moonScene.controls.enabled = false;
}

function restoreGlobeElements(): void {
  globe.setVisible(!adaptiveMode);
  tileManager.setVisible(adaptiveMode);
  starfield.setVisible(true);
  if (hudEl) hudEl.style.display = '';
  if (titleEl) titleEl.style.display = '';
  gui.show();
  moonScene.controls.enabled = true;
  if (wsGraticuleWasVisible) graticule.setVisible(true);
  if (wsFormationsWasVisible) formations.setVisible(true);
}

// ─── Feature Print helpers ────────────────────────────────────

/** Compute current workshop zone size in km */
function wsZoneSizeKm(): { nsKm: number; ewKm: number } {
  const nsKm = (wsLatMax - wsLatMin) * KM_PER_DEG_LAT;
  const cosLat = Math.cos(wsCenterLat * Math.PI / 180);
  const ewKm = (wsLonMax - wsLonMin) * KM_PER_DEG_LAT * cosLat;
  return { nsKm, ewKm };
}

/** Extract and build the workshop brick from current ws bounds */
async function featureExtractAndBuild(featureName: string): Promise<void> {
  showLoading(`Extracting terrain around ${featureName}...`);

  try {
    const heightmap = await extractLDEMRegion(wsLatMin, wsLatMax, wsLonMin, wsLonMax, (msg) => {
      showLoading(`${featureName}: ${msg}`);
    });

    showLoading(`Building 3D mesh...`);
    const brick = buildBrickGeometry({
      heightmap,
      exaggeration: workshopExaggeration,
      baseThickness: workshopBaseThickness,
    });

    workshopBrick = brick;
    workshopFeatureName = featureName;

    if (!workshopScene) {
      workshopScene = new WorkshopScene(moonScene.renderer);
    }
    workshopScene.setBrick(brick);
    workshopScene.setLightDirection(workshopLightAzimuth, workshopLightElevation);

    const { nsKm, ewKm } = wsZoneSizeKm();
    workshopHubGui?.updateZoneSize(nsKm, ewKm);

    hideLoading();
    console.log(`Feature Print: ${featureName} (${brick.cols}×${brick.rows}, ${nsKm.toFixed(0)}×${ewKm.toFixed(0)} km)`);
  } catch (err) {
    hideLoading();
    console.error('Feature extraction failed:', err);
    alert(`Failed to extract terrain: ${(err as Error).message}`);
  }
}

// ─── FMP helpers ──────────────────────────────────────────────

/** Compute shell thickness in km from mm parameters */
function fmpShellThicknessKm(): number {
  const scaleMM = fmpDiameterMM / (2 * MOON_RADIUS_KM);
  return fmpShellThicknessMM / scaleMM;
}

/** Compute lip depth in km from a 0.4mm lip at current scale */
function fmpLipDepthKm(): number {
  const scaleMM = fmpDiameterMM / (2 * MOON_RADIUS_KM);
  return 0.4 / scaleMM;
}

/** Build all pieces for the current FMP configuration */
async function fmpBuildAllPieces(): Promise<void> {
  const decomp = decomposePieceCount(fmpPieceCount);
  fmpPieces = computeAllPieceBounds(decomp.bands, decomp.sectors);

  showLoading(`Building ${fmpPieces.length} pieces (${decomp.bands}×${decomp.sectors})...`);

  const shellThKm = fmpShellThicknessKm();
  const lipKm = fmpLipDepthKm();

  for (const seg of fmpSegments) seg.geometry.dispose();
  fmpSegments = [];

  for (let i = 0; i < fmpPieces.length; i++) {
    const piece = fmpPieces[i];
    showLoading(`Piece ${i + 1}/${fmpPieces.length}: extracting terrain...`);

    const heightmap = await extractLDEMRegion(
      piece.latMin, piece.latMax, piece.lonMin, piece.lonMax,
      (msg) => showLoading(`Piece ${i + 1}/${fmpPieces.length}: ${msg}`),
      513,
    );

    showLoading(`Piece ${i + 1}/${fmpPieces.length}: building geometry...`);

    const seg = buildShellSegment({
      heightmap,
      piece,
      exaggeration: fmpExaggeration,
      shellThicknessKm: shellThKm,
      lipDepthKm: lipKm,
    });

    fmpSegments.push(seg);
  }

  showLoading('Assembling preview...');
}

/** Show the assembly view (all pieces with explode) */
function fmpShowAssembly(): void {
  if (!workshopScene || fmpSegments.length === 0) return;
  workshopScene.clearPieces();
  const geometries = fmpSegments.map(s => s.geometry);
  workshopScene.setPieces(geometries, 0.03);
}

/** Show a single piece in print orientation */
function fmpShowPiece(index: number): void {
  if (!workshopScene || index >= fmpSegments.length) return;
  const seg = fmpSegments[index];
  const piece = seg.piece;

  const midLat = (piece.latMin + piece.latMax) / 2;
  const midLon = (piece.lonMin + piece.lonMax) / 2;
  const latRad = midLat * Math.PI / 180;
  const lonRad = midLon * Math.PI / 180;
  const dir = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    -Math.cos(latRad) * Math.sin(lonRad),
  );

  workshopScene.showSinglePiece(seg.geometry, dir);
}

/** Compute piece center direction for export rotation */
function fmpPieceCenterDir(piece: PieceBounds): THREE.Vector3 {
  const midLat = (piece.latMin + piece.latMax) / 2;
  const midLon = (piece.lonMin + piece.lonMax) / 2;
  const latRad = midLat * Math.PI / 180;
  const lonRad = midLon * Math.PI / 180;
  return new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    -Math.cos(latRad) * Math.sin(lonRad),
  );
}

// ─── Clean up sub-mode data (without restoring globe) ─────────

/** Clean feature print data */
function cleanFeatureData(): void {
  if (workshopBrick) {
    workshopBrick.geometry.dispose();
    workshopBrick = null;
  }
  if (workshopScene) {
    workshopScene.clearBrick();
  }
}

/** Clean FMP data */
function cleanFmpData(): void {
  if (workshopScene) {
    workshopScene.clearPieces();
    workshopScene.setHeadlightMode(false);
  }
  for (const seg of fmpSegments) seg.geometry.dispose();
  fmpSegments = [];
  fmpPieces = [];
}

// ─── Workshop mode entry/exit ─────────────────────────────────

/** Create the hub GUI with all callbacks */
function createWorkshopHubGui(): WorkshopHubGui {
  const featureNames = formations.getAllFeatureNames();
  return new WorkshopHubGui(featureNames, {
    // ─── Feature search ───
    onSearchFeature: (name) => enterFeaturePrint(name),
    onClearSearch: () => {
      // Return to idle within workshop
      cleanFeatureData();
      workshopSubMode = 'idle';
    },

    // ─── Feature Print ───
    onZoneExpand: (direction, stepKm) => {
      const MIN_ZONE_KM = 20;
      const degLat = stepKm / KM_PER_DEG_LAT;
      const cosLat = Math.cos(wsCenterLat * Math.PI / 180);
      const degLon = stepKm / (KM_PER_DEG_LAT * cosLat);

      if (direction === 'north') wsLatMax = Math.min(90, wsLatMax + degLat);
      else if (direction === 'south') wsLatMin = Math.max(-90, wsLatMin - degLat);
      else if (direction === 'east') wsLonMax += degLon;
      else if (direction === 'west') wsLonMin -= degLon;

      if ((wsLatMax - wsLatMin) * KM_PER_DEG_LAT < MIN_ZONE_KM) {
        if (direction === 'north') wsLatMax = wsLatMin + MIN_ZONE_KM / KM_PER_DEG_LAT;
        else if (direction === 'south') wsLatMin = wsLatMax - MIN_ZONE_KM / KM_PER_DEG_LAT;
      }
      const ewNow = (wsLonMax - wsLonMin) * KM_PER_DEG_LAT * cosLat;
      if (ewNow < MIN_ZONE_KM) {
        const minDeg = MIN_ZONE_KM / (KM_PER_DEG_LAT * cosLat);
        if (direction === 'east') wsLonMax = wsLonMin + minDeg;
        else if (direction === 'west') wsLonMin = wsLonMax - minDeg;
      }

      featureExtractAndBuild(workshopFeatureName);
    },
    onFeatureExaggerationChange: (exag) => {
      workshopExaggeration = exag;
      if (workshopBrick && workshopScene) {
        updateBrickExaggeration(workshopBrick, exag, workshopBaseThickness, workshopBrick.geometry);
        workshopScene.updateGeometry(workshopBrick.geometry);
      }
    },
    onBaseThicknessChange: (km) => {
      workshopBaseThickness = km;
      savePreferences({ wsBaseThickness: km });
      if (workshopBrick && workshopScene) {
        updateBrickExaggeration(workshopBrick, workshopExaggeration, km, workshopBrick.geometry);
        workshopScene.updateGeometry(workshopBrick.geometry);
      }
    },
    onExportFeatureSTL: () => {
      if (!workshopScene) return;
      const mesh = workshopScene.getBrickMesh();
      if (!mesh) return;
      const filename = makeSTLFilename(workshopFeatureName, workshopExaggeration);
      exportMeshAsSTL(mesh, filename);
    },

    // ─── Full Moon Print ───
    onEnterFullMoonPrint: () => enterFmpSubMode(),
    onBuildFmp: () => fmpBuild(),
    onPieceCountChange: (n) => {
      fmpPieceCount = n;
      savePreferences({ fmpPieceCount: n });
    },
    onDiameterChange: (mm) => {
      fmpDiameterMM = mm;
      savePreferences({ fmpDiameterMM: mm });
    },
    onShellThicknessChange: (mm) => {
      fmpShellThicknessMM = mm;
      savePreferences({ fmpShellThicknessMM: mm });
    },
    onFmpExaggerationChange: (exag) => {
      fmpExaggeration = exag;
      savePreferences({ fmpExaggeration: exag });
    },
    onPreviewChange: (mode) => {
      if (mode === 'assembly') fmpShowAssembly();
      else fmpShowPiece(mode);
    },
    onExportPiece: (index) => {
      if (index >= fmpSegments.length) return;
      const seg = fmpSegments[index];
      const scaleMM = fmpDiameterMM / (2 * MOON_RADIUS_KM);
      const dir = fmpPieceCenterDir(seg.piece);
      const q = new THREE.Quaternion().setFromUnitVectors(dir.normalize(), new THREE.Vector3(0, 1, 0));
      const filename = makePieceSTLFilename(seg.piece.band, seg.piece.sector, fmpExaggeration, fmpDiameterMM);
      exportScaledMeshAsSTL(seg.geometry, scaleMM, q, filename);
    },
    onExportAll: async () => {
      const scaleMM = fmpDiameterMM / (2 * MOON_RADIUS_KM);
      for (let i = 0; i < fmpSegments.length; i++) {
        showLoading(`Exporting piece ${i + 1}/${fmpSegments.length}...`);
        const seg = fmpSegments[i];
        const dir = fmpPieceCenterDir(seg.piece);
        const q = new THREE.Quaternion().setFromUnitVectors(dir.normalize(), new THREE.Vector3(0, 1, 0));
        const filename = makePieceSTLFilename(seg.piece.band, seg.piece.sector, fmpExaggeration, fmpDiameterMM);
        exportScaledMeshAsSTL(seg.geometry, scaleMM, q, filename);
        await new Promise(r => setTimeout(r, 300));
      }
      hideLoading();
    },

    // ─── Shared (light controls only used in Feature Print — hidden in FMP) ───
    onLightAzimuthChange: (deg) => {
      workshopLightAzimuth = deg;
      savePreferences({ wsLightAzimuth: deg });
      workshopScene?.setLightDirection(deg, workshopLightElevation);
    },
    onLightElevationChange: (deg) => {
      workshopLightElevation = deg;
      savePreferences({ wsLightElevation: deg });
      workshopScene?.setLightDirection(workshopLightAzimuth, deg);
    },
    onWireframeChange: (enabled) => {
      workshopScene?.setWireframe(enabled);
    },
    onBack: () => exitWorkshop(),
  }, {
    featureExaggeration: workshopExaggeration,
    baseThickness: workshopBaseThickness,
    fmpPieceCount,
    fmpDiameterMM,
    fmpShellThicknessMM,
    fmpExaggeration,
    azimuth: workshopLightAzimuth,
    elevation: workshopLightElevation,
  });
}

/** Enter Workshop Hub (idle mode). If featureName is provided, loads it immediately. */
async function enterWorkshopHub(featureName?: string): Promise<void> {
  // Already in workshop? Just switch sub-mode
  if (workshopMode && featureName) {
    cleanFmpData();
    await enterFeaturePrint(featureName);
    return;
  }
  if (workshopMode) return; // already in hub

  // Hide globe
  hideGlobeElements();

  // Create workshop scene
  if (!workshopScene) {
    workshopScene = new WorkshopScene(moonScene.renderer);
  }
  workshopScene.activate();

  // Create hub GUI
  if (workshopHubGui) workshopHubGui.dispose();
  workshopHubGui = createWorkshopHubGui();

  workshopMode = true;
  workshopSubMode = 'idle';

  console.log('Entered Workshop hub');

  // Auto-select feature if provided
  if (featureName) {
    await enterFeaturePrint(featureName);
  }
}

/** Enter Feature Print sub-mode (from within workshop hub) */
async function enterFeaturePrint(featureName: string): Promise<void> {
  const info = formations.getFeatureInfo(featureName);
  if (!info) { console.warn('Feature not found:', featureName); return; }

  // Clean up previous sub-mode data
  cleanFmpData();
  cleanFeatureData();

  // Compute initial extraction zone: 1.5× diameter around the feature
  const INITIAL_MARGIN = 1.5;
  wsCenterLat = info.lat;
  const cosLat = Math.cos(info.lat * Math.PI / 180);
  const halfExtentKm = (info.diameter / 2) * INITIAL_MARGIN;
  const halfExtentLat = halfExtentKm / KM_PER_DEG_LAT;
  const halfExtentLon = halfExtentKm / (KM_PER_DEG_LAT * cosLat);

  wsLatMin = Math.max(-90, info.lat - halfExtentLat);
  wsLatMax = Math.min(90, info.lat + halfExtentLat);
  wsLonMin = info.lon - halfExtentLon;
  wsLonMax = info.lon + halfExtentLon;

  workshopSubMode = 'feature';

  // Update hub GUI
  workshopHubGui?.selectFeature(featureName);

  // Apply feature light prefs
  workshopScene?.setLightDirection(workshopLightAzimuth, workshopLightElevation);

  await featureExtractAndBuild(featureName);
}

/** Enter Full Moon Print sub-mode (idle — no build until user clicks "Build pieces") */
function enterFmpSubMode(): void {
  // Clean up previous sub-mode data
  cleanFeatureData();
  cleanFmpData();

  workshopSubMode = 'fmp';

  // Update hub GUI — opens FMP folder, hides Light folder
  workshopHubGui?.openFmpFolder();

  if (!workshopScene) {
    workshopScene = new WorkshopScene(moonScene.renderer);
  }

  // Enable headlight mode: light follows camera so the sphere is always fully lit
  workshopScene.setHeadlightMode(true);

  console.log('Full Moon Print: ready — click "Build pieces" to generate');
}

/** Build FMP pieces (called from "Build pieces" button) */
async function fmpBuild(): Promise<void> {
  if (!workshopScene) return;

  try {
    await fmpBuildAllPieces();
    fmpShowAssembly();
    workshopHubGui?.updatePieceList(fmpPieceCount);
    hideLoading();
    console.log(`Full Moon Print: ${fmpPieceCount} pieces built`);
  } catch (err) {
    hideLoading();
    console.error('Full Moon Print failed:', err);
    alert(`Full Moon Print failed: ${(err as Error).message}`);
  }
}

/** Exit workshop mode entirely and return to globe */
function exitWorkshop(): void {
  // Clean all sub-mode data
  cleanFeatureData();
  cleanFmpData();

  // Deactivate workshop scene
  if (workshopScene) workshopScene.deactivate();

  // Dispose hub GUI
  if (workshopHubGui) {
    workshopHubGui.dispose();
    workshopHubGui = null;
  }

  workshopMode = false;
  workshopSubMode = 'idle';

  // Restore globe
  restoreGlobeElements();

  console.log('Exited Workshop');
}

// ─── Fly mode entry/exit ──────────────────────────────────────

/** Enter "pick start point" mode: user clicks on terrain to begin flying */
function startFlyModePick(): void {
  if (workshopMode || flyPickMode) return;
  if (!adaptiveMode) {
    alert('Fly Mode requires Adaptive mode. Please switch to Adaptive first.');
    return;
  }

  flyPickMode = true;
  document.body.style.cursor = 'crosshair';

  const onClick = (e: MouseEvent) => {
    // Raycast against the scene to find the click point on terrain
    const rect = moonScene.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );

    // Analytic ray-sphere intersection (more reliable than mesh raycasting)
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, moonScene.camera);
    const ray = raycaster.ray;

    // Solve |origin + t*dir|² = R² → t² + 2t(origin·dir) + (|origin|²-R²) = 0
    const oc = ray.origin;
    const d = ray.direction;
    const a = d.dot(d);
    const b = 2 * oc.dot(d);
    const c = oc.dot(oc) - SPHERE_RADIUS * SPHERE_RADIUS;
    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      // Missed the sphere
      flyPickMode = false;
      document.body.style.cursor = '';
      moonScene.renderer.domElement.removeEventListener('click', onClick);
      return;
    }

    const t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0) {
      flyPickMode = false;
      document.body.style.cursor = '';
      moonScene.renderer.domElement.removeEventListener('click', onClick);
      return;
    }

    const hitPoint = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t);

    flyPickMode = false;
    document.body.style.cursor = '';
    moonScene.renderer.domElement.removeEventListener('click', onClick);

    enterFlyMode(hitPoint);
  };

  moonScene.renderer.domElement.addEventListener('click', onClick);
}

/** Enter fly mode at the given start point on the sphere */
function enterFlyMode(startPoint: THREE.Vector3): void {
  // Hide GUI, HUD, scalebar, overlays, disable orbit controls
  gui.hide();
  if (hudEl) hudEl.style.display = 'none';
  if (titleEl) titleEl.style.display = 'none';
  if (scalebarEl) scalebarEl.style.display = 'none';
  flyFormationsWasVisible = formations.isVisible();
  flyGraticuleWasVisible = graticule.isVisible();
  formations.setVisible(false);
  graticule.setVisible(false);
  moonScene.controls.enabled = false;

  // Create fly mode controller (pass current adaptive exaggeration)
  flyMode = new FlyMode(
    moonScene.camera,
    moonScene.renderer.domElement,
    globe,
    tileManager.exaggeration,
    {
      onExit: () => exitFlyMode(),
    },
  );

  // Create fly HUD
  flyHud = new FlyHUD();

  // Activate
  flyMode.activate(startPoint);
}

/** Exit fly mode and restore normal controls */
function exitFlyMode(): void {
  if (flyMode) {
    flyMode.deactivate();
    flyMode = null;
  }
  if (flyHud) {
    flyHud.dispose();
    flyHud = null;
  }

  // Restore camera to a reasonable distance looking at the last position
  const camPos = moonScene.camera.position.clone();
  const dir = camPos.normalize();
  moonScene.camera.position.copy(dir.multiplyScalar(SPHERE_RADIUS * 2));
  moonScene.controls.target.set(0, 0, 0);
  moonScene.controls.enabled = true;

  // Restore UI
  gui.show();
  if (hudEl) hudEl.style.display = '';
  if (titleEl) titleEl.style.display = '';
  if (scalebarEl) scalebarEl.style.display = '';
  if (flyFormationsWasVisible) formations.setVisible(true);
  if (flyGraticuleWasVisible) graticule.setVisible(true);
}

// Expose fly mode globally (for GuiControls button)
(window as any).__startFlyMode = startFlyModePick;

// Expose enterWorkshopHub globally (for GuiControls button + formations overlay)
(window as any).__enterWorkshopHub = enterWorkshopHub;

// --- Render loop ---
function animate(time: number) {
  requestAnimationFrame(animate);

  // ─── Fly mode ────────────────────────────────────────────
  if (flyMode && flyMode.isActive()) {
    flyMode.update();

    // Update adaptive tiles around the camera's current position
    if (adaptiveMode) {
      tileManager.update(moonScene.camera);
    }

    // Update fly HUD
    if (flyHud) {
      flyHud.update(flyMode.getInfo());
    }

    // Render the main scene (globe + tiles + starfield)
    moonScene.renderer.render(moonScene.scene, moonScene.camera);
    return;
  }

  if (workshopMode) {
    workshopScene?.render();
    if (workshopScene) {
      const camDist = workshopScene.camera.position.distanceTo(workshopScene.controls.target);
      hud.updateScaleBarKm(workshopScene.camera, camDist);
    }
    return;
  }

  // --- Globe render loop ---

  // Adapt rotation/pan speed to zoom level
  const dist = moonScene.camera.position.length();
  const distRatio = (dist - moonScene.controls.minDistance)
                  / (moonScene.controls.maxDistance - moonScene.controls.minDistance);
  const speedFactor = 0.05 + 0.95 * Math.max(0, Math.min(1, distRatio));
  moonScene.controls.rotateSpeed = 0.4 * speedFactor;
  moonScene.controls.panSpeed = 2.0 * speedFactor;

  // HUD update (raycast only against the globe mesh, not the entire scene)
  hud.update(moonScene.camera, [globe.mesh], time);

  // Graticule labels
  graticule.update(moonScene.camera);

  // Formation labels
  formations.update(moonScene.camera);

  // Adaptive tile manager
  if (adaptiveMode) {
    tileManager.update(moonScene.camera);
  }

  moonScene.render();
}

requestAnimationFrame(animate);

console.log('MoonOrbiter started');
console.log('Controls: Left mouse = orbit, Wheel = zoom, Right mouse = pan');
