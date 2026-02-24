/**
 * Data Manager Panel — modal overlay showing downloadable data packs.
 * Same pattern as AboutPanel.ts (singleton toggle, Escape/click-outside to close).
 */

import { setAvailableGrids } from '../utils/data-paths';

interface PackRow {
  id: string;
  name: string;
  description: string;
  archiveSizeLabel: string;
  installed: boolean;
  gridsProvided: number[];
}

interface ProgressInfo {
  packId: string;
  phase: string;
  bytesDownloaded: number;
  bytesTotal: number;
  percent: number;
  error?: string;
}

let overlay: HTMLDivElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let progressCleanup: (() => void) | null = null;

// Track UI elements per pack for progress updates
const packElements = new Map<string, {
  statusEl: HTMLDivElement;
  btnEl: HTMLButtonElement | null;
  barEl: HTMLDivElement | null;
  barFill: HTMLDivElement | null;
}>();

function close(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  // Don't remove progress listener — download continues in background
  packElements.clear();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'downloading': return 'Downloading';
    case 'extracting': return 'Extracting';
    case 'verifying': return 'Verifying';
    case 'done': return 'Installed';
    case 'error': return 'Error';
    default: return phase;
  }
}

async function startDownload(packId: string): Promise<void> {
  const api = (window as any).moonOrbiterElectron;
  if (!api?.downloadDataPack) return;

  const el = packElements.get(packId);
  if (!el) return;

  // Switch UI to progress mode
  if (el.btnEl) el.btnEl.style.display = 'none';
  if (el.barEl) el.barEl.style.display = '';
  el.statusEl.textContent = 'Starting download...';
  el.statusEl.style.color = '#8bb8ff';

  try {
    const newGrids: number[] = await api.downloadDataPack(packId);
    // Update available grids in the renderer
    setAvailableGrids(newGrids);

    // Update UI to "Installed"
    el.statusEl.textContent = '✅ Installed';
    el.statusEl.style.color = '#4ade80';
    if (el.barEl) el.barEl.style.display = 'none';
  } catch (err) {
    el.statusEl.textContent = `❌ ${(err as Error).message}`;
    el.statusEl.style.color = '#f87171';
    if (el.barEl) el.barEl.style.display = 'none';
    // Re-show download button
    if (el.btnEl) el.btnEl.style.display = '';
  }
}

function handleProgress(progress: ProgressInfo): void {
  const el = packElements.get(progress.packId);
  if (!el) return;

  if (progress.phase === 'downloading') {
    const pct = progress.percent;
    const downloaded = formatBytes(progress.bytesDownloaded);
    const total = formatBytes(progress.bytesTotal);
    el.statusEl.textContent = `Downloading: ${downloaded} / ${total} (${pct}%)`;
    el.statusEl.style.color = '#8bb8ff';
    if (el.barFill) {
      el.barFill.style.width = `${pct}%`;
      el.barFill.style.background = '#2563eb';
    }
  } else if (progress.phase === 'extracting') {
    el.statusEl.textContent = 'Extracting archive...';
    el.statusEl.style.color = '#fbbf24';
    if (el.barFill) {
      el.barFill.style.width = '100%';
      el.barFill.style.background = '#fbbf24';
    }
  } else if (progress.phase === 'verifying') {
    el.statusEl.textContent = 'Verifying files...';
    el.statusEl.style.color = '#fbbf24';
  } else if (progress.phase === 'done') {
    el.statusEl.textContent = '✅ Installed';
    el.statusEl.style.color = '#4ade80';
    if (el.barEl) el.barEl.style.display = 'none';
    if (el.btnEl) el.btnEl.style.display = 'none';
  } else if (progress.phase === 'error') {
    el.statusEl.textContent = `❌ ${progress.error || 'Download failed'}`;
    el.statusEl.style.color = '#f87171';
    if (el.barEl) el.barEl.style.display = 'none';
    if (el.btnEl) el.btnEl.style.display = '';
  }
}

