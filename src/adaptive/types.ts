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
