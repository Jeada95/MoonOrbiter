import type { HeightmapGrid } from './types';
import { getGridBasePath, GRID_RESOLUTIONS } from '../utils/config';

export type GridResolution = typeof GRID_RESOLUTIONS[number];

/** Facteur DN → mètres pour les tuiles Int16 (identique au LDEM source) */
const DN_SCALE = 0.5;

/**
 * Charge les grilles d'élévation pré-calculées depuis le serveur local (D:\MoonOrbiterData\grids\).
 * Supporte les formats Int16 (DN bruts, × 0.5 = mètres) et Float32 (mètres, legacy).
 * Le format est détecté automatiquement par la taille du buffer.
 * Sources : LDEM 64ppd (résolutions 513, 1025) + LDEM 128ppd (résolution 2049).
 */
export class LocalGridLoader {
  /** Cache LRU en mémoire — clé = "resolution/tileName" */
  private cache = new Map<string, HeightmapGrid>();
  private cacheOrder: string[] = [];
  private maxCacheSize: number;

  constructor(maxCacheSize: number = 60) {
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Charge une grille pré-calculée pour une tuile donnée.
   *
   * @param latMin Latitude minimale de la bande (ex: -15)
   * @param lonMin Longitude minimale de la bande (ex: 30)
   * @param resolution Résolution de la grille (513, 1025 ou 2049)
   * @returns HeightmapGrid prête pour AdaptiveMesher.buildMesh()
   */
  async loadGrid(
    latMin: number,
    lonMin: number,
    resolution: GridResolution,
  ): Promise<HeightmapGrid> {
    const latMax = latMin + 15;
    const lonMax = lonMin + 15;
    const tileName = `tile_${latMin}N${latMax}N_${lonMin}E${lonMax}E`;
    const cacheKey = `${resolution}/${tileName}`;

    // Cache hit ?
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Remonter en tête du LRU
      this.cacheOrder = this.cacheOrder.filter(k => k !== cacheKey);
      this.cacheOrder.push(cacheKey);
      return cached;
    }

    // Fetch depuis le serveur local
    const url = `${getGridBasePath()}/${resolution}/${tileName}.bin`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erreur chargement grille ${url}: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const expectedSamples = resolution * resolution;

    let data: Float32Array;

    if (buffer.byteLength === expectedSamples * 2) {
      // Format Int16 : DN bruts, convertir en mètres (DN × 0.5)
      const int16 = new Int16Array(buffer);
      data = new Float32Array(expectedSamples);
      for (let i = 0; i < expectedSamples; i++) {
        data[i] = int16[i] * DN_SCALE;
      }
    } else if (buffer.byteLength === expectedSamples * 4) {
      // Format Float32 legacy : déjà en mètres
      data = new Float32Array(buffer);
    } else {
      throw new Error(
        `Taille grille invalide: ${buffer.byteLength} bytes ` +
        `(attendu ${expectedSamples * 2} Int16 ou ${expectedSamples * 4} Float32)`
      );
    }

    const grid: HeightmapGrid = {
      data,
      width: resolution,
      height: resolution,
      lonMin,
      lonMax,
      latMin,
      latMax,
    };

    // Ajouter au cache LRU
    this.cache.set(cacheKey, grid);
    this.cacheOrder.push(cacheKey);

    // Évicter si nécessaire
    while (this.cacheOrder.length > this.maxCacheSize) {
      const evicted = this.cacheOrder.shift()!;
      this.cache.delete(evicted);
    }

    return grid;
  }

  /** Vide le cache mémoire */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }

  /** Nombre de grilles en cache */
  get cacheSize(): number {
    return this.cache.size;
  }
}
