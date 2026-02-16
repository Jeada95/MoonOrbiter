/**
 * Unified Workshop Hub GUI panel.
 *
 * Provides access to both workshop sub-modes from a single lil-gui panel:
 * - Feature Print: extract and print a specific lunar formation
 * - Full Moon Print: decompose the entire Moon into printable pieces
 *
 * Common controls (light, wireframe, back) are always visible.
 */

import GUI from 'lil-gui';
import {
  ALLOWED_PIECE_COUNTS,
  type PieceCount,
  decomposePieceCount,
  computeAllPieceBounds,
  pieceLabel,
} from './PieceDecomposer';

// ─── Types ───────────────────────────────────────────────────────

export type ExpandDirection = 'north' | 'south' | 'east' | 'west';

export interface WorkshopHubCallbacks {
  // Feature search
  onSearchFeature: (name: string) => void;
  onClearSearch: () => void;
  // Feature Print sub-mode
  onZoneExpand: (direction: ExpandDirection, stepKm: number) => void;
  onFeatureExaggerationChange: (exag: number) => void;
  onBaseThicknessChange: (km: number) => void;
  onExportFeatureSTL: () => void;
  // Full Moon Print sub-mode
  onEnterFullMoonPrint: () => void;
  onBuildFmp: () => void;
  onPieceCountChange: (n: PieceCount) => void;
  onDiameterChange: (mm: number) => void;
  onShellThicknessChange: (mm: number) => void;
  onFmpExaggerationChange: (exag: number) => void;
  onPreviewChange: (mode: 'assembly' | number) => void;
  onExportPiece: (index: number) => void;
  onExportAll: () => void;
  // Shared
  onLightAzimuthChange: (deg: number) => void;
  onLightElevationChange: (deg: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onBack: () => void;
}

export interface WorkshopHubInitial {
  // Feature Print
  featureExaggeration: number;
  baseThickness: number;
  // Full Moon Print
  fmpPieceCount: PieceCount;
  fmpDiameterMM: number;
  fmpShellThicknessMM: number;
  fmpExaggeration: number;
  // Shared
  azimuth: number;
  elevation: number;
}

// ─── Class ───────────────────────────────────────────────────────

export class WorkshopHubGui {
  private gui: GUI;
  private featureNames: string[] = [];
  private callbacks: WorkshopHubCallbacks;

  // Sub-mode folders
  private featureFolder: GUI;
  private fmpFolder: GUI;
  private lightFolder: GUI | null = null;

  // Feature Print widgets
  private sizeLabel: HTMLSpanElement | null = null;

  // FMP widgets
  private previewCtrl: ReturnType<GUI['add']> | null = null;
  private fmpParams: {
    pieceCount: number;
    fmpExaggeration: number;
    diameterMM: number;
    shellThicknessMM: number;
    preview: string;
  };

