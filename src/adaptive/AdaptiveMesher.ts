import type { HeightmapGrid, AdaptiveMeshData } from './types';
import { SPHERE_RADIUS, MOON_RADIUS_M } from '../utils/config';

const DEG2RAD = Math.PI / 180;

/**
 * Convertit une position grille (col, row) en coordonnées 3D sphériques (Three.js, Y=up).
 */
function gridToCartesian(
  col: number, row: number,
  grid: HeightmapGrid,
  exaggeration: number,
): [number, number, number] {
  const lon = grid.lonMin + (col / (grid.width - 1)) * (grid.lonMax - grid.lonMin);
  const lat = grid.latMax - (row / (grid.height - 1)) * (grid.latMax - grid.latMin);
  const alt = grid.data[row * grid.width + col];

  const latRad = lat * DEG2RAD;
  const lonRad = lon * DEG2RAD;
  const r = SPHERE_RADIUS * (1 + exaggeration * alt / MOON_RADIUS_M);

  // Convention Three.js SphereGeometry (dérivée via phi = PI - lon) :
  //   x = +r cos(lat) cos(lon)   y = r sin(lat)   z = r cos(lat) sin(lon)
  return [
    r * Math.cos(latRad) * Math.cos(lonRad),
    r * Math.sin(latRad),
    r * Math.cos(latRad) * Math.sin(lonRad),
  ];
}

function gridToUV(
  col: number, row: number,
  grid: HeightmapGrid,
): [number, number] {
  const lon = grid.lonMin + (col / (grid.width - 1)) * (grid.lonMax - grid.lonMin);
  const lat = grid.latMax - (row / (grid.height - 1)) * (grid.latMax - grid.latMin);
  // Globe UV miré (1-u) : U=0 → lon=-180°, U=0.5 → lon=0°, U=1 → lon=+180°.
  // Pour nos tuiles (lon 0..360) : U = (lon/360 + 0.5) % 1
  return [(lon / 360 + 0.5) % 1.0, (lat + 90) / 180];
}

/**
 * Données d'erreur RTIN pré-calculées pour une grille.
 * Ne dépend que de la grille terrain, pas de l'exagération ni du maxError.
 * Calcul lourd (~80% du temps), donc mis en cache.
 */
export interface MartiniErrors {
  gridSize: number;
  tileSize: number;
  errors: Float32Array;
  coords: Uint16Array;
  numTriangles: number;
  numParentTriangles: number;
}

/**
 * Maillage adaptatif RTIN — implémentation fidèle de Martini (Mapbox).
 * https://github.com/mapbox/martini
 *
 * Séparé en deux phases :
 * 1. computeErrors() — coûteux, une seule fois par grille (cachable)
 * 2. extractMesh() — rapide, à refaire quand maxError ou exagération change
 *
 * La grille DOIT être (2^n + 1)².
 */
export class AdaptiveMesher {

  /**
   * Phase 1 (LOURD) : Pré-calcul des coordonnées de triangles et des erreurs.
   * À ne faire qu'une seule fois par grille — le résultat est réutilisable.
   */
  static computeErrors(grid: HeightmapGrid): MartiniErrors {
    const gridSize = grid.width;
    const tileSize = gridSize - 1;
    if ((tileSize & (tileSize - 1)) !== 0) {
      throw new Error(`Grid size must be 2^n + 1, got ${gridSize}`);
    }
    if (grid.height !== gridSize) {
      throw new Error(`Grid must be square, got ${grid.width}×${grid.height}`);
    }

    const numTriangles = tileSize * tileSize * 2 - 2;
    const numParentTriangles = numTriangles - tileSize * tileSize;

    // coords[i*4..i*4+3] = (ax, ay, bx, by) des deux sommets de l'hypoténuse
    const coords = new Uint16Array(numTriangles * 4);

    for (let i = 0; i < numTriangles; i++) {
      let id = i + 2;
      let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0;
      if (id & 1) {
        bx = by = cx = tileSize;
      } else {
        ax = ay = cy = tileSize;
      }
      while ((id >>= 1) > 1) {
        const mx = (ax + bx) >> 1;
        const my = (ay + by) >> 1;
        if (id & 1) {
          bx = ax; by = ay;
          ax = cx; ay = cy;
        } else {
          ax = bx; ay = by;
          bx = cx; by = cy;
        }
        cx = mx; cy = my;
      }
      const k = i * 4;
      coords[k + 0] = ax;
      coords[k + 1] = ay;
      coords[k + 2] = bx;
      coords[k + 3] = by;
    }

    // Calcul des erreurs (bottom-up, enfants → parents)
    const terrain = grid.data;
    const errors = new Float32Array(gridSize * gridSize);

    for (let i = numTriangles - 1; i >= 0; i--) {
      const k = i * 4;
      const ax = coords[k + 0];
      const ay = coords[k + 1];
      const bx = coords[k + 2];
      const by = coords[k + 3];
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;
      const cx = mx + my - ay;
      const cy = my + ax - mx;

      const interpolated = (terrain[ay * gridSize + ax] + terrain[by * gridSize + bx]) / 2;
      const midIdx = my * gridSize + mx;
      const midError = Math.abs(interpolated - terrain[midIdx]);

      errors[midIdx] = Math.max(errors[midIdx], midError);

      if (i < numParentTriangles) {
        const leftChildIdx = ((ay + cy) >> 1) * gridSize + ((ax + cx) >> 1);
        const rightChildIdx = ((by + cy) >> 1) * gridSize + ((bx + cx) >> 1);
        errors[midIdx] = Math.max(errors[midIdx], errors[leftChildIdx], errors[rightChildIdx]);
      }
    }

    return { gridSize, tileSize, errors, coords, numTriangles, numParentTriangles };
  }

