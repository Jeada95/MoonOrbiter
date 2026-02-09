/**
 * Convertit les TIF LOLA 16-bit en fichiers binaires Float32
 * contenant les altitudes réelles en mètres.
 *
 * Format de sortie : fichier .bin, Float32 little-endian
 * Chaque pixel = altitude en mètres par rapport au rayon moyen (1737.4 km)
 * Layout : row-major, lat de nord (row 0) à sud (row H-1), lon de 0° (col 0) à 360° (col W-1)
 *
 * Usage : node scripts/convert_lola.mjs
 */
import sharp from 'sharp';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';

// Sources TIF LOLA (16-bit unsigned)
const SOURCES = [
  {
    tif: join(DATA_DIR, 'raw', 'ldem_16_uint.tif'),
    out: join(DATA_DIR, 'lola_elevation_16ppd.bin'),
    label: '16ppd',
  },
  {
    tif: join(DATA_DIR, 'raw', 'ldem_4_uint.tif'),
    out: join(DATA_DIR, 'lola_elevation_4ppd.bin'),
    label: '4ppd',
  },
];

async function convertTif(source) {
  console.log(`\n=== ${source.label} ===`);

  if (!existsSync(source.tif)) {
    console.log(`  SKIP: ${source.tif} introuvable`);
    return;
  }

  // Lire le TIF en 16-bit unsigned raw
  const rawBuf = await sharp(source.tif)
    .toColourspace('grey16')
    .raw({ depth: 'ushort' })
    .toBuffer();

  const meta = await sharp(source.tif).metadata();
  const width = meta.width;
  const height = meta.height;
  const pixelCount = width * height;

  console.log(`  Source: ${width}x${height}, ${rawBuf.length} bytes`);

  // Interpréter comme Uint16Array
  const u16 = new Uint16Array(rawBuf.buffer, rawBuf.byteOffset, pixelCount);

  // Trouver min/max
  let minDN = Infinity, maxDN = -Infinity;
  for (let i = 0; i < u16.length; i++) {
    if (u16[i] < minDN) minDN = u16[i];
    if (u16[i] > maxDN) maxDN = u16[i];
  }
  console.log(`  DN range: ${minDN} - ${maxDN}`);

  // Calibration empirique basée sur les altitudes connues de la Lune
  // min altitude ≈ -9130 m (South Pole-Aitken basin)
  // max altitude ≈ +10786 m (near Leibnitz/Engel'gardt)
  const KNOWN_MIN_M = -9130;
  const KNOWN_MAX_M = 10786;
  const scale = (KNOWN_MAX_M - KNOWN_MIN_M) / (maxDN - minDN);
  const offset = minDN - KNOWN_MIN_M / scale;

  console.log(`  Calibration: scale=${scale.toFixed(6)}, offset=${offset.toFixed(1)}`);
  console.log(`  Formula: elevation_m = (DN - ${offset.toFixed(1)}) * ${scale.toFixed(6)}`);

  // Convertir en Float32 (altitudes en mètres)
  const f32 = new Float32Array(pixelCount);
  let minElev = Infinity, maxElev = -Infinity;

  for (let i = 0; i < pixelCount; i++) {
    const elevM = (u16[i] - offset) * scale;
    f32[i] = elevM;
    if (elevM < minElev) minElev = elevM;
    if (elevM > maxElev) maxElev = elevM;
  }

  console.log(`  Elevation range: ${minElev.toFixed(1)} m - ${maxElev.toFixed(1)} m`);
  console.log(`  = ${(minElev / 1000).toFixed(3)} km - ${(maxElev / 1000).toFixed(3)} km`);

  // Écrire le fichier binaire
  writeFileSync(source.out, Buffer.from(f32.buffer));
  const sizeMB = (f32.byteLength / 1024 / 1024).toFixed(1);
  console.log(`  Fichier: ${source.out} (${sizeMB} MB)`);

  // Écrire un fichier JSON de métadonnées
  const metaJson = {
    width,
    height,
    format: 'float32',
    unit: 'meters',
    reference: 'altitude relative au rayon moyen (1737.4 km)',
    minElevation: minElev,
    maxElevation: maxElev,
    scale,
    offset,
  };
  writeFileSync(
    source.out.replace('.bin', '.json'),
    JSON.stringify(metaJson, null, 2)
  );
  console.log(`  Métadonnées: ${source.out.replace('.bin', '.json')}`);
}

async function main() {
  console.log('=== Conversion des données LOLA en altitudes réelles ===');

  for (const source of SOURCES) {
    await convertTif(source);
  }

  console.log('\n=== Terminé ===');
}

main().catch((err) => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
