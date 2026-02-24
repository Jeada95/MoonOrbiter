/**
 * Grid-based elevation extractor for the Workshop.
 *
 * Replaces the former LDEM_128.IMG Range-request loader.
 * Loads pre-computed grid tiles (Int16 or Float32) via LocalGridLoader,
 * stitches them together, crops to the requested lat/lon rectangle,
 * and downsamples if needed.
 *
 * The function signature and return type are kept identical so that
 * BrickMeshBuilder and main.ts need no changes.
 */

import { LocalGridLoader, type GridResolution } from '../adaptive/LocalGridLoader';
import { GRID_RESOLUTIONS } from '../utils/config';
import { getAvailableGrids } from '../utils/data-paths';

// ─── Constants ──────────────────────────────────────────────────
const TILE_DEG = 15;

/** Maximum output grid dimension (WebGL / STL vertex budget) */
const MAX_GRID_DIM = 2049;

/** Shared loader instance — benefits from LRU cache across Workshop calls */
const gridLoader = new LocalGridLoader(30);

// ─── Types ──────────────────────────────────────────────────────

export interface LDEMExtractResult {
  /** Elevation in meters, row-major, north→south */
  data: Float32Array;
  /** Grid columns (east-west) */
  width: number;
  /** Grid rows (north-south) */
  height: number;
  /** Geographic bounds (degrees) */
  latMin: number;
  latMax: number;
  lonMin: number; // -180..180
  lonMax: number;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Convert longitude from -180..180 to 0..360 convention */
function lonTo360(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

/**
 * Downsample a Float32Array grid by taking every Nth sample.
 * Returns a new grid that fits within maxDim × maxDim.
 */
function downsample(
  data: Float32Array, srcW: number, srcH: number, maxDim: number,
): { data: Float32Array; width: number; height: number } {
  const stepCol = Math.ceil(srcW / maxDim);
  const stepRow = Math.ceil(srcH / maxDim);
  const dstW = Math.ceil(srcW / stepCol);
  const dstH = Math.ceil(srcH / stepRow);
  const out = new Float32Array(dstW * dstH);
  for (let dr = 0; dr < dstH; dr++) {
    const sr = Math.min(dr * stepRow, srcH - 1);
    for (let dc = 0; dc < dstW; dc++) {
      const sc = Math.min(dc * stepCol, srcW - 1);
      out[dr * dstW + dc] = data[sr * srcW + sc];
    }
  }
  return { data: out, width: dstW, height: dstH };
}

/**
 * Choose the best grid resolution for the requested region,
 * constrained to resolutions that are actually installed on disk.
 *
 * Throws a descriptive error if no grids are installed at all.
 */
function chooseResolution(latSpan: number, lonSpan: number, maxOutputDim: number): GridResolution {
  // Filter GRID_RESOLUTIONS by what's actually installed
  const installed = getAvailableGrids();
  const available = GRID_RESOLUTIONS.filter(r => installed.includes(r));

  if (available.length === 0) {
    throw new Error(
      'NO_GRID_DATA: No grid data installed. ' +
      'Download data packs via the Data Manager (📦 button in the menu).'
    );
  }

  const maxSpan = Math.max(latSpan, lonSpan);
  const tilesAcross = Math.ceil(maxSpan / TILE_DEG);
  const maxRes = available[available.length - 1];

  // If the output will be capped to a small dimension, use the lowest resolution
  // that still provides enough pixels for the output.
  if (maxOutputDim < MAX_GRID_DIM) {
    const neededPerTile = Math.ceil(maxOutputDim / tilesAcross) + 1;
    for (const res of available) {
      if (res >= neededPerTile) return res as GridResolution;
    }
    return maxRes as GridResolution;
  }

  if (tilesAcross > 4) {
    // Large region: prefer 1025 if available
    return (available.includes(1025) ? 1025 : maxRes) as GridResolution;
  }
  return maxRes as GridResolution;
}

// ─── Main extraction ────────────────────────────────────────────

/**
 * Extract a rectangular region of elevation data from pre-computed grid tiles.
 *
 * Drop-in replacement for the former LDEM_128 Range-request version.
 * Same signature, same return type.
 *
 * @param latMin Southern bound (degrees, -90..90)
 * @param latMax Northern bound (degrees, -90..90)
 * @param lonMin Western bound (degrees, -180..180)
 * @param lonMax Eastern bound (degrees, -180..180)
 * @param onProgress Optional callback with a status message
 * @param maxDim Maximum output grid dimension (defaults to MAX_GRID_DIM=2049).
 *   Pass a smaller value (e.g. 513) for Full Moon Print to limit memory.
 */
export async function extractLDEMRegion(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  onProgress?: (msg: string) => void,
  maxDim?: number,
): Promise<LDEMExtractResult> {
  const log = onProgress || (() => {});
  const effectiveMaxDim = maxDim ?? MAX_GRID_DIM;

  // Ensure latMin < latMax
  if (latMin > latMax) [latMin, latMax] = [latMax, latMin];

  // Convert to 0..360 for grid tile lookup
  const lon0 = lonTo360(lonMin);
  const lon1 = lonTo360(lonMax);

  // Handle antimeridian wrapping (lon0 > lon1 in 0..360 means crossing 0/360)
  const wraps = lon0 > lon1;
  const lonSpan = wraps ? (360 - lon0 + lon1) : (lon1 - lon0);
  const latSpan = latMax - latMin;

  // Choose grid resolution
  const resolution = chooseResolution(latSpan, lonSpan, effectiveMaxDim);
  const ppd = (resolution - 1) / TILE_DEG; // effective pixels per degree

  // ─── Identify covering tiles ──────────────────────────────────

  // Latitude tiles (sorted south → north)
  const tileLats: number[] = [];
  const tileLatStart = Math.floor(latMin / TILE_DEG) * TILE_DEG;
  // Use small epsilon so latMax exactly on tile boundary doesn't add extra tile
  const tileLatEnd = Math.floor((latMax - 0.0001) / TILE_DEG) * TILE_DEG;
  for (let lat = tileLatStart; lat <= tileLatEnd; lat += TILE_DEG) {
    tileLats.push(lat);
  }

  // Longitude tiles (in 0..360 space)
  const tileLons: number[] = [];
  if (wraps) {
    // From lon0 tile to 345°, then from 0° to lon1 tile
    const startTile = Math.floor(lon0 / TILE_DEG) * TILE_DEG;
    for (let lon = startTile; lon < 360; lon += TILE_DEG) {
      tileLons.push(lon);
    }
    const endTile = Math.floor((lon1 - 0.0001) / TILE_DEG) * TILE_DEG;
    for (let lon = 0; lon <= endTile; lon += TILE_DEG) {
      tileLons.push(lon);
    }
  } else {
    const startTile = Math.floor(lon0 / TILE_DEG) * TILE_DEG;
    const endTile = Math.floor((lon1 - 0.0001) / TILE_DEG) * TILE_DEG;
    for (let lon = startTile; lon <= endTile; lon += TILE_DEG) {
      tileLons.push(lon);
    }
  }

  const totalTiles = tileLats.length * tileLons.length;
  log(`Chargement ${totalTiles} tuile(s) ${resolution}×${resolution}...`);

  // ─── Load all tiles ───────────────────────────────────────────

  type TileEntry = { latMin: number; lonMin: number; data: Float32Array };
  const tiles: TileEntry[] = [];

  const promises: Promise<void>[] = [];
  for (const tLat of tileLats) {
    for (const tLon of tileLons) {
      promises.push(
        gridLoader.loadGrid(tLat, tLon, resolution).then(grid => {
          tiles.push({ latMin: tLat, lonMin: tLon, data: grid.data });
        })
      );
    }
  }
  await Promise.all(promises);

  log(`${tiles.length} tuile(s) chargée(s), assemblage...`);

  // ─── Stitch tiles into a unified grid ─────────────────────────

  const numTilesLat = tileLats.length;
  const numTilesLon = tileLons.length;
  // Adjacent tiles share one boundary row/col → stride = (resolution - 1)
  const stitchedRows = numTilesLat * (resolution - 1) + 1;
  const stitchedCols = numTilesLon * (resolution - 1) + 1;

  // Geographic extent of stitched area
  const stitchedLatMin = tileLats[0];
  const stitchedLatMax = tileLats[numTilesLat - 1] + TILE_DEG;
  const stitchedLon0 = tileLons[0]; // in 0..360

  const stitched = new Float32Array(stitchedRows * stitchedCols);

  // Fill stitched grid — row 0 = north (stitchedLatMax)
  for (const tile of tiles) {
    const tLatIdx = tileLats.indexOf(tile.latMin);
    const tLonIdx = tileLons.indexOf(tile.lonMin);

    // In stitched grid (north at top): northernmost tile = row 0
    const rowOffset = (numTilesLat - 1 - tLatIdx) * (resolution - 1);
    const colOffset = tLonIdx * (resolution - 1);

    for (let r = 0; r < resolution; r++) {
      const dstRow = rowOffset + r;
      const srcBase = r * resolution;
      const dstBase = dstRow * stitchedCols + colOffset;
      for (let c = 0; c < resolution; c++) {
        stitched[dstBase + c] = tile.data[srcBase + c];
      }
    }
  }

  // ─── Crop & interpolate to exact requested bounds ─────────────

  let outCols = Math.round(lonSpan * ppd) + 1;
  let outRows = Math.round(latSpan * ppd) + 1;

  // Clamp to reasonable size before potential downsample
  outCols = Math.max(2, outCols);
  outRows = Math.max(2, outRows);

  const rawData = new Float32Array(outRows * outCols);

  // Stitched lon span in degrees
  const stitchedLonSpan = numTilesLon * TILE_DEG;

  for (let r = 0; r < outRows; r++) {
    // Latitude of this output row (north at top)
    const lat = latMax - (r / (outRows - 1)) * latSpan;
    // Fractional row in stitched grid
    const stitchedRowF = ((stitchedLatMax - lat) / (stitchedLatMax - stitchedLatMin))
      * (stitchedRows - 1);

    for (let c = 0; c < outCols; c++) {
      // Longitude of this output column (in 0..360)
      let lon360: number;
      if (wraps) {
        lon360 = (lon0 + (c / (outCols - 1)) * lonSpan) % 360;
      } else {
        lon360 = lon0 + (c / (outCols - 1)) * lonSpan;
      }

      // Fractional col in stitched grid
      let lonFromStart = lon360 - stitchedLon0;
      if (wraps && lonFromStart < 0) lonFromStart += 360;
      const stitchedColF = (lonFromStart / stitchedLonSpan) * (stitchedCols - 1);

      // Bilinear interpolation
      const r0 = Math.floor(stitchedRowF);
      const r1 = Math.min(r0 + 1, stitchedRows - 1);
      const c0 = Math.floor(stitchedColF);
      const c1 = Math.min(c0 + 1, stitchedCols - 1);
      const fr = stitchedRowF - r0;
      const fc = stitchedColF - c0;

      rawData[r * outCols + c] =
        stitched[r0 * stitchedCols + c0] * (1 - fr) * (1 - fc) +
        stitched[r0 * stitchedCols + c1] * (1 - fr) * fc +
        stitched[r1 * stitchedCols + c0] * fr * (1 - fc) +
        stitched[r1 * stitchedCols + c1] * fr * fc;
    }
  }

  // ─── Downsample if needed ─────────────────────────────────────

  let finalData: Float32Array = rawData;
  let finalW = outCols;
  let finalH = outRows;

  if (outCols > effectiveMaxDim || outRows > effectiveMaxDim) {
    log(`Sous-échantillonnage de ${outCols}×${outRows}...`);
    const ds = downsample(rawData, outCols, outRows, effectiveMaxDim);
    finalData = ds.data as Float32Array;
    finalW = ds.width;
    finalH = ds.height;
  }

  log(`Grille: ${finalW}×${finalH} (${(finalData.byteLength / 1024).toFixed(0)} KB)`);

  return {
    data: finalData,
    width: finalW,
    height: finalH,
    latMin,
    latMax,
    lonMin,
    lonMax,
  };
}
