/** Rayon moyen de la Lune en km */
export const MOON_RADIUS = 1737.4;

/** Rayon de la sphère Three.js (unités arbitraires) */
export const SPHERE_RADIUS = 10;

/** Facteur d'échelle : 1 unité Three.js = combien de km */
export const SCALE_FACTOR = SPHERE_RADIUS / MOON_RADIUS;

/** Rayon de référence lunaire en mètres (IAU 2015) */
export const MOON_RADIUS_M = 1737400;

/** Chemin vers les données sur le disque D */
export const DATA_PATH = 'D:/MoonOrbiterData';

/** Segments de la sphère pour la déformation LOLA (résolution géométrique du Globe) */
export const SPHERE_SEGMENTS_DISPLACEMENT = 192;

/** Couleur de fond (noir espace) */
export const BG_COLOR = 0x000000;

// --- Élévation ---

/** Exagération verticale par défaut (mode adaptatif uniquement) */
export const DEFAULT_VERTICAL_EXAGGERATION = 1;

/** Limites du slider d'exagération (mode adaptatif uniquement, 1 = réel) */
export const MIN_VERTICAL_EXAGGERATION = 1;
export const MAX_VERTICAL_EXAGGERATION = 10;

// --- Maillage adaptatif (grilles LDEM pré-calculées) ---

/** Chemin de base des grilles via le middleware Vite */
export const GRID_BASE_PATH = '/moon-data/grids';

/**
 * Résolutions de grille disponibles (2^n + 1, contrainte RTIN).
 * - 513 : sous-échantillonnage LDEM 64ppd (~889 m/px) — vue lointaine
 * - 1025 : quasi-natif LDEM 64ppd (~444 m/px) — zoom moyen
 * - 2049 : quasi-natif LDEM 128ppd (~222 m/px) — zoom serré (à venir)
 */
export const GRID_RESOLUTIONS = [513, 1025, 2049] as const;

/** Erreur max par défaut pour le RTIN (mètres d'altitude) */
export const DEFAULT_MAX_ERROR = 50;
