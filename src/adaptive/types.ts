/** Point géographique avec altitude */
export interface GeoPoint {
  lon: number;  // degrés, 0..360
  lat: number;  // degrés, -90..+90
  alt: number;  // mètres par rapport à R=1737400m
}

/** Grille d'altitudes régulière (row-major, nord en haut) */
export interface HeightmapGrid {
  data: Float32Array;
  width: number;   // colonnes
  height: number;  // lignes
  lonMin: number;  // degrés
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Données géométriques du mesh adaptatif */
export interface AdaptiveMeshData {
  positions: Float32Array;  // xyz stride 3
  normals: Float32Array;    // xyz stride 3
  uvs: Float32Array;        // uv stride 2
  indices: Uint32Array;
  triangleCount: number;
  vertexCount: number;
}

/** État de chargement d'une tuile adaptive */
export enum AdaptiveTileState {
  IDLE = 'idle',
  LOADING = 'loading',
  READY = 'ready',
  ERROR = 'error',
}
