/**
 * Workshop mode lil-gui panel.
 *
 * Controls: zone size (directional pad), exaggeration, light azimuth/elevation,
 * wireframe, Export STL, Back to Globe.
 */

import GUI from 'lil-gui';

export type ExpandDirection = 'north' | 'south' | 'east' | 'west';

export interface WorkshopCallbacks {
  onZoneExpand: (direction: ExpandDirection, stepKm: number) => void;
  onExaggerationChange: (exag: number) => void;
  onBaseThicknessChange: (km: number) => void;
  onLightAzimuthChange: (deg: number) => void;
  onLightElevationChange: (deg: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onExportSTL: () => void;
  onBack: () => void;
}

export class WorkshopGui {
  private gui: GUI;
  private sizeLabel: HTMLSpanElement | null = null;

  constructor(
    featureName: string,
    initialNS_km: number,
    initialEW_km: number,
    callbacks: WorkshopCallbacks,
  ) {
    this.gui = new GUI({ title: `Workshop: ${featureName}` });

    // --- Zone size (directional pad) ---
    this.buildZonePad(initialNS_km, initialEW_km, callbacks);

    const params = {
      exaggeration: 5,
      baseThickness: 0.5,
      azimuth: 45,
      elevation: 30,
      wireframe: false,
      exportSTL: () => callbacks.onExportSTL(),
      back: () => callbacks.onBack(),
    };

    this.gui
      .add(params, 'exaggeration', 1, 20, 0.5)
      .name('Exaggeration (x)')
      .onChange((v: number) => callbacks.onExaggerationChange(v));

    this.gui
      .add(params, 'baseThickness', 0.5, 20, 0.5)
      .name('Base')
      .onChange((v: number) => callbacks.onBaseThicknessChange(v));

    // Light folder
    const lightFolder = this.gui.addFolder('Light');
    lightFolder
      .add(params, 'azimuth', 0, 360, 1)
      .name('Azimuth')
      .onChange((v: number) => callbacks.onLightAzimuthChange(v));
    lightFolder
      .add(params, 'elevation', 5, 90, 1)
      .name('Elevation')
      .onChange((v: number) => callbacks.onLightElevationChange(v));
    lightFolder.open();

    this.gui
      .add(params, 'wireframe')
      .name('Wireframe')
      .onChange((v: boolean) => callbacks.onWireframeChange(v));

    // Buttons
    this.gui.add(params, 'exportSTL').name('Export STL');
    this.gui.add(params, 'back').name('← Back to Globe');
  }

  /** Update the displayed zone size */
  updateZoneSize(nsKm: number, ewKm: number): void {
    if (this.sizeLabel) {
      this.sizeLabel.textContent = `${Math.round(nsKm)}×${Math.round(ewKm)}`;
    }
  }

  /**
   * Build the directional pad widget and inject into the GUI.
   *
   * Layout (5 columns × 5 rows):
   *            ▲           ← expand north
   *            ▼           ← shrink north
   *  ◀  ▶  NS×EW  ◀  ▶   ← W(+/-) | size | E(-/+)
   *            ▲           ← shrink south
   *            ▼           ← expand south
   */
  private buildZonePad(nsKm: number, ewKm: number, callbacks: WorkshopCallbacks): void {
    const STEP_KM = 10;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:6px 8px;';

    // Title
    const title = document.createElement('div');
    title.textContent = 'Zone (km)';
    title.style.cssText =
      'color:#b8b8b8;font:11px "Segoe UI",sans-serif;margin-bottom:4px;';
    wrapper.appendChild(title);

    // 5 col × 5 row grid
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

    // North: expand (▲) row 1, shrink (▼) row 2  — both at col 3 (center)
    pad.appendChild(makeBtn('▲', 3, 1, 'north', +STEP_KM));
    pad.appendChild(makeBtn('▼', 3, 2, 'north', -STEP_KM));

    // West: expand ◀ (col 1), shrink ▶ (col 2) — row 3
    pad.appendChild(makeBtn('◀', 1, 3, 'west', +STEP_KM));
    pad.appendChild(makeBtn('▶', 2, 3, 'west', -STEP_KM));

    // Center size label — col 3, row 3
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = `${Math.round(nsKm)}×${Math.round(ewKm)}`;
    sizeLabel.style.cssText =
      'grid-column:3;grid-row:3;color:#fff;font:bold 12px "Segoe UI",sans-serif;' +
      'text-align:center;white-space:nowrap;user-select:none;';
    this.sizeLabel = sizeLabel;
    pad.appendChild(sizeLabel);

    // East: shrink ◀ (col 4), expand ▶ (col 5) — row 3
    pad.appendChild(makeBtn('◀', 4, 3, 'east', -STEP_KM));
    pad.appendChild(makeBtn('▶', 5, 3, 'east', +STEP_KM));

    // South: shrink (▲) row 4, expand (▼) row 5 — both at col 3
    pad.appendChild(makeBtn('▲', 3, 4, 'south', -STEP_KM));
    pad.appendChild(makeBtn('▼', 3, 5, 'south', +STEP_KM));

    wrapper.appendChild(pad);

    // Insert into the GUI children
    const guiChildren = this.gui.domElement.querySelector('.children') as HTMLElement;
    if (guiChildren) guiChildren.insertBefore(wrapper, guiChildren.firstChild);
  }

  hide(): void {
    this.gui.domElement.style.display = 'none';
  }

  show(): void {
    this.gui.domElement.style.display = '';
  }

  dispose(): void {
    this.gui.destroy();
  }
}
