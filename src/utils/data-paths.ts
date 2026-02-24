/**
 * Centralized data URL resolution for both Vite dev and Electron modes.
 *
 * - Vite dev: getDataUrl('/moon-data/foo.jpg') → '/moon-data/foo.jpg' (served by Vite plugin)
 * - Electron:  getDataUrl('/moon-data/foo.jpg') → 'http://127.0.0.1:PORT/foo.jpg' (local server)
 */

let _dataBaseUrl: string | null = null;
let _initialized = false;

// Available grid resolutions (detected at startup via Electron IPC, or assumed all in dev)
let _availableGrids: number[] = [];
let _gridsInitialized = false;

/**
 * Must be called once at startup, before any data loading.
 * Detects Electron mode and resolves the data server URL.
 */
export async function initDataBaseUrl(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const api = (window as any).moonOrbiterElectron;
  if (api?.isElectron) {
    _dataBaseUrl = await api.getDataBaseUrl();
  }
  // Otherwise: Vite dev mode — /moon-data/ served by Vite plugin, no prefix needed
}

/**
 * Convert a /moon-data/ relative path to the correct URL for the current environment.
 */
export function getDataUrl(relativePath: string): string {
  if (_dataBaseUrl) {
    // Strip '/moon-data' prefix and prepend the data server URL
    return _dataBaseUrl + relativePath.replace('/moon-data', '');
  }
  return relativePath;
}

// ─── Available grids management ─────────────────────────────────

/**
 * Must be called once at startup, after initDataBaseUrl().
 * Detects which grid resolutions are installed (Electron IPC or assume all in dev).
 */
export async function initAvailableGrids(): Promise<void> {
  if (_gridsInitialized) return;
  _gridsInitialized = true;

  const api = (window as any).moonOrbiterElectron;
  if (api?.getAvailableGrids) {
    _availableGrids = await api.getAvailableGrids();
  } else {
    // Vite dev mode — assume all grids are available
    _availableGrids = [513, 1025, 2049];
  }
  console.log('[data-paths] Available grids:', _availableGrids);
}

/** Returns the list of installed grid resolutions (e.g. [513, 1025]) */
export function getAvailableGrids(): number[] {
  return _availableGrids;
}

/** Update available grids (after downloading new data packs) */
export function setAvailableGrids(grids: number[]): void {
  _availableGrids = grids;
  console.log('[data-paths] Updated available grids:', _availableGrids);
}

/**
 * Open an external URL safely.
 * In Electron: uses IPC to main process (validated scheme).
 * In browser: uses window.open.
 */
export function openExternalUrl(url: string): void {
  const api = (window as any).moonOrbiterElectron;
  if (api?.openExternal) {
    api.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}