function buildPackRow(pack: PackRow, container: HTMLDivElement): void {
  const row = document.createElement('div');
  row.style.cssText =
    'padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);';

  // Title + description
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';

  const nameEl = document.createElement('span');
  nameEl.textContent = pack.name;
  nameEl.style.cssText = 'font-size:14px;font-weight:600;color:#fff;';

  const sizeEl = document.createElement('span');
  sizeEl.textContent = pack.archiveSizeLabel;
  sizeEl.style.cssText = 'font-size:11px;color:#888;';

  header.appendChild(nameEl);
  header.appendChild(sizeEl);
  row.appendChild(header);

  const descEl = document.createElement('div');
  descEl.textContent = pack.description;
  descEl.style.cssText = 'font-size:12px;color:#999;margin-bottom:10px;';
  row.appendChild(descEl);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'font-size:12px;margin-bottom:6px;';

  // Progress bar (hidden initially)
  const barEl = document.createElement('div');
  barEl.style.cssText =
    'height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;display:none;margin-bottom:6px;';
  const barFill = document.createElement('div');
  barFill.style.cssText = 'height:100%;width:0;background:#2563eb;border-radius:2px;transition:width 0.3s;';
  barEl.appendChild(barFill);

  // Button
  let btnEl: HTMLButtonElement | null = null;

  if (pack.installed) {
    statusEl.textContent = '✅ Installed';
    statusEl.style.color = '#4ade80';
  } else {
    statusEl.textContent = 'Not installed';
    statusEl.style.color = '#888';

    btnEl = document.createElement('button');
    btnEl.textContent = `Download (${pack.archiveSizeLabel})`;
    btnEl.style.cssText =
      'padding:6px 16px;background:#2563eb;color:#fff;border:none;border-radius:5px;' +
      'font:12px "Segoe UI",sans-serif;cursor:pointer;transition:background 0.2s;';
    btnEl.addEventListener('mouseenter', () => { if (btnEl) btnEl.style.background = '#1d4ed8'; });
    btnEl.addEventListener('mouseleave', () => { if (btnEl) btnEl.style.background = '#2563eb'; });
    btnEl.addEventListener('click', () => startDownload(pack.id));
  }

  row.appendChild(statusEl);
  row.appendChild(barEl);
  if (btnEl) row.appendChild(btnEl);
  container.appendChild(row);

  // Store references for progress updates
  packElements.set(pack.id, { statusEl, btnEl, barEl, barFill });
}

export async function toggleDataManagerPanel(): Promise<void> {
  // Toggle: if already open, close
  if (overlay) { close(); return; }

  const api = (window as any).moonOrbiterElectron;

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
    'background:rgba(15,15,25,0.95);' +
    'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
    'border:1px solid rgba(255,255,255,0.12);border-radius:12px;' +
    'max-width:480px;width:92%;max-height:80vh;overflow-y:auto;' +
    'color:#ddd;font-family:"Segoe UI",sans-serif;' +
    'position:relative;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

  // ─── Header ────────────────────────────────────────────
  const headerEl = document.createElement('div');
  headerEl.style.cssText =
    'padding:20px 24px 12px 24px;display:flex;align-items:center;justify-content:space-between;' +
    'border-bottom:1px solid rgba(255,255,255,0.08);';

  const titleEl = document.createElement('h2');
  titleEl.textContent = '📦 Data Manager';
  titleEl.style.cssText = 'margin:0;font-size:18px;font-weight:600;color:#fff;';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText =
    'background:none;border:none;color:#888;font-size:18px;cursor:pointer;' +
    'padding:4px 8px;line-height:1;transition:color 0.2s;';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; });
  closeBtn.addEventListener('click', close);

  headerEl.appendChild(titleEl);
  headerEl.appendChild(closeBtn);
  panel.appendChild(headerEl);

  // ─── Pack list ─────────────────────────────────────────
  const listEl = document.createElement('div');

  if (api?.getDataPackStatuses) {
    try {
      const statuses: PackRow[] = await api.getDataPackStatuses();
      for (const pack of statuses) {
        buildPackRow(pack, listEl);
      }
    } catch (err) {
      const errEl = document.createElement('div');
      errEl.textContent = `Error loading pack statuses: ${(err as Error).message}`;
      errEl.style.cssText = 'padding:20px;color:#f87171;font-size:13px;text-align:center;';
      listEl.appendChild(errEl);
    }

    // Register progress listener
    if (api.onDownloadProgress) {
      api.onDownloadProgress(handleProgress);
      progressCleanup = () => api.removeDownloadProgressListener?.();
    }
  } else {
    // Not in Electron — show info message
    const infoEl = document.createElement('div');
    infoEl.style.cssText = 'padding:24px;text-align:center;color:#999;font-size:13px;line-height:1.6;';
    infoEl.innerHTML =
      'Data pack downloads are only available in the desktop application.<br><br>' +
      'In development mode, place data files in your configured data folder.';
    listEl.appendChild(infoEl);
  }

  panel.appendChild(listEl);

  // ─── Footer ────────────────────────────────────────────
  const footerEl = document.createElement('div');
  footerEl.style.cssText =
    'padding:12px 24px;border-top:1px solid rgba(255,255,255,0.06);' +
    'font-size:11px;color:#666;text-align:center;';
  footerEl.textContent = 'Downloads continue in background if panel is closed';
  panel.appendChild(footerEl);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // ─── Escape key ────────────────────────────────────────
  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', escHandler);
}
