import type { HeightmapGrid } from './types';
import { GRID_BASE_PATH, GRID_RESOLUTIONS } from '../utils/config';

export type GridResolution = typeof GRID_RESOLUTIONS[number];

/**
 * Charge les grilles Float32 pré-calculées depuis le serveur local (D:\MoonOrbiterData\grids\).
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
    const url = `${GRID_BASE_PATH}/${resolution}/${tileName}.bin`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Erreur chargement grille ${url}: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const data = new Float32Array(buffer);

    if (data.length !== resolution * resolution) {
      throw new Error(
        `Taille grille invalide: ${data.length} (attendu ${resolution * resolution})`
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
