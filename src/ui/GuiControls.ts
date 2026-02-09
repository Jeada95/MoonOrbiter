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
    const sunParams = {
      sunAngle: lighting.getSunAngleDegrees(),
      sunIntensity: lighting.sunLight.intensity,
    };

    const sunFolder = this.gui.addFolder('Soleil');
    sunFolder
      .add(sunParams, 'sunAngle', 0, 360, 1)
      .name('Angle')
      .onChange((v: number) => lighting.setSunAngle(v));
    sunFolder
      .add(sunParams, 'sunIntensity', 0, 5, 0.1)
      .name('Intensité')
      .onChange((v: number) => { lighting.sunLight.intensity = v; });
    sunFolder.open();

    // --- Toggle Photo / Adaptatif (deux checkboxes inter-verrouillées, même ligne) ---
    if (multiTile) {
      const modeParams = { photo: true, adaptive: false };

      const photoCtrl = this.gui
        .add(modeParams, 'photo')
        .name('Photo')
        .onChange((v: boolean) => {
          if (!v) {
            // On ne peut pas tout décocher — forcer adaptatif
            modeParams.adaptive = true;
            adaptiveCtrl.updateDisplay();
          } else {
            modeParams.adaptive = false;
            adaptiveCtrl.updateDisplay();
          }
          applyMode();
        });

      const adaptiveCtrl = this.gui
        .add(modeParams, 'adaptive')
        .name('Adaptatif')
        .onChange((v: boolean) => {
          if (!v) {
            // On ne peut pas tout décocher — forcer photo
            modeParams.photo = true;
            photoCtrl.updateDisplay();
          } else {
            modeParams.photo = false;
            photoCtrl.updateDisplay();
          }
          applyMode();
        });

      // Mettre les deux checkboxes sur la même ligne via CSS
      const photoEl = photoCtrl.domElement.closest('.controller') as HTMLElement;
      const adaptiveEl = adaptiveCtrl.domElement.closest('.controller') as HTMLElement;
      if (photoEl && adaptiveEl) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.width = '100%';
        photoEl.style.flex = '1';
        photoEl.style.borderBottom = 'none';
        adaptiveEl.style.flex = '1';
        photoEl.parentElement?.insertBefore(wrapper, photoEl);
        wrapper.appendChild(photoEl);
        wrapper.appendChild(adaptiveEl);
      }

      const applyMode = () => {
        const isAdaptive = modeParams.adaptive;
        multiTile.onToggleAdaptive(isAdaptive);
        if (isAdaptive) {
          photoFolder.hide();
          adaptiveFolder?.show();
          adaptiveFolder?.open();
        } else {
          adaptiveFolder?.hide();
          photoFolder.show();
          photoFolder.open();
        }
      };
    }

    // --- Folder Photo ---
    const photoParams = {
      normalIntensity: globe.getNormalScale(),
    };

    const photoFolder = this.gui.addFolder('Photo');
    photoFolder
      .add(photoParams, 'normalIntensity', 0, 5, 0.1)
      .name('Relief (normales)')
      .onChange((v: number) => globe.setNormalScale(v));
    photoFolder.open();

    // --- Folder Adaptatif ---
    let adaptiveFolder: GUI | null = null;

    if (multiTile) {
      const adaptiveParams = {
        resolutionLevel: 1,
        exaggeration: DEFAULT_VERTICAL_EXAGGERATION,
        maxError: DEFAULT_MAX_ERROR,
        wireframe: false,
        stats: '0 tuiles | 0 △',
      };

      adaptiveFolder = this.gui.addFolder('Adaptatif');

      adaptiveFolder
        .add(adaptiveParams, 'resolutionLevel', 1, GRID_RESOLUTIONS.length, 1)
        .name('Résolution')
        .onChange((v: number) => {
          const res = GRID_RESOLUTIONS[v - 1] as GridResolution;
          multiTile.onResolutionChange(res);
          resLabelCtrl.setValue(RES_LABELS[res] || String(res));
        });

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

      // Caché par défaut (on démarre en mode photo)
      adaptiveFolder.hide();

      // Stats refresh
      setInterval(() => {
        const stats = multiTile.getStats();
        adaptiveParams.stats = `${stats.tiles} tuiles | ${(stats.triangles / 1000).toFixed(0)}K △`;
        this.statsDisplay?.updateDisplay();
      }, 500);
    }
  }

  dispose() {
    this.gui.destroy();
  }
}
