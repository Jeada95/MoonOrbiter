/**
 * Builds a watertight "brick" mesh from an extracted LDEM heightmap.
 *
 * The brick is a rectangular solid with:
 *  - Top: real lunar terrain surface (regular grid)
 *  - 4 side walls connecting terrain edges to a flat base
 *  - Bottom: flat rectangle
 *
 * Coordinates: X = East-West (km), Y = North-South (km), Z = Up (altitude km)
 * Origin = center of the brick at base level.
 */

import * as THREE from 'three';
import type { LDEMExtractResult } from './LDEMRangeLoader';

const MOON_RADIUS_KM = 1737.4;
const KM_PER_DEG_LAT = (Math.PI * MOON_RADIUS_KM) / 180; // ~30.33 km/deg

// ─── Types ──────────────────────────────────────────────────────

export interface BrickOptions {
  heightmap: LDEMExtractResult;
  /** Vertical exaggeration (1 = real, 5 = 5× taller) */
  exaggeration: number;
  /** Base thickness below minimum elevation, in km */
  baseThickness: number;
}

export interface BrickResult {
  geometry: THREE.BufferGeometry;
  /** Reference to the position attribute for fast exaggeration updates */
  positions: Float32Array;
  /** Elevation data in meters for each top-surface vertex (row-major) */
  elevations: Float32Array;
  /** Number of top-surface vertices (cols × rows) */
  topVertexCount: number;
  /** Number of wall vertices (for skipping during exaggeration update) */
  wallVertexCount: number;
  /** Base Z level in km */
  baseZ: number;
  /** Grid dimensions */
  cols: number;
  rows: number;
  /** Width/height in km for camera framing */
  widthKm: number;
  heightKm: number;
  /** Center lat for reference */
  centerLat: number;
}

// ─── Builder ────────────────────────────────────────────────────

export function buildBrickGeometry(opts: BrickOptions): BrickResult {
  const { heightmap, exaggeration, baseThickness } = opts;
  const { data, width: cols, height: rows, latMin, latMax, lonMin, lonMax } = heightmap;

  const centerLat = (latMin + latMax) / 2;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const kmPerDegLon = KM_PER_DEG_LAT * cosLat;

  // Total dimensions in km
  const totalWidthKm = (lonMax - lonMin) * kmPerDegLon;
  const totalHeightKm = (latMax - latMin) * KM_PER_DEG_LAT;
  const halfW = totalWidthKm / 2;
  const halfH = totalHeightKm / 2;

  // Find min elevation for base level
  let minElev = Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < minElev) minElev = data[i];
  }
  const minElevKm = minElev / 1000;
  const baseZ = (minElevKm * exaggeration) - baseThickness;

  // ─── Top surface ────────────────────────────────────────────
  const topVerts = cols * rows;
  const topTris = (cols - 1) * (rows - 1) * 2;

  // ─── Walls ──────────────────────────────────────────────────
  // Each edge: N quads = N-1 segments × 2 tris, N top + N bottom = 2N verts
  const northVerts = cols * 2;
  const southVerts = cols * 2;
  const westVerts = rows * 2;
  const eastVerts = rows * 2;
  const wallVerts = northVerts + southVerts + westVerts + eastVerts;
  const wallTris = ((cols - 1) + (cols - 1) + (rows - 1) + (rows - 1)) * 2;

  // ─── Bottom face ────────────────────────────────────────────
  const bottomVerts = 4;
  const bottomTris = 2;

  const totalVerts = topVerts + wallVerts + bottomVerts;
  const totalTris = topTris + wallTris + bottomTris;

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);

  let vi = 0; // vertex index
  let ii = 0; // index index

  // ─── 1) Top surface vertices ────────────────────────────────
  for (let r = 0; r < rows; r++) {
    const y = halfH - (r / (rows - 1)) * totalHeightKm; // north = +Y
    for (let c = 0; c < cols; c++) {
      const x = -halfW + (c / (cols - 1)) * totalWidthKm;
      const elevM = data[r * cols + c];
      const z = (elevM / 1000) * exaggeration;
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = z;
      vi++;
    }
  }

  // Top surface indices (two triangles per quad)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r * cols + c;
      const tr = tl + 1;
      const bl = (r + 1) * cols + c;
      const br = bl + 1;
      // CCW winding (Z-up = outward)
      indices[ii++] = tl;
      indices[ii++] = bl;
      indices[ii++] = tr;
      indices[ii++] = tr;
      indices[ii++] = bl;
      indices[ii++] = br;
    }
  }

  // ─── 2) Wall helper ─────────────────────────────────────────
  const wallBase = vi; // starting vertex index for walls

  function addWallStrip(
    edgePositions: { x: number; y: number; z: number }[],
    normalDir: 'north' | 'south' | 'east' | 'west',
  ): void {
    const startV = vi;
    const n = edgePositions.length;

    // Top row + bottom row of vertices
    for (let i = 0; i < n; i++) {
      const p = edgePositions[i];
      // Top vertex (terrain edge)
      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = p.y;
      positions[vi * 3 + 2] = p.z;
      vi++;
      // Bottom vertex (base level)
      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = p.y;
      positions[vi * 3 + 2] = baseZ;
      vi++;
    }

    // Indices: quads between consecutive pairs
    // Winding depends on which wall (outward-facing normals)
    const flip = (normalDir === 'south' || normalDir === 'east');
    for (let i = 0; i < n - 1; i++) {
      const t0 = startV + i * 2;     // top-left
      const b0 = t0 + 1;              // bottom-left
      const t1 = startV + (i + 1) * 2; // top-right
      const b1 = t1 + 1;              // bottom-right

      if (flip) {
        indices[ii++] = t0; indices[ii++] = t1; indices[ii++] = b0;
        indices[ii++] = b0; indices[ii++] = t1; indices[ii++] = b1;
      } else {
        indices[ii++] = t0; indices[ii++] = b0; indices[ii++] = t1;
        indices[ii++] = t1; indices[ii++] = b0; indices[ii++] = b1;
      }
    }
  }

  // North wall (row 0, left→right = west→east)
  const northEdge: { x: number; y: number; z: number }[] = [];
  for (let c = 0; c < cols; c++) {
    northEdge.push({
      x: positions[c * 3],
      y: positions[c * 3 + 1],
      z: positions[c * 3 + 2],
    });
  }
  addWallStrip(northEdge, 'north');

  // South wall (last row, left→right)
  const southEdge: { x: number; y: number; z: number }[] = [];
  const southRowStart = (rows - 1) * cols;
  for (let c = 0; c < cols; c++) {
    const idx = southRowStart + c;
    southEdge.push({
      x: positions[idx * 3],
      y: positions[idx * 3 + 1],
      z: positions[idx * 3 + 2],
    });
  }
  addWallStrip(southEdge, 'south');

  // West wall (col 0, top→bottom = north→south)
  const westEdge: { x: number; y: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const idx = r * cols;
    westEdge.push({
      x: positions[idx * 3],
      y: positions[idx * 3 + 1],
      z: positions[idx * 3 + 2],
    });
  }
  addWallStrip(westEdge, 'west');

  // East wall (last col, top→bottom)
  const eastEdge: { x: number; y: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const idx = r * cols + (cols - 1);
    eastEdge.push({
      x: positions[idx * 3],
      y: positions[idx * 3 + 1],
      z: positions[idx * 3 + 2],
    });
  }
  addWallStrip(eastEdge, 'east');

  // ─── 3) Bottom face ─────────────────────────────────────────
  const bv = vi;
  // Four corners at baseZ (CCW when viewed from below = CW from above)
  const corners = [
    [-halfW, halfH, baseZ],   // NW
    [halfW, halfH, baseZ],    // NE
    [halfW, -halfH, baseZ],   // SE
    [-halfW, -halfH, baseZ],  // SW
  ];
  for (const [x, y, z] of corners) {
    positions[vi * 3] = x;
    positions[vi * 3 + 1] = y;
    positions[vi * 3 + 2] = z;
    vi++;
  }
  // Two triangles (normal facing -Z = downward)
  indices[ii++] = bv; indices[ii++] = bv + 2; indices[ii++] = bv + 1;
  indices[ii++] = bv; indices[ii++] = bv + 3; indices[ii++] = bv + 2;

  // ─── Build geometry ─────────────────────────────────────────
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return {
    geometry,
    positions,
    elevations: new Float32Array(data), // copy for exaggeration updates
    topVertexCount: topVerts,
    wallVertexCount: wallVerts,
    baseZ,
    cols,
    rows,
    widthKm: totalWidthKm,
    heightKm: totalHeightKm,
    centerLat,
  };
}

