/**
 * Génère une pyramide de tuiles à partir des images source.
 * Découpe texture couleur, displacement map et normal map en tuiles 256x256.
 *
 * Pyramide :
 *   Level 0 : 1x2   (2 tuiles)
 *   Level 1 : 2x4   (8 tuiles)
 *   Level 2 : 4x8   (32 tuiles)
 *   Level 3 : 8x16  (128 tuiles)
 *   Level 4 : 16x32 (512 tuiles)
 *
 * Usage : node scripts/generate_tiles.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const TILES_DIR = join(DATA_DIR, 'tiles');
const TILE_SIZE = 256;
const MAX_LEVEL = 4;

// Sources
const SOURCES = {
  texture: {
    path: join(DATA_DIR, 'raw', 'lroc_color_poles_8k.tif'),
    outDir: join(TILES_DIR, 'texture'),
    ext: '.jpg',
    sharpOptions: (region) =>
      sharp(SOURCES.texture.path)
        .extract(region)
        .resize(TILE_SIZE, TILE_SIZE)
        .jpeg({ quality: 90 }),
  },
  elevation: {
    path: join(DATA_DIR, 'moon_displacement_16ppd.png'),
    outDir: join(TILES_DIR, 'elevation'),
    ext: '.png',
    sharpOptions: (region) =>
      sharp(SOURCES.elevation.path)
        .extract(region)
        .resize(TILE_SIZE, TILE_SIZE)
        .png({ compressionLevel: 6 }),
  },
  normal: {
    path: join(DATA_DIR, 'moon_normal_16ppd.png'),
    outDir: join(TILES_DIR, 'normal'),
    ext: '.png',
    sharpOptions: (region) =>
      sharp(SOURCES.normal.path)
        .extract(region)
        .resize(TILE_SIZE, TILE_SIZE)
        .png({ compressionLevel: 6 }),
  },
};

/**
 * Retourne la grille (rows x cols) pour un level donné.
 * Level 0 : 1x2, Level 1 : 2x4, ... Level N : 2^N x 2^(N+1)
 */
function getGrid(level) {
  const rows = Math.pow(2, level);
  const cols = Math.pow(2, level + 1);
  return { rows, cols };
}

/**
 * Génère toutes les tuiles pour un type de source donné.
 */
async function generateTilesForSource(sourceName, source) {
  // Obtenir les dimensions de l'image source
  const metadata = await sharp(source.path).metadata();
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;
  console.log(`\n=== ${sourceName} (${srcWidth}x${srcHeight}) ===`);

  let totalGenerated = 0;
  let totalSkipped = 0;

  for (let level = 0; level <= MAX_LEVEL; level++) {
    const { rows, cols } = getGrid(level);
    const levelDir = join(source.outDir, String(level));

    if (!existsSync(levelDir)) {
      await mkdir(levelDir, { recursive: true });
    }

    // Taille de chaque tuile dans l'image source
    const tileWidthSrc = Math.floor(srcWidth / cols);
    const tileHeightSrc = Math.floor(srcHeight / rows);

    let levelCount = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const outPath = join(levelDir, `${row}_${col}${source.ext}`);

        if (existsSync(outPath)) {
          totalSkipped++;
          continue;
        }

        // Région à extraire de l'image source
        const region = {
          left: col * tileWidthSrc,
          top: row * tileHeightSrc,
          width: tileWidthSrc,
          height: tileHeightSrc,
        };

        // S'assurer qu'on ne dépasse pas les bords
        if (region.left + region.width > srcWidth) {
          region.width = srcWidth - region.left;
        }
        if (region.top + region.height > srcHeight) {
          region.height = srcHeight - region.top;
        }

        await source.sharpOptions(region).toFile(outPath);
        levelCount++;
      }
    }

    totalGenerated += levelCount;
    const totalTiles = rows * cols;
    console.log(
      `  Level ${level} (${rows}x${cols} = ${totalTiles} tuiles) : ${levelCount} générées, ${totalTiles - levelCount} existantes`
    );
  }

  console.log(
    `  Total ${sourceName} : ${totalGenerated} générées, ${totalSkipped} existantes`
  );
  return totalGenerated;
}

async function main() {
  console.log('=== Génération de la pyramide de tuiles ===');
  console.log(`Destination : ${TILES_DIR}`);
  console.log(`Taille des tuiles : ${TILE_SIZE}x${TILE_SIZE}`);
  console.log(`Niveaux : 0-${MAX_LEVEL}`);

  // Vérifier que les sources existent
  for (const [name, source] of Object.entries(SOURCES)) {
    if (!existsSync(source.path)) {
      console.error(`ERREUR : Source manquante : ${source.path}`);
      console.error(`Lancez d'abord : node scripts/download_texture.mjs`);
      process.exit(1);
    }
  }

  let grandTotal = 0;

  for (const [name, source] of Object.entries(SOURCES)) {
    const count = await generateTilesForSource(name, source);
    grandTotal += count;
  }

  // Résumé
  console.log('\n=== Terminé ===');
  let totalExpected = 0;
  for (let level = 0; level <= MAX_LEVEL; level++) {
    const { rows, cols } = getGrid(level);
    totalExpected += rows * cols;
  }
  console.log(
    `${grandTotal} tuiles générées sur ${totalExpected * 3} attendues (3 types x ${totalExpected})`
  );
}

main().catch((err) => {
  console.error('Erreur:', err.message);
  process.exit(1);
});
