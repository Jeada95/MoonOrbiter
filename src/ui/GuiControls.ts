import GUI from 'lil-gui';
import { Lighting } from '../core/Lighting';
import { Globe } from '../moon/Globe';
import {
  MIN_VERTICAL_EXAGGERATION,
  MAX_VERTICAL_EXAGGERATION,
  GRID_RESOLUTIONS,
} from '../utils/config';
import type { GridResolution } from '../adaptive/LocalGridLoader';
import { type UserPreferences, savePreferences } from '../utils/preferences';

/** Labels for each resolution level */
const RES_LABELS: Record<number, string> = {
  513: 'Low (~889 m/px)',
  1025: 'Medium (~444 m/px)',
  2049: 'High (~222 m/px)',
};

export interface MultiTileCallbacks {
  onToggleAdaptive: (enabled: boolean) => void;
  onMaxErrorChange: (maxError: number) => void;
  onExaggerationChange: (v: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onResolutionChange: (resolution: GridResolution) => void;
  onToggleGraticule: (enabled: boolean) => void;
  onToggleFormations: (enabled: boolean) => void;
  onMariaCountChange: (count: number) => void;
  onCratersCountChange: (count: number) => void;
  onOtherCountChange: (count: number) => void;
  onToggleWiki: (enabled: boolean) => void;
  onSearchFeature: (name: string) => void;
  onClearSearch: () => void;
  onDateTimeChange: (date: Date) => void;
  onNowPressed: (date: Date) => void;
  getStats: () => { tiles: number; triangles: number };
}

export class GuiControls {
  private gui: GUI;
  private statsDisplay: any = null;
  private featureNames: string[] = [];
  private searchWrapper: HTMLDivElement | null = null;
  private statsInterval = 0;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private fullscreenChangeHandler: (() => void) | null = null;

  constructor(lighting: Lighting, globe: Globe, multiTile: MultiTileCallbacks, prefs: UserPreferences) {
    this.gui = new GUI({ title: 'MoonOrbiter' });

    // --- Datetime picker (top-level, always visible) ---
    this.buildDateTimeWidget(this.gui, multiTile);

    // --- Sun intensity (top-level, no folder) ---
    const sunParams = {
      sunIntensity: prefs.sunIntensity,
    };
    lighting.sunLight.intensity = prefs.sunIntensity;

    this.gui
      .add(sunParams, 'sunIntensity', 0, 5, 0.1)
      .name('Sun intensity')
      .onChange((v: number) => { lighting.sunLight.intensity = v; savePreferences({ sunIntensity: v }); });

    // --- Mode folder (Photo / Adaptive grouped together) ---
    const modeFolder = this.gui.addFolder('Mode');

    const isAdaptiveInit = prefs.mode === 'adaptive';
    const modeParams = { photo: !isAdaptiveInit, adaptive: isAdaptiveInit };

    const photoCtrl = modeFolder
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

    const adaptiveCtrl = modeFolder
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
      const modeWrapper = document.createElement('div');
      modeWrapper.style.display = 'flex';
      modeWrapper.style.width = '100%';
      modeWrapper.style.gap = '0';
      photoEl.style.flex = '1';
      photoEl.style.borderBottom = 'none';
      photoEl.style.paddingRight = '0';
      adaptiveEl.style.flex = '1';
      adaptiveEl.style.paddingLeft = '0';
      photoEl.parentElement?.insertBefore(modeWrapper, photoEl);
      modeWrapper.appendChild(photoEl);
      modeWrapper.appendChild(adaptiveEl);
    }

    // --- Photo sub-folder (inside Mode) ---
    const photoParams = {
      normalIntensity: prefs.normalIntensity,
    };

    const photoFolder = modeFolder.addFolder('Photo');
    photoFolder
      .add(photoParams, 'normalIntensity', 0, 10, 0.1)
      .name('Relief (normals)')
      .onChange((v: number) => { globe.setNormalScale(v); savePreferences({ normalIntensity: v }); });
    photoFolder.open();

