import GUI from 'lil-gui';
import { Lighting } from '../core/Lighting';
import { Globe } from '../moon/Globe';
import {
  MIN_VERTICAL_EXAGGERATION,
  MAX_VERTICAL_EXAGGERATION,
  DEFAULT_VERTICAL_EXAGGERATION,
  DEFAULT_MAX_ERROR,
  GRID_RESOLUTIONS,
} from '../utils/config';
import type { GridResolution } from '../adaptive/LocalGridLoader';

/** Labels affichés pour chaque résolution */
const RES_LABELS: Record<number, string> = {
  513: '1 — Basse (~889 m/px)',
  1025: '2 — Moyenne (~444 m/px)',
  2049: '3 — Haute (~222 m/px)',
};

export interface MultiTileCallbacks {
  onToggleAdaptive: (enabled: boolean) => void;
  onMaxErrorChange: (maxError: number) => void;
  onExaggerationChange: (v: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onResolutionChange: (resolution: GridResolution) => void;
  getStats: () => { tiles: number; triangles: number };
}

export class GuiControls {
  private gui: GUI;
  private statsDisplay: any = null;

  constructor(lighting: Lighting, globe: Globe, multiTile?: MultiTileCallbacks) {
    this.gui = new GUI({ title: 'MoonOrbiter' });

    // --- Soleil ---
    const params = {
      sunAngle: lighting.getSunAngleDegrees(),
      sunIntensity: lighting.sunLight.intensity,
      ambientIntensity: lighting.ambientLight.intensity,
    };

    const sunFolder = this.gui.addFolder('Soleil');
    sunFolder
      .add(params, 'sunAngle', 0, 360, 1)
      .name('Angle')
      .onChange((v: number) => lighting.setSunAngle(v));
    sunFolder
      .add(params, 'sunIntensity', 0, 5, 0.1)
      .name('Intensité')
      .onChange((v: number) => { lighting.sunLight.intensity = v; });
    sunFolder
      .add(params, 'ambientIntensity', 0, 1, 0.01)
      .name('Lumière ambiante')
      .onChange((v: number) => { lighting.ambientLight.intensity = v; });
    sunFolder.open();

    // --- Terrain ---
    const terrainParams = {
      normalIntensity: globe.getNormalScale(),
      wireframe: globe.getWireframe(),
    };

    const terrainFolder = this.gui.addFolder('Terrain (photo)');
    terrainFolder
      .add(terrainParams, 'normalIntensity', 0, 5, 0.1)
      .name('Relief (normales)')
      .onChange((v: number) => globe.setNormalScale(v));
    terrainFolder
      .add(terrainParams, 'wireframe')
      .name('Maillage (fil de fer)')
      .onChange((v: boolean) => globe.setWireframe(v));
    terrainFolder.open();

    // --- Maillage adaptatif multi-tuiles ---
    if (multiTile) {
      const adaptiveParams = {
        enabled: false,
        // Slider discret 1..3 mappé sur les résolutions
        resolutionLevel: 1,
        exaggeration: DEFAULT_VERTICAL_EXAGGERATION,
        maxError: DEFAULT_MAX_ERROR,
        wireframe: false,
        stats: '0 tuiles | 0 △',
      };

      const adaptiveFolder = this.gui.addFolder('Maillage adaptatif');
      adaptiveFolder
        .add(adaptiveParams, 'enabled')
        .name('Mode adaptatif')
        .onChange((v: boolean) => multiTile.onToggleAdaptive(v));

      // Slider 3 positions : 1 = basse, 2 = moyenne, 3 = haute
      adaptiveFolder
        .add(adaptiveParams, 'resolutionLevel', 1, GRID_RESOLUTIONS.length, 1)
        .name('Résolution')
        .onChange((v: number) => {
          const res = GRID_RESOLUTIONS[v - 1] as GridResolution;
          multiTile.onResolutionChange(res);
          resLabelCtrl.setValue(RES_LABELS[res] || String(res));
        });

      // Label de résolution (lecture seule, affiche le détail)
      const resLabelObj = { label: RES_LABELS[GRID_RESOLUTIONS[0]] };
      const resLabelCtrl = adaptiveFolder
        .add(resLabelObj, 'label')
        .name('Détail')
        .disable();

      adaptiveFolder
        .add(adaptiveParams, 'exaggeration', MIN_VERTICAL_EXAGGERATION, MAX_VERTICAL_EXAGGERATION, 0.5)
        .name('Exagération (x)')
        .onChange((v: number) => multiTile.onExaggerationChange(v));
      adaptiveFolder
        .add(adaptiveParams, 'maxError', 5, 500, 5)
        .name('Erreur max (m)')
        .onChange((v: number) => multiTile.onMaxErrorChange(v));
      adaptiveFolder
        .add(adaptiveParams, 'wireframe')
        .name('Wireframe')
        .onChange((v: boolean) => multiTile.onWireframeChange(v));

      this.statsDisplay = adaptiveFolder
        .add(adaptiveParams, 'stats')
        .name('Stats')
        .disable();

      adaptiveFolder.open();

      // Mettre à jour les stats périodiquement
      setInterval(() => {
        if (adaptiveParams.enabled) {
          const stats = multiTile.getStats();
          adaptiveParams.stats = `${stats.tiles} tuiles | ${(stats.triangles / 1000).toFixed(0)}K △`;
          this.statsDisplay?.updateDisplay();
        }
      }, 500);
    }
  }

  dispose() {
    this.gui.destroy();
  }
}
