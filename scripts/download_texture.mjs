/**
 * Télécharge les données lunaires depuis NASA SVS (CGI Moon Kit) et les convertit.
 * - Texture couleur LROC → JPG 2K/4K
 * - Élévation LOLA → PNG grayscale 8-bit (displacement map)
 * Source : https://svs.gsfc.nasa.gov/4720/
 */
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import sharp from 'sharp';
import { join } from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const RAW_DIR = join(DATA_DIR, 'raw');

// --- Texture couleur (LROC) ---
const TEXTURE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif';
const TIF_PATH = join(RAW_DIR, 'lroc_color_poles_8k.tif');
const JPG_4K_PATH = join(DATA_DIR, 'moon_texture_4k.jpg');
const JPG_2K_PATH = join(DATA_DIR, 'moon_texture_2k.jpg');

// --- Élévation (LOLA) ---
const ELEV_BASE_URL = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';
const ELEV_FILES = [
  {
    name: 'ldem_4_uint.tif',
    url: ELEV_BASE_URL + 'ldem_4_uint.tif',
    tifPath: join(RAW_DIR, 'ldem_4_uint.tif'),
    pngPath: join(DATA_DIR, 'moon_displacement_4ppd.png'),
    normalPath: join(DATA_DIR, 'moon_normal_4ppd.png'),
    description: '4 ppd (fallback rapide, ~2 Mo)',
  },
  {
    name: 'ldem_16_uint.tif',
    url: ELEV_BASE_URL + 'ldem_16_uint.tif',
    tifPath: join(RAW_DIR, 'ldem_16_uint.tif'),
    pngPath: join(DATA_DIR, 'moon_displacement_16ppd.png'),
    normalPath: join(DATA_DIR, 'moon_normal_16ppd.png'),
    description: '16 ppd (production, ~32 Mo)',
  },
];

async function downloadFile(url, destPath) {
  console.log(`  Téléchargement depuis ${url}...`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentLength = response.headers.get('content-length');
  const totalMB = contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(1) : '?';
  console.log(`  Taille: ${totalMB} Mo`);

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
  console.log(`  Sauvegardé: ${destPath}`);
}

async function convertToJpg(tifPath, jpgPath, width) {
  console.log(`  Conversion en JPG ${width}px...`);
  await sharp(tifPath)
    .resize(width)
    .jpeg({ quality: 92 })
    .toFile(jpgPath);
  console.log(`  Sauvegardé: ${jpgPath}`);
}

/**
 * Convertit un TIF LOLA 16-bit unsigned en PNG grayscale 8-bit.
 *
 * Le TIF stocke l'élévation en uint16 : demi-mètres relatifs à 1 727 400 m,
 * avec un offset de +20 000. Range typique : ~10 000 à ~41 600.
 * On normalise [min, max] → [0, 255] pour le displacement map.
 */
async function convertElevationTif(tifPath, pngPath) {
  console.log(`  Conversion élévation → PNG 8-bit grayscale...`);

  // Forcer l'extraction en grayscale 1 canal, puis normaliser sur [0, 255]
  const { data, info } = await sharp(tifPath)
    .grayscale()          // Convertir en 1 canal
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log(`  Buffer: ${info.width}x${info.height}, channels=${info.channels}, ${data.length} octets`);

  const pixelCount = info.width * info.height;

  // Trouver min/max pour renormaliser
  let min = 255, max = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  const range = max - min;
  const output = Buffer.alloc(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    output[i] = range > 0 ? Math.round(((data[i] - min) / range) * 255) : 128;
  }
  console.log(`  Pixels: ${min}–${max} → renormalisé à 0–255 (plage: ${range})`);

  await sharp(output, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .png({ compressionLevel: 6 })
    .toFile(pngPath);

  console.log(`  Sauvegardé: ${pngPath}`);
}

/**
 * Génère une normal map RGB à partir d'une heightmap grayscale PNG.
 * Utilise les différences finies (Sobel simplifié) pour calculer les gradients.
 * Résultat : PNG RGB où R=X, G=Y, B=Z (espace tangent, convention OpenGL).
 */
async function generateNormalMap(heightmapPath, normalMapPath, strength = 2.0) {
  console.log(`  Génération normal map (force=${strength})...`);

  const { data, info } = await sharp(heightmapPath)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Accès avec wrapping horizontal (la Lune est un cylindre en longitude)
  const getPixel = (x, y) => {
    x = ((x % w) + w) % w;              // wrap horizontal
    y = Math.max(0, Math.min(h - 1, y)); // clamp vertical
    return data[y * w + x] / 255.0;
  };

  // Buffer de sortie RGB
  const output = Buffer.alloc(w * h * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel-like : gradient sur les voisins
      const left  = getPixel(x - 1, y);
      const right = getPixel(x + 1, y);
      const up    = getPixel(x, y - 1);
      const down  = getPixel(x, y + 1);

      // Dérivées
      const dx = (right - left) * strength;
      const dy = (down - up) * strength;

      // Normale en espace tangent
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;

      // Normaliser
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len;
      ny /= len;
      nz /= len;

      // Encoder en [0, 255] : composante = (valeur + 1) * 0.5 * 255
      const idx = (y * w + x) * 3;
      output[idx]     = Math.round((nx * 0.5 + 0.5) * 255); // R
      output[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255); // G
      output[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255); // B
    }
  }

  await sharp(output, {
    raw: { width: w, height: h, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toFile(normalMapPath);

  console.log(`  Sauvegardé: ${normalMapPath}`);
}

async function main() {
  if (!existsSync(RAW_DIR)) {
    await mkdir(RAW_DIR, { recursive: true });
  }

  // === Texture couleur ===
  console.log('=== Texture couleur (LROC) ===');
  if (!existsSync(TIF_PATH)) {
    await downloadFile(TEXTURE_URL, TIF_PATH);
  } else {
    console.log(`  TIF déjà présent: ${TIF_PATH}`);
  }

  if (!existsSync(JPG_4K_PATH)) {
    await convertToJpg(TIF_PATH, JPG_4K_PATH, 4096);
  } else {
    console.log(`  JPG 4K déjà présent: ${JPG_4K_PATH}`);
  }

  if (!existsSync(JPG_2K_PATH)) {
    await convertToJpg(TIF_PATH, JPG_2K_PATH, 2048);
  } else {
    console.log(`  JPG 2K déjà présent: ${JPG_2K_PATH}`);
  }

  // === Élévation LOLA ===
  console.log('\n=== Élévation LOLA ===');
  for (const elev of ELEV_FILES) {
    console.log(`\n[${elev.description}]`);

    if (!existsSync(elev.tifPath)) {
      await downloadFile(elev.url, elev.tifPath);
    } else {
      console.log(`  TIF déjà présent: ${elev.tifPath}`);
    }

    if (!existsSync(elev.pngPath)) {
      await convertElevationTif(elev.tifPath, elev.pngPath);
    } else {
      console.log(`  PNG déjà présent: ${elev.pngPath}`);
    }

    if (!existsSync(elev.normalPath)) {
      await generateNormalMap(elev.pngPath, elev.normalPath, 3.0);
    } else {
      console.log(`  Normal map déjà présente: ${elev.normalPath}`);
    }
  }

  // === Résumé ===
  console.log('\n=== Terminé ! ===');
  console.log('Texture:');
  console.log(`  ${JPG_2K_PATH}`);
  console.log(`  ${JPG_4K_PATH}`);
  console.log('Élévation:');
  for (const elev of ELEV_FILES) {
    console.log(`  ${elev.pngPath}`);
    console.log(`  ${elev.normalPath}`);
  }
}

main().catch(err => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
