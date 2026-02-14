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

// Workshop mode imports
import { extractLDEMRegion } from './workshop/LDEMRangeLoader';
import { buildBrickGeometry, updateBrickExaggeration, type BrickResult } from './workshop/BrickMeshBuilder';
import { WorkshopScene } from './workshop/WorkshopScene';
import { WorkshopGui } from './workshop/WorkshopGui';
import { exportMeshAsSTL, makeSTLFilename } from './workshop/STLExport';

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
formations.setWorkshopCallback((name: string) => enterWorkshop(name));
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
  513:  'LDEM 64ppd — ~889 m/px',
  1025: 'LDEM 64ppd — ~444 m/px',
  2049: 'LDEM 128ppd — ~222 m/px',
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
    hud.setResolutionInfo(enabled ? RES_HUD_INFO[currentAdaptiveRes] : 'LOLA 4ppd — Globe');
    console.log(`Adaptive mode: ${enabled ? 'ON' : 'OFF'}`);
  },
  onResolutionChange: (resolution) => {
    currentAdaptiveRes = resolution;
    tileManager.setResolution(resolution);
    if (adaptiveMode) {
      hud.setResolutionInfo(RES_HUD_INFO[resolution] || `LDEM — ${resolution}px`);
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
let workshopScene: WorkshopScene | null = null;
let workshopGui: WorkshopGui | null = null;
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
let wsFormationsWasVisible = false;
let wsGraticuleWasVisible = false;

const MOON_RADIUS_KM = 1737.4;
const KM_PER_DEG_LAT = (Math.PI * MOON_RADIUS_KM) / 180; // ~30.33 km/deg

// DOM elements to hide/show
const hudEl = document.getElementById('hud');
const titleEl = document.getElementById('title');

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

/** Compute current workshop zone size in km */
function wsZoneSizeKm(): { nsKm: number; ewKm: number } {
  const nsKm = (wsLatMax - wsLatMin) * KM_PER_DEG_LAT;
  const cosLat = Math.cos(wsCenterLat * Math.PI / 180);
  const ewKm = (wsLonMax - wsLonMin) * KM_PER_DEG_LAT * cosLat;
  return { nsKm, ewKm };
}

/** Extract and build the workshop brick from current ws bounds */
async function workshopExtractAndBuild(featureName: string, createGui: boolean): Promise<void> {
  showLoading(`Extracting terrain around ${featureName}...`);

  try {
    // Extract LDEM region
    const heightmap = await extractLDEMRegion(wsLatMin, wsLatMax, wsLonMin, wsLonMax, (msg) => {
      showLoading(`${featureName}: ${msg}`);
    });

    // Build brick geometry
    showLoading(`Building 3D mesh...`);
    const brick = buildBrickGeometry({
      heightmap,
      exaggeration: workshopExaggeration,
      baseThickness: workshopBaseThickness,
    });

    workshopBrick = brick;
    workshopFeatureName = featureName;

    // Create workshop scene (lazy — reuses main renderer)
    if (!workshopScene) {
      workshopScene = new WorkshopScene(moonScene.renderer);
    }
    workshopScene.setBrick(brick);
    // Appliquer les prefs de lumière (setBrick() reset à 45°/30° par défaut)
    workshopScene.setLightDirection(workshopLightAzimuth, workshopLightElevation);

    const { nsKm, ewKm } = wsZoneSizeKm();

    if (createGui) {
      // Create workshop GUI
      if (workshopGui) workshopGui.dispose();
      workshopGui = new WorkshopGui(featureName, nsKm, ewKm, {
        onZoneExpand: (direction, stepKm) => {
          const MIN_ZONE_KM = 20;
          const degLat = stepKm / KM_PER_DEG_LAT;
          const cosLat = Math.cos(wsCenterLat * Math.PI / 180);
          const degLon = stepKm / (KM_PER_DEG_LAT * cosLat);

          if (direction === 'north') wsLatMax = Math.min(90, wsLatMax + degLat);
          else if (direction === 'south') wsLatMin = Math.max(-90, wsLatMin - degLat);
          else if (direction === 'east') wsLonMax += degLon;
          else if (direction === 'west') wsLonMin -= degLon;

          // Enforce minimum zone size
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

          // Re-extract with new bounds (keep existing GUI)
          workshopExtractAndBuild(workshopFeatureName, false).then(() => {
            const size = wsZoneSizeKm();
            workshopGui?.updateZoneSize(size.nsKm, size.ewKm);
          });
        },
        onExaggerationChange: (exag: number) => {
          workshopExaggeration = exag;
          if (workshopBrick && workshopScene) {
            updateBrickExaggeration(workshopBrick, exag, workshopBaseThickness, workshopBrick.geometry);
            workshopScene.updateGeometry(workshopBrick.geometry);
          }
        },
        onBaseThicknessChange: (km: number) => {
          workshopBaseThickness = km;
          savePreferences({ wsBaseThickness: km });
          if (workshopBrick && workshopScene) {
            updateBrickExaggeration(workshopBrick, workshopExaggeration, km, workshopBrick.geometry);
            workshopScene.updateGeometry(workshopBrick.geometry);
          }
        },
        onLightAzimuthChange: (deg: number) => {
          workshopScene?.setLightDirection(deg, workshopLightElevation);
          workshopLightAzimuth = deg;
          savePreferences({ wsLightAzimuth: deg });
        },
        onLightElevationChange: (deg: number) => {
          workshopScene?.setLightDirection(workshopLightAzimuth, deg);
          workshopLightElevation = deg;
          savePreferences({ wsLightElevation: deg });
        },
        onWireframeChange: (enabled: boolean) => {
          workshopScene?.setWireframe(enabled);
        },
        onExportSTL: () => {
          if (!workshopScene) return;
          const mesh = workshopScene.getBrickMesh();
          if (!mesh) return;
          const filename = makeSTLFilename(workshopFeatureName, workshopExaggeration);
          exportMeshAsSTL(mesh, filename);
        },
        onBack: () => {
          exitWorkshop();
        },
      }, {
        exaggeration: workshopExaggeration,
        baseThickness: workshopBaseThickness,
        azimuth: workshopLightAzimuth,
        elevation: workshopLightElevation,
      });

      // Switch to workshop mode
      workshopMode = true;
      workshopScene.activate();
      moonScene.controls.enabled = false;

      // Hide globe elements
      globe.setVisible(false);
      tileManager.setVisible(false);
      starfield.setVisible(false);
      wsGraticuleWasVisible = graticule.isVisible();
      wsFormationsWasVisible = formations.isVisible();
      graticule.setVisible(false);
      formations.setVisible(false);
      if (hudEl) hudEl.style.display = 'none';
      if (titleEl) titleEl.style.display = 'none';
      gui.hide();
    }

    hideLoading();
    console.log(`Workshop mode: ${featureName} (${brick.cols}×${brick.rows}, ${nsKm.toFixed(0)}×${ewKm.toFixed(0)} km)`);

  } catch (err) {
    hideLoading();
    console.error('Workshop extraction failed:', err);
    alert(`Failed to extract terrain: ${(err as Error).message}`);
  }
}

let workshopLightAzimuth = prefs.wsLightAzimuth;
let workshopLightElevation = prefs.wsLightElevation;

/** Enter workshop mode: compute initial zone and extract */
async function enterWorkshop(featureName: string): Promise<void> {
  const info = formations.getFeatureInfo(featureName);
  if (!info) { console.warn('Feature not found:', featureName); return; }

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

  await workshopExtractAndBuild(featureName, true);
}

/** Exit workshop mode and return to globe */
function exitWorkshop(): void {
  workshopMode = false;

  // Deactivate workshop
  if (workshopScene) workshopScene.deactivate();
  moonScene.controls.enabled = true;

  // Dispose workshop GUI
  if (workshopGui) {
    workshopGui.dispose();
    workshopGui = null;
  }

  // Dispose brick geometry
  if (workshopBrick) {
    workshopBrick.geometry.dispose();
    workshopBrick = null;
  }

  // Restore globe elements
  globe.setVisible(!adaptiveMode);
  tileManager.setVisible(adaptiveMode);
  starfield.setVisible(true);
  if (hudEl) hudEl.style.display = '';
  if (titleEl) titleEl.style.display = '';
  gui.show();

  // Restaurer l'état des overlays tel qu'il était avant l'entrée workshop
  if (wsGraticuleWasVisible) graticule.setVisible(true);
  if (wsFormationsWasVisible) formations.setVisible(true);

  console.log('Exited workshop mode');
}

// --- Render loop ---
function animate(time: number) {
  requestAnimationFrame(animate);

  if (workshopMode) {
    // Workshop render loop
    workshopScene?.render();
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
