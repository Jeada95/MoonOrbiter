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
import { computeSunPosition, SunInfo } from './astro/SunPosition';
import { computeEarthViewPosition } from './astro/EarthView';
import { Starfield } from './scene/Starfield';

// --- Initialization ---
const moonScene = new MoonScene();
const lighting = new Lighting(moonScene.scene);

// --- Starfield background ---
const starfield = new Starfield(moonScene.scene);

// Globe with real LOLA-deformed mesh
const globe = new Globe();
globe.addToScene(moonScene.scene);


// --- Load data ---
const textureLoader = new THREE.TextureLoader();

// Shared LROC texture between Globe and TileManager
let lrocTexture: THREE.Texture | null = null;

// 1) LROC color texture
textureLoader.load(
  '/moon-data/moon_texture_4k.jpg',
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
      '/moon-data/moon_texture_2k.jpg',
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

// 2) Normal map
textureLoader.load(
  '/moon-data/moon_normal_16ppd.png',
  (normalTexture) => globe.setNormalMap(normalTexture, 1.5),
  undefined,
  () => {
    textureLoader.load(
      '/moon-data/moon_normal_4ppd.png',
      (normalTexture) => globe.setNormalMap(normalTexture, 1.5),
      undefined,
      () => {}
    );
  }
);

// 3) Elevation data — directly from NASA LDEM (Int16 LE, DN × 0.5 = meters)
globe.loadLDEM('/moon-data/raw/LDEM_64.IMG', 23040, 11520, 0.5)
  .then(() => console.log('LDEM 64ppd elevation applied'))
  .catch((err) => console.error('LDEM loading error:', err));

// --- Multi-resolution adaptive tiling ---
const tileManager = new MultiResTileManager(moonScene.scene);
let adaptiveMode = false;

// --- Lat/lon grid ---
const graticule = new GraticuleOverlay(moonScene.scene);

// --- Lunar formations ---
const formations = new FormationsOverlay();
formations.loadData('/moon-data/lunar_features.json')
  .then(() => {
    console.log('Lunar features loaded');
    gui.setFeatureNames(formations.getAllFeatureNames());
  })
  .catch((err) => console.warn('Failed to load lunar features:', err));

// --- Sun + Earth-view: astronomical positioning at startup ---
let sunMode: 'manual' | 'astronomical' = 'astronomical';
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
const hud = new HUD();
const gui = new GuiControls(lighting, globe, {
  onToggleAdaptive: (enabled: boolean) => {
    adaptiveMode = enabled;
    globe.setVisible(!enabled);
    tileManager.setVisible(enabled);
    hud.setResolutionInfo(enabled ? RES_HUD_INFO[currentAdaptiveRes] : 'LDEM 64ppd — Globe');
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
    formations.setWikiMode(enabled);
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
  onSunModeChange: (astronomical: boolean) => {
    sunMode = astronomical ? 'astronomical' : 'manual';
    if (astronomical) {
      applySunPosition(currentDateTime);
    } else {
      hud.clearSunInfo();
    }
    console.log(`Sun mode: ${sunMode}`);
  },
  onDateTimeChange: (date: Date) => {
    currentDateTime = date;
    if (sunMode === 'astronomical') {
      applySunPosition(date);
    }
  },
  onNowPressed: (date: Date) => {
    currentDateTime = date;
    if (sunMode === 'astronomical') {
      applySunPosition(date);
    }
    // Reset camera to Earth-view for current time
    const earthView = computeEarthViewPosition(date);
    moonScene.camera.position.copy(earthView.direction).multiplyScalar(SPHERE_RADIUS * 3.5);
    moonScene.controls.target.set(0, 0, 0);
  },
  onShadowsToggle: (enabled: boolean) => {
    if (enabled) {
      lighting.enableShadows(moonScene.renderer);
    } else {
      lighting.disableShadows(moonScene.renderer);
    }
    console.log(`Shadows: ${enabled ? 'ON' : 'OFF'}`);
  },
  getStats: () => ({
    tiles: tileManager.renderedTileCount,
    triangles: tileManager.totalTriangles,
  }),
});

// Set initial HUD sun info (after HUD is created)
hud.setSunInfo(initialSun.subSolarLat, initialSun.subSolarLon, currentDateTime);

// --- Render loop ---
function animate(time: number) {
  requestAnimationFrame(animate);

  // Adapt rotation/pan speed to zoom level
  const dist = moonScene.camera.position.length();
  const distRatio = (dist - moonScene.controls.minDistance)
                  / (moonScene.controls.maxDistance - moonScene.controls.minDistance);
  const speedFactor = 0.05 + 0.95 * Math.max(0, Math.min(1, distRatio));
  moonScene.controls.rotateSpeed = 0.4 * speedFactor;
  moonScene.controls.panSpeed = 0.4 * speedFactor;

  // HUD update (raycast for coordinates, scale bar, FPS)
  hud.update(moonScene.camera, moonScene.scene, time);

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