    // --- Adaptive sub-folder (inside Mode) ---
    const adaptiveParams = {
      resolutionLevel: prefs.adaptiveResolution,
      exaggeration: prefs.adaptiveExaggeration,
      wireframe: false,
      stats: '0 tiles | 0 △',
    };

    const adaptiveFolder = modeFolder.addFolder('Adaptive');

    adaptiveFolder
      .add(adaptiveParams, 'resolutionLevel', 1, GRID_RESOLUTIONS.length, 1)
      .name('Resolution')
      .onChange((v: number) => {
        const res = GRID_RESOLUTIONS[v - 1] as GridResolution;
        multiTile.onResolutionChange(res);
        resLabelCtrl.setValue(RES_LABELS[res] || String(res));
        savePreferences({ adaptiveResolution: v });
      });

    const initRes = GRID_RESOLUTIONS[prefs.adaptiveResolution - 1] ?? GRID_RESOLUTIONS[0];
    const resLabelObj = { label: RES_LABELS[initRes] || String(initRes) };
    const resLabelCtrl = adaptiveFolder
      .add(resLabelObj, 'label')
      .name('Detail')
      .disable();

    adaptiveFolder
      .add(adaptiveParams, 'exaggeration', MIN_VERTICAL_EXAGGERATION, MAX_VERTICAL_EXAGGERATION, 0.5)
      .name('Exaggeration (x)')
      .onChange((v: number) => { multiTile.onExaggerationChange(v); savePreferences({ adaptiveExaggeration: v }); });
    adaptiveFolder
      .add(adaptiveParams, 'wireframe')
      .name('Wireframe')
      .onChange((v: boolean) => multiTile.onWireframeChange(v));

    this.statsDisplay = adaptiveFolder
      .add(adaptiveParams, 'stats')
      .name('Stats')
      .disable();

    const applyMode = () => {
      const isAdaptive = modeParams.adaptive;
      multiTile.onToggleAdaptive(isAdaptive);
      savePreferences({ mode: isAdaptive ? 'adaptive' : 'photo' });
      if (isAdaptive) {
        photoFolder.hide();
        adaptiveFolder.show();
        adaptiveFolder.open();
      } else {
        adaptiveFolder.hide();
        photoFolder.show();
        photoFolder.open();
      }
    };

    // Apply initial mode visibility
    if (isAdaptiveInit) {
      photoFolder.hide();
      adaptiveFolder.show();
      adaptiveFolder.open();
    } else {
      adaptiveFolder.hide();
    }

    modeFolder.open();

    // --- Lat/lon grid checkbox ---
    const overlayParams = { grille: prefs.graticule };
    this.gui
      .add(overlayParams, 'grille')
      .name('Lat/lon grid')
      .onChange((v: boolean) => { multiTile.onToggleGraticule(v); savePreferences({ graticule: v }); });

    // --- Formations folder ---
    const formationsFolder = this.gui.addFolder('Formations');

    const formationsParams = {
      formations: prefs.formations,
      wiki: prefs.wiki,
      maria: prefs.mariaCount,
      craters: prefs.cratersCount,
      other: prefs.otherCount,
    };

    const subCtrls: ReturnType<GUI['add']>[] = [];

    formationsFolder
      .add(formationsParams, 'formations')
      .name('Formations')
      .onChange((v: boolean) => {
        multiTile.onToggleFormations(v);
        savePreferences({ formations: v });
        for (const ctrl of subCtrls) v ? ctrl.show() : ctrl.hide();
        if (this.searchWrapper) this.searchWrapper.style.display = v ? '' : 'none';
      });

    // Reactive names — right below Formations toggle
    const wikiCtrl = formationsFolder
      .add(formationsParams, 'wiki')
      .name('Reactive names')
      .onChange((v: boolean) => { multiTile.onToggleWiki(v); savePreferences({ wiki: v }); });
    if (!prefs.formations) wikiCtrl.hide();
    subCtrls.push(wikiCtrl);