  /**
   * Phase 2 (RAPIDE) : Extraction du mesh depuis les erreurs pré-calculées.
   * Rapide car seule l'extraction top-down + projection 3D sont faites.
   */
  static extractMesh(
    grid: HeightmapGrid,
    martini: MartiniErrors,
    maxError: number,
    exaggeration: number,
  ): AdaptiveMeshData {
    const { gridSize, tileSize, errors } = martini;
    const max = tileSize;

    // --- Compter vertices et triangles ---
    const vertexIndices = new Uint32Array(gridSize * gridSize);
    vertexIndices.fill(0);
    let numVerts = 0;
    let numTris = 0;

    function countElements(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;

      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * gridSize + mx] > maxError) {
        countElements(cx, cy, ax, ay, mx, my);
        countElements(bx, by, cx, cy, mx, my);
      } else {
        if (!vertexIndices[ay * gridSize + ax]) vertexIndices[ay * gridSize + ax] = ++numVerts;
        if (!vertexIndices[by * gridSize + bx]) vertexIndices[by * gridSize + bx] = ++numVerts;
        if (!vertexIndices[cy * gridSize + cx]) vertexIndices[cy * gridSize + cx] = ++numVerts;
        numTris++;
      }
    }
    countElements(0, 0, max, max, max, 0);
    countElements(max, max, 0, 0, 0, max);

    // --- Remplir positions, UVs, indices ---
    const positions = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const triIndices = new Uint32Array(numTris * 3);
    let triIdx = 0;

    function emitTriangles(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
      const mx = (ax + bx) >> 1;
      const my = (ay + by) >> 1;

      if (Math.abs(ax - cx) + Math.abs(ay - cy) > 1 && errors[my * gridSize + mx] > maxError) {
        emitTriangles(cx, cy, ax, ay, mx, my);
        emitTriangles(bx, by, cx, cy, mx, my);
      } else {
        const a = vertexIndices[ay * gridSize + ax] - 1;
        const b = vertexIndices[by * gridSize + bx] - 1;
        const c = vertexIndices[cy * gridSize + cx] - 1;

        const [pax, pay, paz] = gridToCartesian(ax, ay, grid, exaggeration);
        positions[a * 3] = pax; positions[a * 3 + 1] = pay; positions[a * 3 + 2] = paz;

        const [pbx, pby, pbz] = gridToCartesian(bx, by, grid, exaggeration);
        positions[b * 3] = pbx; positions[b * 3 + 1] = pby; positions[b * 3 + 2] = pbz;

        const [pcx, pcy, pcz] = gridToCartesian(cx, cy, grid, exaggeration);
        positions[c * 3] = pcx; positions[c * 3 + 1] = pcy; positions[c * 3 + 2] = pcz;

        const [ua, va] = gridToUV(ax, ay, grid);
        uvs[a * 2] = ua; uvs[a * 2 + 1] = va;
        const [ub, vb] = gridToUV(bx, by, grid);
        uvs[b * 2] = ub; uvs[b * 2 + 1] = vb;
        const [uc, vc] = gridToUV(cx, cy, grid);
        uvs[c * 2] = uc; uvs[c * 2 + 1] = vc;

        // Winding order (a, c, b) pour normales vers l'extérieur
        triIndices[triIdx++] = a;
        triIndices[triIdx++] = c;
        triIndices[triIdx++] = b;
      }
    }
    emitTriangles(0, 0, max, max, max, 0);
    emitTriangles(max, max, 0, 0, 0, max);

    // --- Normales ---
    const normals = new Float32Array(numVerts * 3);

    for (let i = 0; i < triIndices.length; i += 3) {
      const i0 = triIndices[i] * 3;
      const i1 = triIndices[i + 1] * 3;
      const i2 = triIndices[i + 2] * 3;

      const abx = positions[i1] - positions[i0];
      const aby = positions[i1 + 1] - positions[i0 + 1];
      const abz = positions[i1 + 2] - positions[i0 + 2];
      const acx = positions[i2] - positions[i0];
      const acy = positions[i2 + 1] - positions[i0 + 1];
      const acz = positions[i2 + 2] - positions[i0 + 2];

      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;

      normals[i0] += nx; normals[i0 + 1] += ny; normals[i0 + 2] += nz;
      normals[i1] += nx; normals[i1 + 1] += ny; normals[i1 + 2] += nz;
      normals[i2] += nx; normals[i2 + 1] += ny; normals[i2 + 2] += nz;
    }

    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
      if (len > 0) {
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
      }
    }

    return {
      positions,
      normals,
      uvs,
      indices: triIndices,
      triangleCount: numTris,
      vertexCount: numVerts,
    };
  }

  /**
   * Méthode de commodité : calcule erreurs + extrait mesh en un seul appel.
   * Utiliser computeErrors() + extractMesh() séparément pour cacher les erreurs.
   */
  static buildMesh(
    grid: HeightmapGrid,
    maxError: number,
    exaggeration: number,
  ): AdaptiveMeshData {
    const martini = AdaptiveMesher.computeErrors(grid);
    return AdaptiveMesher.extractMesh(grid, martini, maxError, exaggeration);
  }
}
