/**
 * prepare-grids.ts — Pré-calcul des grilles d'élévation LOLA pour tout le globe lunaire.
 *
 * Télécharge les 288 tuiles COPC depuis AWS S3, rasterise à 3 résolutions,
 * sauvegarde en Float32 binaire local. Résumable (skip les tuiles déjà faites).
 *
 * Usage : npx tsx scripts/prepare-grids.ts
 *         npx tsx scripts/prepare-grids.ts --stitch-only   (stitching seul)
 */
import fs from 'fs';
import path from 'path';
import { Copc, Hierarchy } from 'copc';

// ─── Configuration ──────────────────────────────────────────────────────────
const MOON_RADIUS_M = 1737400;
const RAD2DEG = 180 / Math.PI;
const COPC_BASE_URL = 'https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/lro/lola';
const OUTPUT_DIR = 'D:/MoonOrbiterData/grids';
const RESOLUTIONS = [257, 513, 1025] as const;
const COPC_MAX_LEVEL = 3;
const CONCURRENCY = 4;
const MAX_RETRIES = 3;

// ─── Types ──────────────────────────────────────────────────────────────────
interface GeoPoint {
  lon: number;
  lat: number;
  alt: number;
}

interface TileSpec {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  name: string;
  url: string;
}

interface TileResult {
  name: string;
  status: 'ok' | 'skipped' | 'error';
  error?: string;
  pointCount?: number;
  timeMs?: number;
}

// ─── Conversion cartésien → géographique ────────────────────────────────────
function cartesianToGeo(x: number, y: number, z: number): GeoPoint {
  const radius = Math.sqrt(x * x + y * y + z * z);
  let lon = Math.atan2(y, x) * RAD2DEG;
  if (lon < 0) lon += 360;
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  const alt = radius - MOON_RADIUS_M;
  return { lon, lat, alt };
}

// ─── Rasterisation (version Node.js, sans console.log excessif) ─────────────
function rasterize(
  points: GeoPoint[],
  lonMin: number, lonMax: number,
  latMin: number, latMax: number,
  width: number, height: number,
): Float32Array {
  const data = new Float32Array(width * height).fill(NaN);
  const counts = new Uint16Array(width * height);

  const lonRange = lonMax - lonMin;
  const latRange = latMax - latMin;

  for (const pt of points) {
    const col = Math.round((pt.lon - lonMin) / lonRange * (width - 1));
    const row = Math.round((latMax - pt.lat) / latRange * (height - 1));

    if (col < 0 || col >= width || row < 0 || row >= height) continue;

    const idx = row * width + col;
    if (isNaN(data[idx])) {
      data[idx] = pt.alt;
      counts[idx] = 1;
    } else {
      counts[idx]++;
      data[idx] += (pt.alt - data[idx]) / counts[idx];
    }
  }

  // Interpolation des trous par diffusion itérative
  fillGaps(data, width, height);

  return data;
}

function fillGaps(data: Float32Array, width: number, height: number): void {
  const temp = new Float32Array(data.length);
  let remaining = 0;

  for (let iter = 0; iter < Math.max(width, height); iter++) {
    remaining = 0;
    temp.set(data);

    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        if (!isNaN(data[idx])) continue;

        let sum = 0;
        let count = 0;

        if (row > 0 && !isNaN(data[(row - 1) * width + col])) {
          sum += data[(row - 1) * width + col]; count++;
        }
        if (row < height - 1 && !isNaN(data[(row + 1) * width + col])) {
          sum += data[(row + 1) * width + col]; count++;
        }
        if (col > 0 && !isNaN(data[row * width + col - 1])) {
          sum += data[row * width + col - 1]; count++;
        }
        if (col < width - 1 && !isNaN(data[row * width + col + 1])) {
          sum += data[row * width + col + 1]; count++;
        }

        if (count > 0) {
          temp[idx] = sum / count;
        } else {
          remaining++;
        }
      }
    }

    data.set(temp);
    if (remaining === 0) break;
  }

  // Fallback : mettre 0 pour les cellules impossibles à atteindre
  for (let i = 0; i < data.length; i++) {
    if (isNaN(data[i])) data[i] = 0;
  }
}

