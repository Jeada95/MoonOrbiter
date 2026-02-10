import GUI from 'lil-gui';
import { Lighting } from '../core/Lighting';
import { Globe } from '../moon/Globe';
import {
  MIN_VERTICAL_EXAGGERATION,
  MAX_VERTICAL_EXAGGERATION,
  DEFAULT_VERTICAL_EXAGGERATION,
  GRID_RESOLUTIONS,
} from '../utils/config';
import type { GridResolution } from '../adaptive/LocalGridLoader';

/** Labels for each resolution level */
const RES_LABELS: Record<number, string> = {
  513: '1 — Low (~889 m/px)',
  1025: '2 — Medium (~444 m/px)',
  2049: '3 — High (~222 m/px)',
};

export interface MultiTileCallbacks {
  onToggleAdaptive: (enabled: boolean) => void;
  onMaxErrorChange: (maxError: number) => void;
  onExaggerationChange: (v: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onResolutionChange: (resolution: GridResolution) => void;
  onToggleGraticule: (enabled: boolean) => void;
  onToggleFormations: (enabled: boolean) => void;
  onFormationsCountChange: (count: number) => void;
  onToggleWiki: (enabled: boolean) => void;
  getStats: () => { tiles: number; triangles: number };
}

export class GuiControls {
  private gui: GUI;
  private statsDisplay: any = null;

  constructor(lighting: Lighting, globe: Globe, multiTile?: MultiTileCallbacks) {
    this.gui = new GUI({ title: 'MoonOrbiter' });

    // --- Sun ---
    const sunParams = {
      sunAngle: lighting.getSunAngleDegrees(),
      sunIntensity: lighting.sunLight.intensity,
    };

    const sunFolder = this.gui.addFolder('Sun');
    sunFolder
      .add(sunParams, 'sunAngle', 0, 360, 1)
      .name('Angle')
      .onChange((v: number) => lighting.setSunAngle(v));
    sunFolder
      .add(sunParams, 'sunIntensity', 0, 5, 0.1)
      .name('Intensity')
      .onChange((v: number) => { lighting.sunLight.intensity = v; });
    sunFolder.open();

    // --- Toggle Photo / Adaptive (two interlocked checkboxes on the same line) ---
    if (multiTile) {
      const modeParams = { photo: true, adaptive: false };

      const photoCtrl = this.gui
        .add(modeParams, 'photo')
        .name('Photo')
        .onChange((v: boolean) => {
          if (!v) {
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
        .name('Adaptive')
        .onChange((v: boolean) => {
          if (!v) {
            modeParams.photo = true;
            photoCtrl.updateDisplay();
          } else {
            modeParams.photo = false;
            photoCtrl.updateDisplay();
          }
          applyMode();
        });

      // Place both checkboxes on the same line via CSS
      const photoEl = photoCtrl.domElement.closest('.controller') as HTMLElement;
      const adaptiveEl = adaptiveCtrl.domElement.closest('.controller') as HTMLElement;
      if (photoEl && adaptiveEl) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.width = '100%';
        wrapper.style.gap = '0';
        photoEl.style.flex = '1';
        photoEl.style.borderBottom = 'none';
        photoEl.style.paddingRight = '0';
        adaptiveEl.style.flex = '1';
        adaptiveEl.style.paddingLeft = '0';
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

      // --- Lat/lon grid checkbox ---
      const overlayParams = { grille: false };
      this.gui
        .add(overlayParams, 'grille')
        .name('Lat/lon grid')
        .onChange((v: boolean) => multiTile.onToggleGraticule(v));

      // --- Formations checkbox + sub-controls ---
      const formationsParams = { formations: false, count: 10, wiki: false };

      this.gui
        .add(formationsParams, 'formations')
        .name('Formations')
        .onChange((v: boolean) => {
          multiTile.onToggleFormations(v);
          if (v) {
            countCtrl.show();
            wikiCtrl.show();
          } else {
            countCtrl.hide();
            wikiCtrl.hide();
          }
        });

      const countCtrl = this.gui
        .add(formationsParams, 'count', 1, 50, 1)
        .name('Top features')
        .onChange((v: number) => multiTile.onFormationsCountChange(v));
      countCtrl.hide();

      const wikiCtrl = this.gui
        .add(formationsParams, 'wiki')
        .name('Wiki links')
        .onChange((v: boolean) => multiTile.onToggleWiki(v));
      wikiCtrl.hide();
    }

    // --- Photo folder ---
    const photoParams = {
      normalIntensity: globe.getNormalScale(),
    };

    const photoFolder = this.gui.addFolder('Photo');
    photoFolder
      .add(photoParams, 'normalIntensity', 0, 5, 0.1)
      .name('Relief (normals)')
      .onChange((v: number) => globe.setNormalScale(v));
    photoFolder.open();

    // --- Adaptive folder ---
    let adaptiveFolder: GUI | null = null;

    if (multiTile) {
      const adaptiveParams = {
        resolutionLevel: 1,
        exaggeration: DEFAULT_VERTICAL_EXAGGERATION,
        wireframe: false,
        stats: '0 tiles | 0 △',
      };

      adaptiveFolder = this.gui.addFolder('Adaptive');

      adaptiveFolder
        .add(adaptiveParams, 'resolutionLevel', 1, GRID_RESOLUTIONS.length, 1)
        .name('Resolution')
        .onChange((v: number) => {
          const res = GRID_RESOLUTIONS[v - 1] as GridResolution;
          multiTile.onResolutionChange(res);
          resLabelCtrl.setValue(RES_LABELS[res] || String(res));
        });

      const resLabelObj = { label: RES_LABELS[GRID_RESOLUTIONS[0]] };
      const resLabelCtrl = adaptiveFolder
        .add(resLabelObj, 'label')
        .name('Detail')
        .disable();

      adaptiveFolder
        .add(adaptiveParams, 'exaggeration', MIN_VERTICAL_EXAGGERATION, MAX_VERTICAL_EXAGGERATION, 0.5)
        .name('Exaggeration (x)')
        .onChange((v: number) => multiTile.onExaggerationChange(v));
      adaptiveFolder
        .add(adaptiveParams, 'wireframe')
        .name('Wireframe')
        .onChange((v: boolean) => multiTile.onWireframeChange(v));

      this.statsDisplay = adaptiveFolder
        .add(adaptiveParams, 'stats')
        .name('Stats')
        .disable();

      // Hidden by default (start in Photo mode)
      adaptiveFolder.hide();

      // Stats refresh
      setInterval(() => {
        const stats = multiTile.getStats();
        adaptiveParams.stats = `${stats.tiles} tiles | ${(stats.triangles / 1000).toFixed(0)}K △`;
        this.statsDisplay?.updateDisplay();
      }, 500);
    }
  }

  dispose() {
    this.gui.destroy();
  }
}
