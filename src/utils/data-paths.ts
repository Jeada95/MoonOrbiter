/**
 * Centralized data URL resolution for both Vite dev and Electron modes.
 *
 * - Vite dev: getDataUrl('/moon-data/foo.jpg') → '/moon-data/foo.jpg' (served by Vite plugin)
 * - Electron:  getDataUrl('/moon-data/foo.jpg') → 'http://127.0.0.1:PORT/foo.jpg' (local server)
 */

let _dataBaseUrl: string | null = null;
let _initialized = false;

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
