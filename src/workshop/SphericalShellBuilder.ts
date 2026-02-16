/**
 * Builds a watertight spherical shell segment for 3D printing.
 *
 * Each segment covers a lat/lon rectangle on the Moon sphere.
 * Geometry consists of:
 *   - Outer surface: lunar terrain with elevation (spherical)
 *   - Inner surface: smooth sphere at reduced radius (spherical)
 *   - 4 cut walls with step/lip joints for interlocking assembly
 *   - Polar caps (triangle fan) when the piece includes a pole
 *
 * Coordinates are in km, centered at the Moon's center (origin).
 * Convention: x = R·cos(lat)·cos(lon), y = R·sin(lat), z = -R·cos(lat)·sin(lon)
 */

import * as THREE from 'three';
import type { LDEMExtractResult } from './LDEMRangeLoader';
import type { PieceBounds } from './PieceDecomposer';

// ─── Constants ───────────────────────────────────────────────────

const MOON_RADIUS_KM = 1737.4;
const MOON_RADIUS_M = 1737400;
const DEG2RAD = Math.PI / 180;

// ─── Types ───────────────────────────────────────────────────────

export interface ShellSegmentOptions {
  heightmap: LDEMExtractResult;
  piece: PieceBounds;
  /** Vertical exaggeration (1 = real) */
  exaggeration: number;
  /** Shell thickness in km */
  shellThicknessKm: number;
  /** Lip depth in km (half-thickness step for interlocking) */
  lipDepthKm: number;
}

export interface ShellSegmentResult {
  geometry: THREE.BufferGeometry;
  piece: PieceBounds;
}

// ─── Coordinate helper ──────────────────────────────────────────

function sphericalToCartesian(latDeg: number, lonDeg: number, r: number): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  return [
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon),
  ];
}

// ─── Builder ─────────────────────────────────────────────────────

