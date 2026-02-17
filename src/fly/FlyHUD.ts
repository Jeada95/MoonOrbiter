/**
 * FlyHUD — affichage d'informations de vol en overlay.
 *
 * Affiche : vitesse, altitude, cap, coordonnées lat/lon.
 * Inclut un message d'aide au démarrage qui disparaît après quelques secondes.
 */

export class FlyHUD {
  private container: HTMLDivElement;
  private infoDiv: HTMLDivElement;
  private helpDiv: HTMLDivElement;
  private helpTimeout = 0;

  constructor() {
    this.container = document.createElement('div');
    this.container.style.cssText =
      'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);' +
      'z-index:9999;pointer-events:none;text-align:center;';

    // Help text (shown initially, fades out)
    this.helpDiv = document.createElement('div');
    this.helpDiv.style.cssText =
      'margin-bottom:10px;padding:10px 20px;' +
      'background:rgba(0,0,0,0.8);color:#fff;border-radius:8px;' +
      'font:14px "Segoe UI",sans-serif;line-height:1.6;' +
      'transition:opacity 1s ease;';
    this.helpDiv.innerHTML =
      '<b>Fly Mode</b><br>' +
      '🖱️ Left click = forward &nbsp;|&nbsp; Right click = backward<br>' +
      '🖱️ Move mouse = look around &nbsp;|&nbsp; Scroll = speed<br>' +
      '⎋ Escape = exit';

    // Flight info bar
    this.infoDiv = document.createElement('div');
    this.infoDiv.style.cssText =
      'display:inline-block;padding:6px 16px;' +
      'background:rgba(0,0,0,0.7);color:#0f0;border-radius:6px;' +
      'font:13px "Consolas","Courier New",monospace;' +
      'letter-spacing:0.5px;';

    this.container.appendChild(this.helpDiv);
    this.container.appendChild(this.infoDiv);
    document.body.appendChild(this.container);

    // Fade out help after 6 seconds
    this.helpTimeout = window.setTimeout(() => {
      this.helpDiv.style.opacity = '0';
      window.setTimeout(() => {
        this.helpDiv.style.display = 'none';
      }, 1000);
    }, 6000);
  }

  /** Update the flight info display */
  update(info: {
    latDeg: number;
    lonDeg: number;
    headingDeg: number;
    speedMult: number;
    altitudeKm: number;
  }): void {
    const lat = info.latDeg.toFixed(2);
    const lon = info.lonDeg.toFixed(2);
    const ns = info.latDeg >= 0 ? 'N' : 'S';
    const ew = info.lonDeg >= 0 ? 'E' : 'W';
    const heading = info.headingDeg.toFixed(0).padStart(3, '0');
    const speed = info.speedMult.toFixed(1);
    const alt = info.altitudeKm.toFixed(1);

    this.infoDiv.textContent =
      `HDG ${heading}°  |  ` +
      `${Math.abs(info.latDeg).toFixed(2)}°${ns}  ${Math.abs(info.lonDeg).toFixed(2)}°${ew}  |  ` +
      `ALT ${alt} km  |  ` +
      `SPD ×${speed}`;
  }

  /** Remove HUD from DOM */
  dispose(): void {
    if (this.helpTimeout) clearTimeout(this.helpTimeout);
    this.container.remove();
  }
}
