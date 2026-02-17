import kofiImg from '../assets/kofi3.png';

const KOFI_URL = 'https://ko-fi.com/M4M31UG2AP';
const VERSION = 'v0.1.0';

let overlay: HTMLDivElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

function close(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

function openKofi(): void {
  const electronApi = (window as any).moonOrbiterElectron;
  if (electronApi?.openExternal) {
    electronApi.openExternal(KOFI_URL);
  } else {
    window.open(KOFI_URL, '_blank', 'noopener');
  }
}

export function toggleAboutPanel(): void {
  // Toggle: si déjà ouvert, fermer
  if (overlay) { close(); return; }

  // ─── Backdrop ──────────────────────────────────────────
  overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:10000;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.6);';
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  // ─── Panel ─────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.style.cssText =
    'background:rgba(15,15,25,0.92);' +
    'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
    'border:1px solid rgba(255,255,255,0.12);border-radius:12px;' +
    'padding:32px 36px;max-width:420px;width:90%;' +
    'color:#ddd;font-family:"Segoe UI",sans-serif;' +
    'text-align:center;position:relative;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.5);';

  // ─── Close button ──────────────────────────────────────
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'position:absolute;top:10px;right:14px;' +
    'background:none;border:none;color:#888;' +
    'font-size:18px;cursor:pointer;padding:4px 8px;' +
    'line-height:1;transition:color 0.2s;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; });
  closeBtn.addEventListener('click', close);
  panel.appendChild(closeBtn);

  // ─── Title ─────────────────────────────────────────────
  const title = document.createElement('h2');
  title.textContent = 'MoonOrbiter';
  title.style.cssText =
    'margin:0 0 4px 0;font-size:22px;font-weight:600;' +
    'letter-spacing:2px;color:#fff;';
  panel.appendChild(title);

  // ─── Version ───────────────────────────────────────────
  const version = document.createElement('div');
  version.textContent = VERSION;
  version.style.cssText =
    'font-size:12px;color:#777;margin-bottom:20px;letter-spacing:1px;';
  panel.appendChild(version);

  // ─── Message ───────────────────────────────────────────
  const msg = document.createElement('p');
  msg.style.cssText =
    'font-size:14px;line-height:1.7;color:#ccc;margin:0 0 24px 0;';
  msg.innerHTML =
    'Welcome to <strong style="color:#fff">MoonOrbiter</strong>! ' +
    'Explore the Moon like never before, with real NASA data from the ' +
    'Lunar Reconnaissance Orbiter.<br><br>' +
    'This project is free and open-source. If you enjoy it, ' +
    'you can support its development:';
  panel.appendChild(msg);

  // ─── Ko-fi button ──────────────────────────────────────
  const kofiLink = document.createElement('a');
  kofiLink.href = '#';
  kofiLink.style.cssText = 'display:inline-block;cursor:pointer;';
  kofiLink.addEventListener('click', (e) => {
    e.preventDefault();
    openKofi();
  });

  const kofiImage = document.createElement('img');
  kofiImage.src = kofiImg;
  kofiImage.alt = 'Buy Me a Coffee at ko-fi.com';
  kofiImage.style.cssText = 'height:36px;border:0;transition:opacity 0.2s;';
  kofiLink.addEventListener('mouseenter', () => { kofiImage.style.opacity = '0.8'; });
  kofiLink.addEventListener('mouseleave', () => { kofiImage.style.opacity = '1'; });

  kofiLink.appendChild(kofiImage);
  panel.appendChild(kofiLink);

  // ─── Footer ────────────────────────────────────────────
  const footer = document.createElement('div');
  footer.style.cssText =
    'margin-top:20px;font-size:11px;color:#666;';
  footer.innerHTML =
    'Made with ☕ and NASA/LRO data<br>' +
    '<span style="color:#555">github.com/Jeada95/MoonOrbiter</span>';
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // ─── Escape key ────────────────────────────────────────
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', escHandler);
}