export function buildShellSegment(opts: ShellSegmentOptions): ShellSegmentResult {
  const { heightmap, piece, exaggeration, shellThicknessKm, lipDepthKm } = opts;
  const { data, width: cols, height: rows } = heightmap;
  const { latMin, latMax, lonMin, lonMax, hasSouthPole, hasNorthPole } = piece;

  const latSpan = latMax - latMin;
  const lonSpan = lonMax - lonMin;

  // Radii
  const rInner = MOON_RADIUS_KM - shellThicknessKm;
  const rMid = MOON_RADIUS_KM - shellThicknessKm / 2; // step boundary

  // ─── Count vertices and triangles ──────────────────────────────

  const outerVerts = cols * rows;
  const innerVerts = cols * rows;
  const outerTris = (cols - 1) * (rows - 1) * 2;
  const innerTris = outerTris;

  // Cut walls: each wall is a strip of quads.
  // With lip, each wall edge vertex becomes 4 vertices:
  //   outer, outerMid (step), innerMid (step), inner
  // North wall (row 0): cols × 4 vertices, (cols-1) × 6 triangles
  // South wall (last row): cols × 4 vertices, (cols-1) × 6 triangles
  // West wall (col 0): rows × 4 vertices, (rows-1) × 6 triangles
  // East wall (last col): rows × 4 vertices, (rows-1) × 6 triangles
  // At poles, the corresponding wall is replaced by a cap fan.

  const northWallVerts = hasNorthPole ? 0 : cols * 4;
  const southWallVerts = hasSouthPole ? 0 : cols * 4;
  const westWallVerts = rows * 4;
  const eastWallVerts = rows * 4;
  const wallVerts = northWallVerts + southWallVerts + westWallVerts + eastWallVerts;

  const northWallTris = hasNorthPole ? 0 : (cols - 1) * 6;
  const southWallTris = hasSouthPole ? 0 : (cols - 1) * 6;
  const westWallTris = (rows - 1) * 6;
  const eastWallTris = (rows - 1) * 6;
  const wallTris = northWallTris + southWallTris + westWallTris + eastWallTris;

  // Polar caps: fan from pole point connecting outer edge to inner edge
  // North pole cap: 1 center vertex + cols edge pairs → (cols-1) * 2 triangles
  // South pole cap: same
  const northCapVerts = hasNorthPole ? 1 + cols * 2 : 0;
  const southCapVerts = hasSouthPole ? 1 + cols * 2 : 0;
  const northCapTris = hasNorthPole ? (cols - 1) * 2 : 0;
  const southCapTris = hasSouthPole ? (cols - 1) * 2 : 0;

  const totalVerts = outerVerts + innerVerts + wallVerts + northCapVerts + southCapVerts;
  const totalTris = outerTris + innerTris + wallTris + northCapTris + southCapTris;

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);
  let vi = 0; // vertex write index
  let ii = 0; // index write index

  // ─── Helper: write vertex ──────────────────────────────────────

  function writeVertex(x: number, y: number, z: number): number {
    const idx = vi;
    positions[vi * 3] = x;
    positions[vi * 3 + 1] = y;
    positions[vi * 3 + 2] = z;
    vi++;
    return idx;
  }

  // ─── Helper: outer radius at grid position ─────────────────────

  function outerRadius(r: number, c: number): number {
    const elevM = data[r * cols + c];
    return MOON_RADIUS_KM * (1 + exaggeration * elevM / MOON_RADIUS_M);
  }

  // ─── Helper: lat/lon at grid position ──────────────────────────

  function latAt(r: number): number {
    // Row 0 = latMax (north), last row = latMin (south)
    return latMax - (r / (rows - 1)) * latSpan;
  }

  function lonAt(c: number): number {
    return lonMin + (c / (cols - 1)) * lonSpan;
  }

  // ─── 1) Outer surface ──────────────────────────────────────────

  const outerBase = vi;
  for (let r = 0; r < rows; r++) {
    const lat = latAt(r);
    for (let c = 0; c < cols; c++) {
      const lon = lonAt(c);
      const rOut = outerRadius(r, c);
      const [x, y, z] = sphericalToCartesian(lat, lon, rOut);
      writeVertex(x, y, z);
    }
  }

  // Outer surface triangles (CCW from outside = outward normals)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = outerBase + r * cols + c;
      const tr = tl + 1;
      const bl = outerBase + (r + 1) * cols + c;
      const br = bl + 1;
      // CCW when viewed from outside the sphere
      indices[ii++] = tl; indices[ii++] = bl; indices[ii++] = tr;
      indices[ii++] = tr; indices[ii++] = bl; indices[ii++] = br;
    }
  }

  // ─── 2) Inner surface ──────────────────────────────────────────

  const innerBase = vi;
  for (let r = 0; r < rows; r++) {
    const lat = latAt(r);
    for (let c = 0; c < cols; c++) {
      const lon = lonAt(c);
      const [x, y, z] = sphericalToCartesian(lat, lon, rInner);
      writeVertex(x, y, z);
    }
  }

  // Inner surface triangles (reversed winding = inward normals, pointing outward from shell interior)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = innerBase + r * cols + c;
      const tr = tl + 1;
      const bl = innerBase + (r + 1) * cols + c;
      const br = bl + 1;
      // CW when viewed from outside = CCW from inside
      indices[ii++] = tl; indices[ii++] = tr; indices[ii++] = bl;
      indices[ii++] = tr; indices[ii++] = br; indices[ii++] = bl;
    }
  }

  // ─── 3) Cut walls with step/lip ────────────────────────────────
  //
  // Each wall edge vertex generates 4 vertices at different radii:
  //   v0: outer surface radius (from heightmap)
  //   v1: outer side of step (rMid, with lip offset)
  //   v2: inner side of step (rMid, with lip offset)
  //   v3: inner surface radius (rInner)
  //
  // Lip convention:
  //   North/East walls: outer half protrudes (lip on outer side)
  //     → v0-v1 at outerR to rMid (full lat/lon)
  //     → v1-v2 step inward by lipDepthKm at rMid
  //     → v2-v3 at rMid-lipDepth to rInner
  //   South/West walls: inner half protrudes (lip on inner side)
  //     → v0-v1 at outerR to rMid (recessed by lipDepth)
  //     → v1-v2 step outward by lipDepthKm at rMid
  //     → v2-v3 at rMid to rInner (full lat/lon)

  /**
   * Build a wall strip with lip for a series of edge positions.
   * @param edgeCount Number of edge vertices
   * @param getOuterXYZ Get outer surface position at edge index
   * @param getLatLon Get (lat, lon) at edge index for computing lip offset
   * @param lipOutward If true, the outer half protrudes (north/east convention)
   * @param flipWinding Flip triangle winding for correct outward normals
   */
  function buildLipWall(
    edgeCount: number,
    getOuterXYZ: (i: number) => [number, number, number],
    getLatLon: (i: number) => [number, number],
    lipOutward: boolean,
    flipWinding: boolean,
    wallNormalDir: [number, number, number], // approximate wall normal for lip offset direction
  ): void {
    const wallBase = vi;

    for (let i = 0; i < edgeCount; i++) {
      const [ox, oy, oz] = getOuterXYZ(i);
      const [lat, lon] = getLatLon(i);

      // Inner surface point at this lat/lon
      const [ix, iy, iz] = sphericalToCartesian(lat, lon, rInner);

      // Mid-radius point (step boundary)
      const [mx, my, mz] = sphericalToCartesian(lat, lon, rMid);

      // Lip offset direction (perpendicular to wall, tangent to sphere)
      // We use the provided wall normal direction scaled by lipDepthKm
      const lipX = wallNormalDir[0] * lipDepthKm;
      const lipY = wallNormalDir[1] * lipDepthKm;
      const lipZ = wallNormalDir[2] * lipDepthKm;

      if (lipOutward) {
        // North/East: outer half at full position, inner half recessed
        writeVertex(ox, oy, oz);                           // v0: outer
        writeVertex(mx, my, mz);                           // v1: mid (full)
        writeVertex(mx - lipX, my - lipY, mz - lipZ);     // v2: mid stepped in
        writeVertex(ix - lipX, iy - lipY, iz - lipZ);     // v3: inner recessed
      } else {
        // South/West: outer half recessed, inner half at full position
        writeVertex(ox - lipX, oy - lipY, oz - lipZ);     // v0: outer recessed
        writeVertex(mx - lipX, my - lipY, mz - lipZ);     // v1: mid recessed
        writeVertex(mx, my, mz);                           // v2: mid (full)
        writeVertex(ix, iy, iz);                           // v3: inner
      }
    }

    // Triangulate: 3 quad strips between v0-v1, v1-v2, v2-v3
    for (let i = 0; i < edgeCount - 1; i++) {
      const base0 = wallBase + i * 4;
      const base1 = wallBase + (i + 1) * 4;

      for (let strip = 0; strip < 3; strip++) {
        const a = base0 + strip;       // current top
        const b = base0 + strip + 1;   // current bottom
        const c = base1 + strip;       // next top
        const d = base1 + strip + 1;   // next bottom

        if (flipWinding) {
          indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
        } else {
          indices[ii++] = a; indices[ii++] = b; indices[ii++] = c;
          indices[ii++] = c; indices[ii++] = b; indices[ii++] = d;
        }
      }
    }
  }

  // Compute approximate wall normal directions (tangent to sphere, perpendicular to wall)
  // These are used for the lip offset direction.

  const midLat = (latMin + latMax) / 2;
  const midLon = (lonMin + lonMax) / 2;

  // North wall normal: points northward (positive lat direction)
  // At the north boundary, the tangent pointing north is approximately:
  const northNormal = computeLatTangent(latMax, midLon);
  // South wall normal: points southward
  const southNormal: [number, number, number] = [-northNormal[0], -northNormal[1], -northNormal[2]];
  // East wall normal: points eastward
  const eastNormal = computeLonTangent(midLat, lonMax);
  // West wall normal: points westward
  const westNormal: [number, number, number] = [-eastNormal[0], -eastNormal[1], -eastNormal[2]];

  // North wall (row 0, west→east) — lipOutward = true (outer protrudes)
  if (!hasNorthPole) {
    buildLipWall(
      cols,
      (c) => {
        const idx = outerBase + c;
        return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
      },
      (c) => [latMax, lonAt(c)],
      true, // lipOutward (north = outer protrudes)
      false, // winding
      northNormal,
    );
  }

  // South wall (last row, west→east) — lipOutward = false (inner protrudes)
  if (!hasSouthPole) {
    buildLipWall(
      cols,
      (c) => {
        const idx = outerBase + (rows - 1) * cols + c;
        return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
      },
      (c) => [latMin, lonAt(c)],
      false, // lipOutward (south = inner protrudes)
      true,  // flip winding
      southNormal,
    );
  }

  // West wall (col 0, north→south) — lipOutward = false (inner protrudes)
  buildLipWall(
    rows,
    (r) => {
      const idx = outerBase + r * cols;
      return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
    },
    (r) => [latAt(r), lonMin],
    false, // lipOutward (west = inner protrudes)
    false, // winding
    westNormal,
  );

  // East wall (last col, north→south) — lipOutward = true (outer protrudes)
  buildLipWall(
    rows,
    (r) => {
      const idx = outerBase + r * cols + (cols - 1);
      return [positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2]];
    },
    (r) => [latAt(r), lonMax],
    true,  // lipOutward (east = outer protrudes)
    true,  // flip winding
    eastNormal,
  );

  // ─── 4) Polar caps ─────────────────────────────────────────────
  // When a piece includes a pole, the wall at that pole is replaced by
  // a fan connecting outer and inner edges to the pole point.

  if (hasNorthPole) {
    buildPolarCap(
      outerBase, innerBase, cols,
      0, // row index for north = row 0
      true, // isNorthPole
    );
  }

  if (hasSouthPole) {
    buildPolarCap(
      outerBase, innerBase, cols,
      rows - 1, // row index for south = last row
      false, // isNorthPole
    );
  }

  function buildPolarCap(
    outerBaseIdx: number, innerBaseIdx: number, edgeCols: number,
    rowIdx: number, isNorth: boolean,
  ): void {
    // Pole point: average of outer and inner at the pole lat
    const poleLat = isNorth ? 90 : -90;
    const poleR = (outerRadius(rowIdx, 0) + rInner) / 2; // average radius at pole
    const [px, py, pz] = sphericalToCartesian(poleLat, midLon, poleR);
    const poleVi = writeVertex(px, py, pz);

    // Edge vertices: pairs of (outer, inner) along the row
    const edgeBase = vi;
    for (let c = 0; c < edgeCols; c++) {
      const outerIdx = outerBaseIdx + rowIdx * edgeCols + c;
      writeVertex(positions[outerIdx * 3], positions[outerIdx * 3 + 1], positions[outerIdx * 3 + 2]);
      const innerIdx = innerBaseIdx + rowIdx * edgeCols + c;
      writeVertex(positions[innerIdx * 3], positions[innerIdx * 3 + 1], positions[innerIdx * 3 + 2]);
    }

    // Fan triangles connecting pole to consecutive edge pairs
    for (let c = 0; c < edgeCols - 1; c++) {
      const outerC = edgeBase + c * 2;
      const innerC = edgeBase + c * 2 + 1;
      const outerN = edgeBase + (c + 1) * 2;
      const innerN = edgeBase + (c + 1) * 2 + 1;

      if (isNorth) {
        // Outer face: pole → outerC → outerN
        indices[ii++] = poleVi; indices[ii++] = outerC; indices[ii++] = outerN;
        // Inner face: pole → innerN → innerC
        indices[ii++] = poleVi; indices[ii++] = innerN; indices[ii++] = innerC;
      } else {
        // South pole: reversed winding
        indices[ii++] = poleVi; indices[ii++] = outerN; indices[ii++] = outerC;
        indices[ii++] = poleVi; indices[ii++] = innerC; indices[ii++] = innerN;
      }
    }
  }

  // ─── Build geometry ────────────────────────────────────────────

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, vi * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices.slice(0, ii), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return { geometry, piece };
}

// ─── Tangent helpers ─────────────────────────────────────────────

/**
 * Compute unit tangent vector pointing in the +lat direction
 * at a given (lat, lon) on the sphere.
 */
function computeLatTangent(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  // d/dlat of (cos(lat)cos(lon), sin(lat), -cos(lat)sin(lon))
  const dx = -Math.sin(lat) * Math.cos(lon);
  const dy = Math.cos(lat);
  const dz = Math.sin(lat) * Math.sin(lon);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return [dx / len, dy / len, dz / len];
}

/**
 * Compute unit tangent vector pointing in the +lon direction
 * at a given (lat, lon) on the sphere.
 */
function computeLonTangent(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  // d/dlon of (cos(lat)cos(lon), sin(lat), -cos(lat)sin(lon))
  const dx = -Math.cos(lat) * Math.sin(lon);
  const dy = 0;
  const dz = -Math.cos(lat) * Math.cos(lon);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return [dx / len, dy / len, dz / len];
}