    const mariaCtrl = formationsFolder
      .add(formationsParams, 'maria', 1, 20, 1)
      .name('Maria')
      .onChange((v: number) => { multiTile.onMariaCountChange(v); savePreferences({ mariaCount: v }); });
    if (!prefs.formations) mariaCtrl.hide();
    subCtrls.push(mariaCtrl);

    const cratersCtrl = formationsFolder
      .add(formationsParams, 'craters', 1, 50, 1)
      .name('Craters')
      .onChange((v: number) => { multiTile.onCratersCountChange(v); savePreferences({ cratersCount: v }); });
    if (!prefs.formations) cratersCtrl.hide();
    subCtrls.push(cratersCtrl);

    const otherCtrl = formationsFolder
      .add(formationsParams, 'other', 1, 50, 1)
      .name('Other')
      .onChange((v: number) => { multiTile.onOtherCountChange(v); savePreferences({ otherCount: v }); });
    if (!prefs.formations) otherCtrl.hide();
    subCtrls.push(otherCtrl);

    // --- Search dropdown (custom DOM widget, inside formations folder) ---
    this.searchWrapper = this.buildSearchWidget(multiTile);
    const folderChildren = formationsFolder.domElement.querySelector('.children') as HTMLElement;
    if (folderChildren) folderChildren.appendChild(this.searchWrapper);
    this.searchWrapper.style.display = prefs.formations ? '' : 'none';

    formationsFolder.open();

    // Fire initial state so main.ts sets up correctly
    if (isAdaptiveInit) multiTile.onToggleAdaptive(true);
    if (prefs.graticule) multiTile.onToggleGraticule(true);
    // Toujours appliquer les counts sauvegardés (même si formations désactivées)
    multiTile.onMariaCountChange(prefs.mariaCount);
    multiTile.onCratersCountChange(prefs.cratersCount);
    multiTile.onOtherCountChange(prefs.otherCount);
    if (prefs.formations) {
      multiTile.onToggleFormations(true);
      if (prefs.wiki) multiTile.onToggleWiki(true);
    }
    if (prefs.adaptiveResolution > 1) {
      const res = GRID_RESOLUTIONS[prefs.adaptiveResolution - 1] as GridResolution;
      multiTile.onResolutionChange(res);
    }
    if (prefs.adaptiveExaggeration !== 1.0) {
      multiTile.onExaggerationChange(prefs.adaptiveExaggeration);
    }

    // Stats refresh
    this.statsInterval = window.setInterval(() => {
      const stats = multiTile.getStats();
      adaptiveParams.stats = `${stats.tiles} tiles | ${(stats.triangles / 1000).toFixed(0)}K △`;
      this.statsDisplay?.updateDisplay();
    }, 500);

    // ─── Workshop button ──────────────────────────────────────────
    const wsParams = {
      workshop: () => {
        const fn = (window as any).__enterWorkshopHub;
        if (fn) fn();
      },
    };
    this.gui.add(wsParams, 'workshop').name('🔧 Workshop');

    // ─── Fly Mode button ─────────────────────────────────────────
    const flyParams = {
      flyMode: () => {
        const fn = (window as any).__startFlyMode;
        if (fn) fn();
      },
    };
    this.gui.add(flyParams, 'flyMode').name('🛩 Fly Mode');

    // ─── Fullscreen button (dynamic label) ────────────────────────
    const updateFullscreenLabel = (isFs: boolean) => {
      fullscreenCtrl.name(isFs ? '⛶ Window mode' : '⛶ Fullscreen');
    };

    const electronApi = (window as any).moonOrbiterElectron;

    const fullscreenParams = {
      fullscreen: () => {
        if (electronApi?.toggleFullscreen) {
          electronApi.toggleFullscreen().then((isFs: boolean) => {
            updateFullscreenLabel(isFs);
          });
        } else if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen();
        }
      },
    };
    const fullscreenCtrl = this.gui.add(fullscreenParams, 'fullscreen').name('⛶ Fullscreen');