// ─── Fast exaggeration update ───────────────────────────────────

/**
 * Update Z coordinates in-place when exaggeration changes.
 * Much cheaper than rebuilding the entire geometry.
 */
export function updateBrickExaggeration(
  brick: BrickResult,
  newExag: number,
  baseThickness: number,
  geometry: THREE.BufferGeometry,
): void {
  const { elevations, topVertexCount, positions, cols, rows } = brick;

  // Recompute baseZ from min elevation
  let minElev = Infinity;
  for (let i = 0; i < elevations.length; i++) {
    if (elevations[i] < minElev) minElev = elevations[i];
  }
  const baseZ = (minElev / 1000) * newExag - baseThickness;
  brick.baseZ = baseZ;

  // 1) Update top surface Z values
  for (let i = 0; i < topVertexCount; i++) {
    positions[i * 3 + 2] = (elevations[i] / 1000) * newExag;
  }

  // 2) Update wall vertices — stored as pairs (top, bottom) per edge vertex
  //    Order: north wall (cols pairs), south (cols), west (rows), east (rows)
  let wi = topVertexCount; // wall vertex index

  // North wall: row 0 of top surface
  for (let c = 0; c < cols; c++) {
    const topIdx = c; // row 0
    positions[wi * 3 + 2] = positions[topIdx * 3 + 2]; // top Z from surface
    wi++;
    positions[wi * 3 + 2] = baseZ; // bottom Z
    wi++;
  }

  // South wall: last row of top surface
  for (let c = 0; c < cols; c++) {
    const topIdx = (rows - 1) * cols + c;
    positions[wi * 3 + 2] = positions[topIdx * 3 + 2];
    wi++;
    positions[wi * 3 + 2] = baseZ;
    wi++;
  }

  // West wall: col 0
  for (let r = 0; r < rows; r++) {
    const topIdx = r * cols;
    positions[wi * 3 + 2] = positions[topIdx * 3 + 2];
    wi++;
    positions[wi * 3 + 2] = baseZ;
    wi++;
  }

  // East wall: last col
  for (let r = 0; r < rows; r++) {
    const topIdx = r * cols + (cols - 1);
    positions[wi * 3 + 2] = positions[topIdx * 3 + 2];
    wi++;
    positions[wi * 3 + 2] = baseZ;
    wi++;
  }

  // 3) Bottom face corners
  for (let i = wi; i < wi + 4; i++) {
    positions[i * 3 + 2] = baseZ;
  }

  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}