// ─── Chargement COPC ────────────────────────────────────────────────────────
async function loadPoints(
  url: string,
  maxLevel: number,
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number },
): Promise<GeoPoint[]> {
  const copc = await Copc.create(url);
  const hierarchy = await Copc.loadHierarchyPage(url, copc.info.rootHierarchyPage);

  const points: GeoPoint[] = [];
  const nodeKeys = Object.keys(hierarchy.nodes);

  const targetNodes = nodeKeys.filter(key => {
    const level = parseInt(key.split('-')[0]);
    return level <= maxLevel;
  });

  const BATCH_SIZE = 8;
  for (let i = 0; i < targetNodes.length; i += BATCH_SIZE) {
    const batch = targetNodes.slice(i, i + BATCH_SIZE);
    const views = await Promise.all(
      batch.map(key => {
        const node = hierarchy.nodes[key];
        if (!node) throw new Error(`Node ${key} not found`);
        return Copc.loadPointDataView(url, copc, node);
      })
    );

    for (const view of views) {
      const getX = view.getter('X');
      const getY = view.getter('Y');
      const getZ = view.getter('Z');

      for (let j = 0; j < view.pointCount; j++) {
        const pt = cartesianToGeo(getX(j), getY(j), getZ(j));

        if (pt.lon < bounds.lonMin || pt.lon > bounds.lonMax) continue;
        if (pt.lat < bounds.latMin || pt.lat > bounds.latMax) continue;

        points.push(pt);
      }
    }
  }

  return points;
}

// ─── Génération du nom de fichier ───────────────────────────────────────────
function tileName(latMin: number, latMax: number, lonMin: number, lonMax: number): string {
  return `tile_${latMin}N${latMax}N_${lonMin}E${lonMax}E`;
}

function tileFilePath(name: string, resolution: number): string {
  return path.join(OUTPUT_DIR, `${resolution}`, `${name}.bin`);
}

// ─── Énumération des 288 tuiles ─────────────────────────────────────────────
function enumerateTiles(): TileSpec[] {
  const tiles: TileSpec[] = [];

  for (let latMin = -90; latMin < 90; latMin += 15) {
    const latMax = latMin + 15;
    for (let lonMin = 0; lonMin < 360; lonMin += 15) {
      const lonMax = lonMin + 15;
      const name = tileName(latMin, latMax, lonMin, lonMax);
      const latStr = `${latMin}N${latMax}N`;
      const lonStr = `${lonMin}E${lonMax}E`;
      const url = `${COPC_BASE_URL}/LolaRDR_${latStr}_${lonStr}.copc.laz`;
      tiles.push({ latMin, latMax, lonMin, lonMax, name, url });
    }
  }

  return tiles;
}

// ─── Traitement d'une tuile ─────────────────────────────────────────────────
async function processTile(tile: TileSpec): Promise<TileResult> {
  // Vérifier si tous les fichiers existent déjà
  const allExist = RESOLUTIONS.every(res => fs.existsSync(tileFilePath(tile.name, res)));
  if (allExist) {
    return { name: tile.name, status: 'skipped' };
  }

  const t0 = performance.now();

  // Charger les points COPC (level 3)
  const bounds = {
    lonMin: tile.lonMin,
    lonMax: tile.lonMax,
    latMin: tile.latMin,
    latMax: tile.latMax,
  };

  const points = await loadPoints(tile.url, COPC_MAX_LEVEL, bounds);

  if (points.length === 0) {
    return { name: tile.name, status: 'error', error: 'Aucun point chargé' };
  }

  // Rasteriser aux 3 résolutions
  for (const res of RESOLUTIONS) {
    const filePath = tileFilePath(tile.name, res);
    if (fs.existsSync(filePath)) continue;

    const data = rasterize(
      points,
      tile.lonMin, tile.lonMax,
      tile.latMin, tile.latMax,
      res, res,
    );

    // Écrire le fichier binaire Float32
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data.buffer));
  }

  const timeMs = performance.now() - t0;
  return { name: tile.name, status: 'ok', pointCount: points.length, timeMs };
}

// ─── Traitement avec retry ──────────────────────────────────────────────────
async function processTileWithRetry(tile: TileSpec): Promise<TileResult> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await processTile(tile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        process.stdout.write(`  ⚠ ${tile.name} échec #${attempt}: ${msg} — retry dans ${delay / 1000}s\n`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        return { name: tile.name, status: 'error', error: `${MAX_RETRIES} échecs: ${msg}` };
      }
    }
  }
  // Unreachable but TypeScript needs it
  return { name: tile.name, status: 'error', error: 'Unexpected' };
}