  // Search
  private searchToggle: HTMLDivElement | null = null;
  private searchClearBtn: HTMLSpanElement | null = null;
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(
    featureNames: string[],
    callbacks: WorkshopHubCallbacks,
    initial: WorkshopHubInitial,
  ) {
    this.featureNames = featureNames;
    this.callbacks = callbacks;
    this.gui = new GUI({ title: 'Workshop' });

    // ─── Search dropdown (top-level) ───────────────────────────
    this.buildSearchWidget();

    // ─── Full Moon Print button (top-level) ────────────────────
    const topParams = {
      fullMoonPrint: () => callbacks.onEnterFullMoonPrint(),
    };
    this.gui.add(topParams, 'fullMoonPrint').name('🌕 Full Moon 3D Print');

    // ─── Feature Print folder ──────────────────────────────────
    this.featureFolder = this.gui.addFolder('Feature Print');
    this.featureFolder.close();

    this.buildZonePad(0, 0, callbacks);

    const featureParams = {
      exaggeration: initial.featureExaggeration,
      baseThickness: initial.baseThickness,
      exportSTL: () => callbacks.onExportFeatureSTL(),
    };

    this.featureFolder
      .add(featureParams, 'exaggeration', 1, 20, 0.5)
      .name('Exaggeration (×)')
      .onChange((v: number) => callbacks.onFeatureExaggerationChange(v));

    this.featureFolder
      .add(featureParams, 'baseThickness', 0.5, 20, 0.5)
      .name('Base (km)')
      .onChange((v: number) => callbacks.onBaseThicknessChange(v));

    this.featureFolder.add(featureParams, 'exportSTL').name('Export STL');

    // ─── Full Moon Print folder ────────────────────────────────
    this.fmpFolder = this.gui.addFolder('Full Moon Print');
    this.fmpFolder.close();

    this.fmpParams = {
      pieceCount: initial.fmpPieceCount,
      fmpExaggeration: initial.fmpExaggeration,
      diameterMM: initial.fmpDiameterMM,
      shellThicknessMM: initial.fmpShellThicknessMM,
      preview: 'assembly',
    };

    // Piece count dropdown (initial value first)
    const pieceCountOptions: Record<string, number> = {};
    const initDecomp = decomposePieceCount(initial.fmpPieceCount);
    pieceCountOptions[`${initial.fmpPieceCount} (${initDecomp.bands}×${initDecomp.sectors})`] = initial.fmpPieceCount;
    for (const n of ALLOWED_PIECE_COUNTS) {
      if (n === initial.fmpPieceCount) continue;
      const d = decomposePieceCount(n);
      pieceCountOptions[`${n} (${d.bands}×${d.sectors})`] = n;
    }
    this.fmpFolder
      .add(this.fmpParams, 'pieceCount', pieceCountOptions)
      .name('Pieces')
      .onChange((v: number) => callbacks.onPieceCountChange(v as PieceCount));

    this.fmpFolder
      .add(this.fmpParams, 'diameterMM', 50, 500, 10)
      .name('Diameter (mm)')
      .onChange((v: number) => callbacks.onDiameterChange(v));

    this.fmpFolder
      .add(this.fmpParams, 'shellThicknessMM', 2, 20, 0.5)
      .name('Shell (mm)')
      .onChange((v: number) => callbacks.onShellThicknessChange(v));

    this.fmpFolder
      .add(this.fmpParams, 'fmpExaggeration', 1, 20, 0.5)
      .name('Exaggeration (×)')
      .onChange((v: number) => callbacks.onFmpExaggerationChange(v));

    // Build button — triggers piece generation with current settings
    const buildParams = { build: () => callbacks.onBuildFmp() };
    this.fmpFolder.add(buildParams, 'build').name('🔨 Build pieces');

    // Preview dropdown (initially just assembly)
    const previewOptions: Record<string, string> = { 'Assembly (exploded)': 'assembly' };
    this.previewCtrl = this.fmpFolder
      .add(this.fmpParams, 'preview', previewOptions)
      .name('Preview')
      .onChange((v: string) => {
        const mode = v === 'assembly' ? 'assembly' as const : parseInt(v);
        callbacks.onPreviewChange(mode);
      });

    const fmpExportParams = {
      exportPiece: () => {
        if (this.fmpParams.preview === 'assembly') return;
        callbacks.onExportPiece(parseInt(this.fmpParams.preview));
      },
      exportAll: () => callbacks.onExportAll(),
    };
    this.fmpFolder.add(fmpExportParams, 'exportPiece').name('Export piece STL');
    this.fmpFolder.add(fmpExportParams, 'exportAll').name('Export ALL STL');

    // ─── Shared controls ───────────────────────────────────────
    this.lightFolder = this.gui.addFolder('Light');
    const lightFolder = this.lightFolder;
    const sharedParams = {
      azimuth: initial.azimuth,
      elevation: initial.elevation,
      wireframe: false,
      back: () => callbacks.onBack(),
    };

    lightFolder
      .add(sharedParams, 'azimuth', 0, 360, 1)
      .name('Azimuth')
      .onChange((v: number) => callbacks.onLightAzimuthChange(v));
    lightFolder
      .add(sharedParams, 'elevation', 5, 90, 1)
      .name('Elevation')
      .onChange((v: number) => callbacks.onLightElevationChange(v));
    lightFolder.open();

    this.gui
      .add(sharedParams, 'wireframe')
      .name('Wireframe')
      .onChange((v: boolean) => callbacks.onWireframeChange(v));

    this.gui.add(sharedParams, 'back').name('← Back to Globe');
  }

  // ─── Search dropdown ──────────────────────────────────────────

  private buildSearchWidget(): void {
    const wrapper = document.createElement('div');
    wrapper.style.cssText =
      'position:relative;padding:0 8px 6px 8px;display:flex;align-items:center;';

    const label = document.createElement('span');
    label.textContent = 'Feature';
    label.style.cssText =
      'flex-shrink:0;width:40%;color:#b8b8b8;font:11px "Segoe UI",sans-serif;';

    const toggleWrap = document.createElement('div');
    toggleWrap.style.cssText = 'position:relative;flex:1;min-width:0;';

    const toggle = document.createElement('div');
    toggle.textContent = 'Select ▾';
    toggle.style.cssText =
      'width:100%;box-sizing:border-box;padding:4px 6px;padding-right:18px;' +
      'background:#1a1a2e;color:#999;border:1px solid #444;border-radius:3px;' +
      'font:11px "Segoe UI",sans-serif;cursor:pointer;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    this.searchToggle = toggle;

    const clearBtn = document.createElement('span');
    clearBtn.textContent = '×';
    clearBtn.style.cssText =
      'position:absolute;right:3px;top:3px;color:#888;cursor:pointer;' +
      'font:bold 13px sans-serif;line-height:1;display:none;z-index:1;';
    this.searchClearBtn = clearBtn;

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
          toggle.textContent = name + ' ▾';
          toggle.style.color = '#ddd';
          clearBtn.style.display = '';
          closePanel();
          this.callbacks.onSearchFeature(name);
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
      this.callbacks.onClearSearch();
    });

    searchInput.addEventListener('input', () => {
      buildItems(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel();
    });

    this.outsideClickHandler = (e: MouseEvent) => {
      if (isOpen && !toggleWrap.contains(e.target as Node)) closePanel();
    };
    document.addEventListener('mousedown', this.outsideClickHandler);

    // Insert into the GUI children
    const guiChildren = this.gui.domElement.querySelector('.children') as HTMLElement;
    if (guiChildren) guiChildren.insertBefore(wrapper, guiChildren.firstChild);
  }

