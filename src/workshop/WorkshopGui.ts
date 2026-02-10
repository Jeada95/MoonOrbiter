/**
 * Workshop mode lil-gui panel.
 *
 * Controls: margin, exaggeration, light azimuth/elevation,
 * wireframe, Export STL, Back to Globe.
 */

import GUI from 'lil-gui';

export interface WorkshopCallbacks {
  onMarginChange: (factor: number) => void;
  onExaggerationChange: (exag: number) => void;
  onLightAzimuthChange: (deg: number) => void;
  onLightElevationChange: (deg: number) => void;
  onWireframeChange: (enabled: boolean) => void;
  onExportSTL: () => void;
  onBack: () => void;
}

export class WorkshopGui {
  private gui: GUI;

  constructor(featureName: string, callbacks: WorkshopCallbacks) {
    this.gui = new GUI({ title: `Workshop: ${featureName}` });

    const params = {
      margin: 1.5,
      exaggeration: 5,
      azimuth: 45,
      elevation: 30,
      wireframe: false,
      exportSTL: () => callbacks.onExportSTL(),
      back: () => callbacks.onBack(),
    };

    this.gui
      .add(params, 'margin', 1.0, 3.0, 0.1)
      .name('Margin')
      .onChange((v: number) => callbacks.onMarginChange(v));

    this.gui
      .add(params, 'exaggeration', 1, 20, 0.5)
      .name('Exaggeration (x)')
      .onChange((v: number) => callbacks.onExaggerationChange(v));

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