// ─── Stitching des bords entre tuiles adjacentes ────────────────────────────
function stitchBorders(tiles: TileSpec[], resolution: number): void {
  console.log(`\n🧵 Stitching des bords (${resolution}×${resolution})...`);

  // Créer un index lat/lon → tile
  const tileMap = new Map<string, TileSpec>();
  for (const t of tiles) {
    tileMap.set(`${t.latMin},${t.lonMin}`, t);
  }

  let stitchCount = 0;

  for (const tile of tiles) {
    const filePath = tileFilePath(tile.name, resolution);
    if (!fs.existsSync(filePath)) continue;

    const buf = fs.readFileSync(filePath);
    const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

    let modified = false;

    // Voisin de droite (même lat, lon + 15)
    const rightLon = tile.lonMax >= 360 ? 0 : tile.lonMax;
    const rightKey = `${tile.latMin},${rightLon}`;
    const rightTile = tileMap.get(rightKey);
    if (rightTile) {
      const rightPath = tileFilePath(rightTile.name, resolution);
      if (fs.existsSync(rightPath)) {
        const rBuf = fs.readFileSync(rightPath);
        const rData = new Float32Array(rBuf.buffer, rBuf.byteOffset, rBuf.byteLength / 4);

        // Colonne droite de tile ↔ colonne gauche de rightTile
        for (let row = 0; row < resolution; row++) {
          const leftIdx = row * resolution + (resolution - 1); // dernière colonne
          const rightIdx = row * resolution;                    // première colonne
          const avg = (data[leftIdx] + rData[rightIdx]) / 2;
          data[leftIdx] = avg;
          rData[rightIdx] = avg;
        }

        fs.writeFileSync(rightPath, Buffer.from(rData.buffer));
        modified = true;
        stitchCount++;
      }
    }

    // Voisin du haut (lat + 15, même lon)
    // Note : dans notre grille, row 0 = latMax (nord), dernière row = latMin (sud)
    // Donc le voisin du haut (lat +15) partage sa dernière row avec notre première row
    const topLat = tile.latMax;
    if (topLat < 90) {
      const topKey = `${topLat},${tile.lonMin}`;
      const topTile = tileMap.get(topKey);
      if (topTile) {
        const topPath = tileFilePath(topTile.name, resolution);
        if (fs.existsSync(topPath)) {
          const tBuf = fs.readFileSync(topPath);
          const tData = new Float32Array(tBuf.buffer, tBuf.byteOffset, tBuf.byteLength / 4);

          // Première ligne de tile ↔ dernière ligne de topTile
          for (let col = 0; col < resolution; col++) {
            const topIdx = (resolution - 1) * resolution + col; // dernière ligne du top
            const botIdx = col;                                   // première ligne de tile
            const avg = (data[botIdx] + tData[topIdx]) / 2;
            data[botIdx] = avg;
            tData[topIdx] = avg;
          }

          fs.writeFileSync(topPath, Buffer.from(tData.buffer));
          modified = true;
          stitchCount++;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(filePath, Buffer.from(data.buffer));
    }
  }

  console.log(`  ✅ ${stitchCount} jonctions raccordées (${resolution}×${resolution})`);
}

// ─── Pool de concurrence ────────────────────────────────────────────────────
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress: (result: R, index: number, total: number, elapsed: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const t0 = performance.now();

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      const result = await fn(items[idx], idx);
      results[idx] = result;
      onProgress(result, idx, items.length, performance.now() - t0);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// ─── Formatage du temps ─────────────────────────────────────────────────────
function formatTime(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec.toString().padStart(2, '0')}s`;
}

// ─── Point d'entrée ─────────────────────────────────────────────────────────
async function main() {
  const stitchOnly = process.argv.includes('--stitch-only');

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    MoonOrbiter — Préparation des grilles LOLA   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();

  const tiles = enumerateTiles();
  console.log(`📦 ${tiles.length} tuiles (${12} bandes lat × ${24} bandes lon)`);
  console.log(`📐 Résolutions : ${RESOLUTIONS.join(', ')}`);
  console.log(`📁 Sortie : ${OUTPUT_DIR}`);
  console.log();

  // Créer les dossiers de sortie
  for (const res of RESOLUTIONS) {
    const dir = path.join(OUTPUT_DIR, `${res}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  if (!stitchOnly) {
    // ─── Phase 1 : Téléchargement + rasterisation ─────────────────────────
    console.log(`🚀 Phase 1 : Téléchargement COPC (level ${COPC_MAX_LEVEL}) + rasterisation`);
    console.log(`   Concurrence : ${CONCURRENCY} tuiles en parallèle`);
    console.log();

    let doneCount = 0;
    let skipCount = 0;
    let errCount = 0;

    const results = await runWithConcurrency(
      tiles,
      CONCURRENCY,
      (tile) => processTileWithRetry(tile),
      (result, _idx, total, elapsed) => {
        doneCount++;
        if (result.status === 'skipped') skipCount++;
        if (result.status === 'error') errCount++;

        const pct = (doneCount / total * 100).toFixed(1);
        const eta = doneCount > 0 ? formatTime(elapsed / doneCount * (total - doneCount)) : '?';

        const statusIcon =
          result.status === 'ok' ? '✅' :
          result.status === 'skipped' ? '⏭️' : '❌';

        const detail =
          result.status === 'ok'
            ? `${result.pointCount?.toLocaleString()} pts | ${formatTime(result.timeMs!)}`
            : result.status === 'error'
            ? result.error
            : 'déjà fait';

        process.stdout.write(
          `[${doneCount.toString().padStart(3)}/${total}] ${pct.padStart(5)}% ${statusIcon} ${result.name} | ${detail} | ETA: ${eta}\n`
        );
      },
    );

    console.log();
    console.log(`📊 Résumé Phase 1 :`);
    console.log(`   ✅ OK      : ${doneCount - skipCount - errCount}`);
    console.log(`   ⏭️  Skipped : ${skipCount}`);
    console.log(`   ❌ Erreurs : ${errCount}`);

    if (errCount > 0) {
      console.log('\n⚠ Tuiles en erreur :');
      for (const r of results) {
        if (r.status === 'error') {
          console.log(`   ${r.name}: ${r.error}`);
        }
      }
    }
  }

  // ─── Phase 2 : Stitching des bords ────────────────────────────────────
  console.log('\n🔗 Phase 2 : Raccordement des bords entre tuiles');

  for (const res of RESOLUTIONS) {
    stitchBorders(tiles, res);
  }

  // ─── Phase 3 : Manifest ───────────────────────────────────────────────
  console.log('\n📝 Phase 3 : Écriture du manifest');

  const manifest = {
    version: 1,
    date: new Date().toISOString(),
    tileCount: tiles.length,
    resolutions: [...RESOLUTIONS],
    copcLevel: COPC_MAX_LEVEL,
    tiles: tiles.map(t => {
      const files: Record<number, { exists: boolean; sizeKB: number }> = {};
      for (const res of RESOLUTIONS) {
        const fp = tileFilePath(t.name, res);
        const exists = fs.existsSync(fp);
        const sizeKB = exists ? Math.round(fs.statSync(fp).size / 1024) : 0;
        files[res] = { exists, sizeKB };
      }
      return {
        name: t.name,
        bounds: { latMin: t.latMin, latMax: t.latMax, lonMin: t.lonMin, lonMax: t.lonMax },
        files,
      };
    }),
  };

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  ✅ ${manifestPath}`);

  // Statistiques finales
  let totalSizeKB = 0;
  for (const res of RESOLUTIONS) {
    let resSizeKB = 0;
    const dir = path.join(OUTPUT_DIR, `${res}`);
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        resSizeKB += Math.round(fs.statSync(path.join(dir, f)).size / 1024);
      }
    }
    console.log(`  📁 ${res}×${res} : ${(resSizeKB / 1024).toFixed(1)} MB`);
    totalSizeKB += resSizeKB;
  }
  console.log(`  📦 Total : ${(totalSizeKB / 1024).toFixed(1)} MB`);

  console.log('\n🎉 Préparation terminée !');
}

main().catch(err => {
  console.error('\n💥 Erreur fatale:', err);
  process.exit(1);
});
