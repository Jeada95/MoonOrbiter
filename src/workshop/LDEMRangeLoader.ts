/**
 * Partial LDEM loader using HTTP Range requests.
 *
 * Fetches only the rows needed for a lat/lon rectangle from LDEM_128.IMG
 * (46080×23040, Int16 LE, DN×0.5 = meters, row-major north→south, lon 0→360°).
 */

import { getDataUrl } from '../utils/data-paths';

// ─── Constants ──────────────────────────────────────────────────
const LDEM128_WIDTH = 46080;
const LDEM128_HEIGHT = 23040;
const LDEM128_SCALE = 0.5; // DN → meters
const BYTES_PER_SAMPLE = 2; // Int16

/** Maximum grid dimension for the extracted region */
const MAX_GRID_DIM = 2049;

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
): { data: Float32Array; width: number; height: number; stepCol: number; stepRow: number } {
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
  return { data: out, width: dstW, height: dstH, stepCol, stepRow };
}

// ─── Main extraction ────────────────────────────────────────────

/**
 * Extract a rectangular region of elevation data from LDEM_128.IMG
 * using a single HTTP Range request.
 *
 * @param latMin Southern bound (degrees, -90..90)
 * @param latMax Northern bound (degrees, -90..90)
 * @param lonMin Western bound (degrees, -180..180)
 * @param lonMax Eastern bound (degrees, -180..180)
 * @param onProgress Optional callback with a status message
 */
export async function extractLDEMRegion(
  latMin: number,
  latMax: number,
  lonMin: number,
  lonMax: number,
  onProgress?: (msg: string) => void,
): Promise<LDEMExtractResult> {
  const log = onProgress || (() => {});

  // Ensure latMin < latMax
  if (latMin > latMax) [latMin, latMax] = [latMax, latMin];

  // Convert to 0..360 longitude
  const lon0 = lonTo360(lonMin);
  const lon1 = lonTo360(lonMax);

  // Map to LDEM pixel rows (north→south: row 0 = lat +90)
  const rowStart = Math.max(0, Math.floor(((90 - latMax) / 180) * (LDEM128_HEIGHT - 1)));
  const rowEnd = Math.min(LDEM128_HEIGHT - 1, Math.ceil(((90 - latMin) / 180) * (LDEM128_HEIGHT - 1)));
  const numRows = rowEnd - rowStart + 1;

  // Map to LDEM pixel columns
  const colStart = Math.max(0, Math.floor((lon0 / 360) * (LDEM128_WIDTH - 1)));
  const colEnd = Math.min(LDEM128_WIDTH - 1, Math.ceil((lon1 / 360) * (LDEM128_WIDTH - 1)));

  // Handle antimeridian wrapping (lon0 > lon1 means crossing 360/0)
  const wraps = lon0 > lon1;
  const numCols = wraps
    ? (LDEM128_WIDTH - colStart) + (colEnd + 1)
    : (colEnd - colStart + 1);

  log(`Zone: ${numCols}×${numRows} pixels LDEM 128ppd`);

  // Fetch the full row band as a single Range request
  const bytesPerRow = LDEM128_WIDTH * BYTES_PER_SAMPLE;
  const startByte = rowStart * bytesPerRow;
  const endByte = (rowEnd + 1) * bytesPerRow - 1;
  const fetchSize = endByte - startByte + 1;

  log(`Fetching ${(fetchSize / 1024 / 1024).toFixed(1)} MB...`);

  const response = await fetch(getDataUrl('/moon-data/LDEM_128.IMG'), {
    headers: { Range: `bytes=${startByte}-${endByte}` },
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`LDEM fetch failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const band = new Int16Array(buffer);

  log('Extracting elevation data...');

  // Extract the column subset from the fetched band
  const rawData = new Float32Array(numCols * numRows);

  for (let r = 0; r < numRows; r++) {
    const bandRowOffset = r * LDEM128_WIDTH;

    if (wraps) {
      // First part: colStart → end of row
      const part1Len = LDEM128_WIDTH - colStart;
      for (let c = 0; c < part1Len; c++) {
        rawData[r * numCols + c] = band[bandRowOffset + colStart + c] * LDEM128_SCALE;
      }
      // Second part: start of row → colEnd
      for (let c = 0; c <= colEnd; c++) {
        rawData[r * numCols + part1Len + c] = band[bandRowOffset + c] * LDEM128_SCALE;
      }
    } else {
      for (let c = 0; c < numCols; c++) {
        rawData[r * numCols + c] = band[bandRowOffset + colStart + c] * LDEM128_SCALE;
      }
    }
  }

  // Downsample if grid exceeds MAX_GRID_DIM
  let finalData: Float32Array = rawData;
  let finalW = numCols;
  let finalH = numRows;

  if (numCols > MAX_GRID_DIM || numRows > MAX_GRID_DIM) {
    log(`Downsampling from ${numCols}×${numRows} to fit ${MAX_GRID_DIM}...`);
    const ds = downsample(rawData, numCols, numRows, MAX_GRID_DIM);
    finalData = ds.data;
    finalW = ds.width;
    finalH = ds.height;
  }

  log(`Grid: ${finalW}×${finalH} (${(finalData.byteLength / 1024).toFixed(0)} KB)`);

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