    // Web: listen for fullscreen changes to update label
    if (!electronApi?.toggleFullscreen) {
      this.fullscreenChangeHandler = () => {
        updateFullscreenLabel(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    }

    // ─── Quit button (Electron only) ──────────────────────────────
    if (electronApi?.quitApp) {
      const quitParams = { quit: () => electronApi.quitApp() };
      this.gui.add(quitParams, 'quit').name('✕ Quit');
    }
  }

  /** Called once features are loaded to populate the search dropdown */
  setFeatureNames(names: string[]): void {
    this.featureNames = names;
  }

  /** Build a datetime-local + "Now" button widget injected into a GUI container */
  private buildDateTimeWidget(container: GUI, multiTile: MultiTileCallbacks): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'padding:0 8px 4px 8px;display:flex;align-items:center;gap:4px;';

    const label = document.createElement('span');
    label.textContent = 'Date';
    label.style.cssText =
      'flex-shrink:0;width:40%;color:#b8b8b8;font:11px "Segoe UI",sans-serif;';

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'flex:1;display:flex;gap:3px;min-width:0;align-items:center;';

    const dtInput = document.createElement('input');
    dtInput.type = 'datetime-local';
    dtInput.step = '60'; // 1 minute precision
    // Init to current local time
    dtInput.value = this.toLocalDateTimeString(new Date());
    dtInput.style.cssText =
      'flex:1 1 auto;width:0;min-width:0;padding:3px 4px;background:#1a1a2e;color:#ddd;' +
      'border:1px solid #444;border-radius:3px;font:10px "Segoe UI",sans-serif;' +
      'outline:none;color-scheme:dark;';

    const nowBtn = document.createElement('button');
    nowBtn.textContent = '⟳';
    nowBtn.title = 'Reset to current time';
    nowBtn.style.cssText =
      'flex:0 0 auto;width:20px;height:20px;padding:0;background:#333;color:#ddd;' +
      'border:1px solid #555;border-radius:3px;font:13px sans-serif;cursor:pointer;' +
      'line-height:20px;text-align:center;';
    nowBtn.addEventListener('mouseenter', () => { nowBtn.style.background = '#444'; });
    nowBtn.addEventListener('mouseleave', () => { nowBtn.style.background = '#333'; });

    // 'input' fires immediately on every change (calendar click, hour spin, etc.)
    dtInput.addEventListener('input', () => {
      const date = new Date(dtInput.value);
      if (!isNaN(date.getTime())) {
        multiTile.onDateTimeChange(date);
      }
    });

    nowBtn.addEventListener('click', () => {
      const now = new Date();
      dtInput.value = this.toLocalDateTimeString(now);
      multiTile.onNowPressed(now);
    });

    inputWrap.appendChild(dtInput);
    inputWrap.appendChild(nowBtn);
    wrapper.appendChild(label);
    wrapper.appendChild(inputWrap);

    // Insert into the container's children
    const containerChildren = container.domElement.querySelector('.children') as HTMLElement;
    if (containerChildren) containerChildren.appendChild(wrapper);

    return wrapper;
  }

  /** Format a Date to "YYYY-MM-DDTHH:MM" for datetime-local input */
  private toLocalDateTimeString(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  }

  private buildSearchWidget(multiTile: MultiTileCallbacks): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:relative;padding:0 8px 6px 8px;display:flex;align-items:center;';

    const label = document.createElement('span');
    label.textContent = 'Search';
    label.style.cssText =
      'flex-shrink:0;width:40%;color:#b8b8b8;font:11px "Segoe UI",sans-serif;';

    // ─── Toggle button (looks like a select) ─────────────────
    const toggleWrap = document.createElement('div');
    toggleWrap.style.cssText = 'position:relative;flex:1;min-width:0;';

    const toggle = document.createElement('div');
    toggle.textContent = 'Select ▾';
    toggle.style.cssText =
      'width:100%;box-sizing:border-box;padding:4px 6px;padding-right:18px;' +
      'background:#1a1a2e;color:#999;border:1px solid #444;border-radius:3px;' +
      'font:11px "Segoe UI",sans-serif;cursor:pointer;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

