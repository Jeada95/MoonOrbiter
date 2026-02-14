import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppConfig {
  dataFolder: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
}

const CONFIG_FILENAME = 'config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

export function loadConfig(): AppConfig | null {
  const configPath = getConfigPath();
  console.log('[config] Looking for config at:', configPath);
  try {
    if (!fs.existsSync(configPath)) {
      console.log('[config] Config file does not exist');
      return null;
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as AppConfig;
    // Validate that the data folder still exists
    if (config.dataFolder && fs.existsSync(config.dataFolder)) {
      return config;
    }
    console.log('[config] Data folder missing or invalid:', config.dataFolder);
    return null;
  } catch (err) {
    console.error('[config] Error loading config:', err);
    return null;
  }
}

export function saveConfig(config: AppConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Validate that a folder contains the minimum required data files.
 * Returns null if valid, or an error message if invalid.
 */
export function validateDataFolder(folderPath: string): string | null {
  if (!fs.existsSync(folderPath)) {
    return `Le dossier n'existe pas : ${folderPath}`;
  }

  // Check for at least one texture file
  const has2k = fs.existsSync(path.join(folderPath, 'moon_texture_2k.jpg'));
  const has4k = fs.existsSync(path.join(folderPath, 'moon_texture_4k.jpg'));
  if (!has2k && !has4k) {
    return 'Aucune texture lunaire trouvée (moon_texture_2k.jpg ou moon_texture_4k.jpg)';
  }

  return null; // valid
}

/**
 * Detect which grid resolution levels are available.
 * Returns an array like [513, 1025] or [513, 1025, 2049].
 */
export function detectAvailableGrids(dataFolder: string): number[] {
  const gridsDir = path.join(dataFolder, 'grids');
  const available: number[] = [];

  for (const res of [513, 1025, 2049]) {
    const resDir = path.join(gridsDir, String(res));
    if (!fs.existsSync(resDir)) continue;

    try {
      const files = fs.readdirSync(resDir).filter(f => f.endsWith('.bin'));
      if (files.length > 0) {
        available.push(res);
      }
    } catch {
      // skip unreadable directories
    }
  }

  return available;
}
