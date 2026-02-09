/**
 * prepare-grids-ldem.ts — Découpe les LDEM globaux en tuiles Float32 pour le maillage adaptatif.
 *
 * Sources :
 *   - LDEM_64.IMG  (23040×11520, Int16 LE, 64ppd)  → résolutions 513, 1025
 *   - LDEM_128.IMG (46080×23040, Int16 LE, 128ppd) → résolution 2049
 *
 * altitude_m = DN × 0.5
 *
 * Produit 288 tuiles (15°×15°) × 3 résolutions au format Float32 binaire
 * dans D:\MoonOrbiterData\grids\
 *
 * Pas de stitching — les tuiles sont extraites de la même grille globale continue,
 * les bords partagent naturellement les mêmes valeurs d'élévation.
 *
 * Usage : npx tsx scripts/prepare-grids-ldem.ts
 */
import fs from 'fs';
import path from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
const OUTPUT_DIR = 'D:/MoonOrbiterData/grids';
const LDEM_SCALE = 0.5;     // DN × 0.5 = altitude en mètres
const TILE_DEG = 15;

// Définition des sources LDEM et des résolutions qu'elles servent
interface LdemSource {
  path: string;
  width: number;
  height: number;
  ppd: number;
  resolutions: number[];
}

const LDEM_SOURCES: LdemSource[] = [
  {
    path: 'D:/MoonOrbiterData/raw/LDEM_64.IMG',
    width: 23040,
    height: 11520,
    ppd: 64,
    resolutions: [513, 1025],
  },
  {
    path: 'D:/MoonOrbiterData/raw/LDEM_128.IMG',
    width: 46080,
    height: 23040,
    ppd: 128,
    resolutions: [2049],
  },
];

// ─── Lecture d'un LDEM ──────────────────────────────────────────────────────
function loadLDEM(source: LdemSource): Int16Array {
  console.log(`📂 Lecture de ${source.path}...`);
  const expectedSize = source.width * source.height * 2;
  const buf = fs.readFileSync(source.path);
  if (buf.length !== expectedSize) {
    throw new Error(
      `Taille inattendue: ${buf.length} octets (attendu ${expectedSize})`
    );
  }
  return new Int16Array(buf.buffer, buf.byteOffset, source.width * source.height);
}

// ─── Extraction et rééchantillonnage bilinéaire ─────────────────────────────
function extractTile(
  ldem: Int16Array,
  ldemWidth: number,
  ldemHeight: number,
  ldemPPD: number,
  lonMinDeg: number,
  latMinDeg: number,
  outputSize: number,
): Float32Array {
  const latMaxDeg = latMinDeg + TILE_DEG;
  const tilePix = ldemPPD * TILE_DEG; // pixels natifs par tuile

  // Coordonnées pixel dans le LDEM global
  // Ligne 0 = lat +90° (pôle nord), colonne 0 = lon 0°
  const colStart = lonMinDeg * ldemPPD;
  const rowStart = (90 - latMaxDeg) * ldemPPD;

  const result = new Float32Array(outputSize * outputSize);

  for (let outRow = 0; outRow < outputSize; outRow++) {
    for (let outCol = 0; outCol < outputSize; outCol++) {
      // Position fractionnelle dans la tuile source
      const srcRowF = (outRow / (outputSize - 1)) * (tilePix - 1);
      const srcColF = (outCol / (outputSize - 1)) * (tilePix - 1);

      // Interpolation bilinéaire
      const r0 = Math.floor(srcRowF);
      const c0 = Math.floor(srcColF);
      const r1 = Math.min(r0 + 1, tilePix - 1);
      const c1 = Math.min(c0 + 1, tilePix - 1);
      const fr = srcRowF - r0;
      const fc = srcColF - c0;

      const gr0 = rowStart + r0;
      const gr1 = rowStart + r1;
      const gc0 = colStart + c0;
      const gc1 = colStart + c1;

      // Clamp aux limites du LDEM
      const v00 = ldem[Math.min(gr0, ldemHeight - 1) * ldemWidth + Math.min(gc0, ldemWidth - 1)];
      const v01 = ldem[Math.min(gr0, ldemHeight - 1) * ldemWidth + Math.min(gc1, ldemWidth - 1)];
      const v10 = ldem[Math.min(gr1, ldemHeight - 1) * ldemWidth + Math.min(gc0, ldemWidth - 1)];
      const v11 = ldem[Math.min(gr1, ldemHeight - 1) * ldemWidth + Math.min(gc1, ldemWidth - 1)];

      const dn = v00 * (1 - fr) * (1 - fc) + v01 * (1 - fr) * fc
               + v10 * fr * (1 - fc) + v11 * fr * fc;

      result[outRow * outputSize + outCol] = dn * LDEM_SCALE;
    }
  }

  return result;
}