    // ─── Clear button (×) ────────────────────────────────────
    const clearBtn = document.createElement('span');
    clearBtn.textContent = '×';
    clearBtn.style.cssText =
      'position:absolute;right:3px;top:3px;color:#888;cursor:pointer;' +
      'font:bold 13px sans-serif;line-height:1;display:none;z-index:1;';

    // ─── Dropdown panel (search input + scrollable list) ─────
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:absolute;left:0;right:0;top:100%;' +
      'background:#1a1a2e;border:1px solid #444;border-radius:0 0 3px 3px;' +
      'z-index:1000;display:none;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter...';
    searchInput.style.cssText =
      'width:100%;box-sizing:border-box;padding:4px 6px;' +
      'background:#111;color:#ddd;border:none;border-bottom:1px solid #444;' +
      'font:12px "Segoe UI",sans-serif;outline:none;';

    const listDiv = document.createElement('div');
    listDiv.style.cssText = 'max-height:400px;overflow-y:auto;';

    panel.appendChild(searchInput);
    panel.appendChild(listDiv);
    toggleWrap.appendChild(toggle);
    toggleWrap.appendChild(clearBtn);
    toggleWrap.appendChild(panel);
    wrapper.appendChild(label);
    wrapper.appendChild(toggleWrap);

    let isOpen = false;

    const MAX_VISIBLE_ITEMS = 80;

    const buildItems = (filter: string) => {
      listDiv.innerHTML = '';
      const lc = filter.toLowerCase();
      const matches = lc
        ? this.featureNames.filter(n => n.toLowerCase().includes(lc))
        : this.featureNames;

      const shown = matches.length > MAX_VISIBLE_ITEMS ? matches.slice(0, MAX_VISIBLE_ITEMS) : matches;

      for (const name of shown) {
        const item = document.createElement('div');
        item.textContent = name;
        item.style.cssText =
          'padding:3px 6px;cursor:pointer;color:#ddd;font:12px "Segoe UI",sans-serif;' +
          'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        item.addEventListener('mouseenter', () => { item.style.background = '#333'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          // Select this feature
          toggle.textContent = name + ' ▾';
          toggle.style.color = '#ddd';
          clearBtn.style.display = '';
          closePanel();
          multiTile.onSearchFeature(name);
        });
        listDiv.appendChild(item);
      }

      if (matches.length > MAX_VISIBLE_ITEMS) {
        const more = document.createElement('div');
        more.textContent = `… ${matches.length - MAX_VISIBLE_ITEMS} more — type to filter`;
        more.style.cssText =
          'padding:4px 6px;color:#888;font:italic 11px "Segoe UI",sans-serif;';
        listDiv.appendChild(more);
      }
    };

    const openPanel = () => {
      isOpen = true;
      panel.style.display = '';
      searchInput.value = '';
      buildItems('');
      searchInput.focus();
    };

    const closePanel = () => {
      isOpen = false;
      panel.style.display = 'none';
    };

    toggle.addEventListener('click', () => {
      if (isOpen) closePanel(); else openPanel();
    });

    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle.textContent = 'Select ▾';
      toggle.style.color = '#999';
      clearBtn.style.display = 'none';
      closePanel();
      multiTile.onClearSearch();
    });

    searchInput.addEventListener('input', () => {
      buildItems(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    // Close when clicking outside
    this.outsideClickHandler = (e: MouseEvent) => {
      if (isOpen && !toggleWrap.contains(e.target as Node)) closePanel();
    };
    document.addEventListener('mousedown', this.outsideClickHandler);

    return wrapper;
  }

  /** Hide the main GUI (when entering workshop mode) */
  hide(): void {
    this.gui.domElement.style.display = 'none';
  }

  /** Show the main GUI (when leaving workshop mode) */
  show(): void {
    this.gui.domElement.style.display = '';
  }

  dispose() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    if (this.outsideClickHandler) document.removeEventListener('mousedown', this.outsideClickHandler);
    if (this.fullscreenChangeHandler) document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    this.gui.destroy();
  }
}
