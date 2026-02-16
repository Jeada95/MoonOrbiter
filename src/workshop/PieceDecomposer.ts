/**
 * Decompose a total piece count N into a (bands × sectors) grid
 * for splitting the Moon sphere into printable segments.
 *
 * Each piece covers a lat/lon rectangle on the sphere.
 * Bands = latitude divisions, Sectors = longitude divisions.
 */

// ─── Allowed piece counts (must factorize nicely) ────────────────

export const ALLOWED_PIECE_COUNTS = [2, 4, 6, 8, 9, 12, 16, 18, 24, 32] as const;

export type PieceCount = (typeof ALLOWED_PIECE_COUNTS)[number];

// ─── Types ───────────────────────────────────────────────────────

export interface PieceDecomposition {
  bands: number;
  sectors: number;
}

export interface PieceBounds {
  /** Band index (0 = southernmost) */
  band: number;
  /** Sector index (0 = starting at lon 0°) */
  sector: number;
  /** Southern boundary (degrees, -90 to +90) */
  latMin: number;
  /** Northern boundary (degrees, -90 to +90) */
  latMax: number;
  /** Western boundary (degrees, 0 to 360) */
  lonMin: number;
  /** Eastern boundary (degrees, 0 to 360) */
  lonMax: number;
  /** True if this piece contains the south pole */
  hasSouthPole: boolean;
  /** True if this piece contains the north pole */
  hasNorthPole: boolean;
}

// ─── Decomposition ───────────────────────────────────────────────

/**
 * Find the (bands, sectors) factorization of N that produces
 * the most square-like pieces (minimizes |bands - sectors|),
 * with the constraint bands ≤ sectors (wider pieces are easier to print).
 */
export function decomposePieceCount(n: number): PieceDecomposition {
  let bestBands = 1;
  let bestSectors = n;
  let bestDiff = n - 1;

  for (let b = 1; b * b <= n; b++) {
    if (n % b !== 0) continue;
    const s = n / b;
    const diff = Math.abs(b - s);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestBands = b;
      bestSectors = s;
    }
  }

  return { bands: bestBands, sectors: bestSectors };
}

// ─── Piece bounds ────────────────────────────────────────────────

/**
 * Compute the lat/lon bounds for every piece in the grid.
 * Returns an array of length bands × sectors, ordered by
 * band (south→north) then sector (west→east).
 */
export function computeAllPieceBounds(bands: number, sectors: number): PieceBounds[] {
  const latBandHeight = 180 / bands;
  const lonSectorWidth = 360 / sectors;
  const pieces: PieceBounds[] = [];

  for (let b = 0; b < bands; b++) {
    const latMin = -90 + b * latBandHeight;
    const latMax = -90 + (b + 1) * latBandHeight;

    for (let s = 0; s < sectors; s++) {
      const lonMin = s * lonSectorWidth;
      const lonMax = (s + 1) * lonSectorWidth;

      pieces.push({
        band: b,
        sector: s,
        latMin,
        latMax,
        lonMin,
        lonMax,
        hasSouthPole: latMin <= -89.99,
        hasNorthPole: latMax >= 89.99,
      });
    }
  }

  return pieces;
}

/**
 * Human-readable label for a piece, e.g. "B0 S2" or "South Pole S0".
 */
export function pieceLabel(piece: PieceBounds, totalBands: number): string {
  if (piece.hasSouthPole && piece.hasNorthPole) return `S${piece.sector}`;
  if (piece.hasSouthPole) return `South B${piece.band} S${piece.sector}`;
  if (piece.hasNorthPole) return `North B${piece.band} S${piece.sector}`;
  return `B${piece.band} S${piece.sector}`;
}