// ─── Formatage du temps ─────────────────────────────────────────────────────
function formatTime(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m${sec.toString().padStart(2, '0')}s`;
}

// ─── Point d'entrée ─────────────────────────────────────────────────────────
function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  MoonOrbiter — Découpe LDEM → tuiles adaptatives ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();

  const allResolutions: number[] = [];
  for (const src of LDEM_SOURCES) {
    allResolutions.push(...src.resolutions);
  }

  // Créer les dossiers
  for (const res of allResolutions) {
    const dir = path.join(OUTPUT_DIR, String(res));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  const t0 = performance.now();
  const totalTiles = (180 / TILE_DEG) * (360 / TILE_DEG);

  // Traiter chaque source LDEM
  for (const source of LDEM_SOURCES) {
    // Vérifier que le fichier existe
    if (!fs.existsSync(source.path)) {
      console.log(`⚠️  ${source.path} introuvable — résolutions ${source.resolutions.join(', ')} ignorées`);
      continue;
    }

    const tLoad = performance.now();
    const ldem = loadLDEM(source);
    console.log(`  ✅ LDEM ${source.ppd}ppd chargé en ${formatTime(performance.now() - tLoad)} (${(ldem.length * 2 / 1024 / 1024).toFixed(0)} MB)`);
    console.log();

    console.log(`🔪 Découpe de ${totalTiles} tuiles × résolutions [${source.resolutions.join(', ')}]...`);
    console.log();

    let done = 0;
    const tStart = performance.now();

    for (let latMin = -90; latMin < 90; latMin += TILE_DEG) {
      for (let lonMin = 0; lonMin < 360; lonMin += TILE_DEG) {
        const latMax = latMin + TILE_DEG;
        const lonMax = lonMin + TILE_DEG;
        const tileName = `tile_${latMin}N${latMax}N_${lonMin}E${lonMax}E`;

        for (const res of source.resolutions) {
          const filePath = path.join(OUTPUT_DIR, String(res), `${tileName}.bin`);
          const data = extractTile(ldem, source.width, source.height, source.ppd, lonMin, latMin, res);
          fs.writeFileSync(filePath, Buffer.from(data.buffer));
        }

        done++;
        if (done % 24 === 0 || done === totalTiles) {
          const elapsed = performance.now() - tStart;
          const eta = done > 0 ? formatTime(elapsed / done * (totalTiles - done)) : '?';
          const pct = (done / totalTiles * 100).toFixed(1);
          process.stdout.write(
            `  [${done.toString().padStart(3)}/${totalTiles}] ${pct}% | ETA: ${eta}\n`
          );
        }
      }
    }
    console.log();
  }

  // Manifest
  console.log('📝 Manifest...');
  const manifest = {
    version: 4,
    sources: LDEM_SOURCES
      .filter(s => fs.existsSync(s.path))
      .map(s => ({
        file: path.basename(s.path),
        ppd: s.ppd,
        resolutions: s.resolutions,
      })),
    date: new Date().toISOString(),
    tileCount: totalTiles,
    tileDeg: TILE_DEG,
    resolutions: allResolutions,
    scalingFactor: LDEM_SCALE,
    notes: 'Sans stitching — grille globale continue. LDEM 64ppd → 513/1025, LDEM 128ppd → 2049.',
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Stats finales
  for (const res of allResolutions) {
    const dir = path.join(OUTPUT_DIR, String(res));
    if (!fs.existsSync(dir)) continue;
    let resKB = 0;
    for (const f of fs.readdirSync(dir)) {
      resKB += fs.statSync(path.join(dir, f)).size / 1024;
    }
    console.log(`  📁 ${res}×${res} : ${(resKB / 1024).toFixed(1)} MB`);
  }
  console.log(`  ⏱ Temps total : ${formatTime(performance.now() - t0)}`);
  console.log();
  console.log('🎉 Terminé !');
}

main();