  // ─── Directional pad (Feature Print) ──────────────────────────

  private buildZonePad(nsKm: number, ewKm: number, callbacks: WorkshopHubCallbacks): void {
    const STEP_KM = 10;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:6px 8px;';

    const title = document.createElement('div');
    title.textContent = 'Zone (km)';
    title.style.cssText =
      'color:#b8b8b8;font:11px "Segoe UI",sans-serif;margin-bottom:4px;';
    wrapper.appendChild(title);

    const pad = document.createElement('div');
    pad.style.cssText =
      'display:grid;' +
      'grid-template-columns:24px 24px 1fr 24px 24px;' +
      'grid-template-rows:24px 24px 26px 24px 24px;' +
      'gap:1px;justify-items:center;align-items:center;max-width:180px;margin:0 auto;';

    const btnStyle =
      'width:22px;height:22px;padding:0;background:#333;color:#ddd;border:1px solid #555;' +
      'border-radius:3px;font:12px sans-serif;cursor:pointer;line-height:22px;text-align:center;';

    const makeBtn = (text: string, col: number, row: number, dir: ExpandDirection, step: number): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.style.cssText = btnStyle + `grid-column:${col};grid-row:${row};`;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#555'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#333'; });
      btn.addEventListener('click', () => callbacks.onZoneExpand(dir, step));
      return btn;
    };

    pad.appendChild(makeBtn('▲', 3, 1, 'north', +STEP_KM));
    pad.appendChild(makeBtn('▼', 3, 2, 'north', -STEP_KM));
    pad.appendChild(makeBtn('◀', 1, 3, 'west', +STEP_KM));
    pad.appendChild(makeBtn('▶', 2, 3, 'west', -STEP_KM));

    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = `${Math.round(nsKm)}×${Math.round(ewKm)}`;
    sizeLabel.style.cssText =
      'grid-column:3;grid-row:3;color:#fff;font:bold 12px "Segoe UI",sans-serif;' +
      'text-align:center;white-space:nowrap;user-select:none;';
    this.sizeLabel = sizeLabel;
    pad.appendChild(sizeLabel);

    pad.appendChild(makeBtn('◀', 4, 3, 'east', -STEP_KM));
    pad.appendChild(makeBtn('▶', 5, 3, 'east', +STEP_KM));
    pad.appendChild(makeBtn('▲', 3, 4, 'south', -STEP_KM));
    pad.appendChild(makeBtn('▼', 3, 5, 'south', +STEP_KM));

    wrapper.appendChild(pad);

    // Insert into the Feature Print folder children
    const folderChildren = this.featureFolder.domElement.querySelector('.children') as HTMLElement;
    if (folderChildren) folderChildren.insertBefore(wrapper, folderChildren.firstChild);
  }

  // ─── Public methods ───────────────────────────────────────────

  /** Update the feature names list for the search dropdown */
  setFeatureNames(names: string[]): void {
    this.featureNames = names;
  }

  /** Programmatically select a feature (e.g. from formation context menu) */
  selectFeature(name: string): void {
    if (this.searchToggle) {
      this.searchToggle.textContent = name + ' ▾';
      this.searchToggle.style.color = '#ddd';
    }
    if (this.searchClearBtn) {
      this.searchClearBtn.style.display = '';
    }
    // Open Feature Print folder, close FMP folder
    this.featureFolder.open();
    this.fmpFolder.close();
    // Show Light folder (feature mode uses directional light)
    if (this.lightFolder) this.lightFolder.domElement.style.display = '';
  }

  /** Open the FMP folder (called when entering Full Moon Print sub-mode) */
  openFmpFolder(): void {
    this.fmpFolder.open();
    this.featureFolder.close();
    // Hide Light folder (FMP uses headlight — light follows camera)
    if (this.lightFolder) this.lightFolder.domElement.style.display = 'none';
  }

  /** Update the displayed zone size */
  updateZoneSize(nsKm: number, ewKm: number): void {
    if (this.sizeLabel) {
      this.sizeLabel.textContent = `${Math.round(nsKm)}×${Math.round(ewKm)}`;
    }
  }

  /** Rebuild the preview dropdown after piece count changes */
  updatePieceList(pieceCount: PieceCount): void {
    if (!this.previewCtrl) return;

    const decomp = decomposePieceCount(pieceCount);
    const pieces = computeAllPieceBounds(decomp.bands, decomp.sectors);

    const previewOptions: Record<string, string> = { 'Assembly (exploded)': 'assembly' };
    for (let i = 0; i < pieces.length; i++) {
      const label = `Piece ${i + 1}/${pieces.length}: ${pieceLabel(pieces[i], decomp.bands)}`;
      previewOptions[label] = String(i);
    }

    this.previewCtrl.options(previewOptions);
    this.previewCtrl.setValue('assembly');
  }

  dispose(): void {
    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler);
    }
    this.gui.destroy();
  }
}
