/**
 * Persistence des préférences utilisateur via localStorage.
 * Fonctionne en mode Vite dev ET Electron (localStorage accessible dans les deux cas).
 */

const STORAGE_KEY = 'moonorbiter-prefs';

export interface WidgetPosition {
  x: number; // px from left
  y: number; // px from top
}

export interface UserPreferences {
  // Globe
  mode: 'photo' | 'adaptive';
  sunIntensity: number;
  normalIntensity: number;
  adaptiveExaggeration: number;
  adaptiveResolution: number; // index 1-3
  graticule: boolean;
  formations: boolean;
  mariaCount: number;
  cratersCount: number;
  otherCount: number;
  wiki: boolean;
  // Workshop (persistent entre sessions workshop)
  wsLightAzimuth: number;
  wsLightElevation: number;
  wsBaseThickness: number;
  // Widget positions (null = default CSS position)
  hudPosition: WidgetPosition | null;
  scalebarPosition: WidgetPosition | null;
}

const DEFAULTS: UserPreferences = {
  mode: 'photo',
  sunIntensity: 2.0,
  normalIntensity: 1.0,
  adaptiveExaggeration: 1.0,
  adaptiveResolution: 1,
  graticule: false,
  formations: false,
  mariaCount: 10,
  cratersCount: 10,
  otherCount: 10,
  wiki: false,
  wsLightAzimuth: 45,
  wsLightElevation: 30,
  wsBaseThickness: 0.5,
  hudPosition: null,
  scalebarPosition: null,
};

/** Charge les préférences depuis localStorage, merge avec les défauts */
export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    return { ...DEFAULTS, ...stored };
  } catch {
    console.warn('[Prefs] Failed to load preferences, using defaults');
    return { ...DEFAULTS };
  }
}

/** Sauvegarde un sous-ensemble de préférences (merge partiel) */
export function savePreferences(partial: Partial<UserPreferences>): void {
  try {
    const current = loadPreferences();
    const merged = { ...current, ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    console.warn('[Prefs] Failed to save preferences');
  }
}
