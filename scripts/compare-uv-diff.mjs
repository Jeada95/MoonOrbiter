/**
 * compare-uv-diff.mjs
 *
 * Génère des images de DIFFÉRENCE entre la référence Globe (Three.js)
 * et chaque variante UV du mesh adaptatif.
 *
 * Image noire = parfait alignement. Plus c'est clair = plus le décalage est grand.
 *
 * Utilise la VRAIE texture LROC pour que la comparaison soit réaliste.
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const TEXTURE_PATH = path.join(DATA_DIR, 'moon_texture_4k.jpg');
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');

const OUT_W = 2048;
const OUT_H = 1024;

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Charger la texture LROC
  console.log('Chargement texture LROC...');
  const texMeta = await sharp(TEXTURE_PATH).metadata();
  const texW = texMeta.width;
  const texH = texMeta.height;
  const texChannels = texMeta.channels || 3;
  const texBuf = await sharp(TEXTURE_PATH).raw().toBuffer();
  console.log(`Texture: ${texW}x${texH}, ${texChannels}ch`);

  function sampleTexture(u, v) {
    u = ((u % 1) + 1) % 1;
    v = Math.max(0, Math.min(1, v));
    const px = Math.floor(u * (texW - 1));
    const py = Math.floor(v * (texH - 1));
    const idx = (py * texW + px) * texChannels;
    return [texBuf[idx], texBuf[idx + 1], texBuf[idx + 2]];
  }

  // Formules UV candidates
  const formulas = {
    '1_lon_div_360': (lon360) => lon360 / 360,
    '2_plus_05':     (lon360) => (lon360 / 360 + 0.5) % 1.0,
    '3_mirror':      (lon360) => ((1.0 - lon360 / 360) % 1.0 + 1.0) % 1.0,
    '4_mirror_shift':(lon360) => ((0.5 - lon360 / 360) % 1.0 + 1.0) % 1.0,
    '5_neg_lon':     (lon360) => ((360 - lon360) / 360) % 1.0,
    '6_neg_shift':   (lon360) => (((360 - lon360) / 360 + 0.5) % 1.0 + 1.0) % 1.0,
  };

  // Générer l'image de référence Globe
  console.log('Calcul référence Globe Three.js...');
  const refPixels = new Uint8Array(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const lat_deg = 90 - (py / (OUT_H - 1)) * 180;
    for (let px = 0; px < OUT_W; px++) {
      const lon_deg = -180 + (px / (OUT_W - 1)) * 360;
      const lon_rad = lon_deg * Math.PI / 180;

      // UV Three.js SphereGeometry
      const phi = ((Math.PI - lon_rad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const u = phi / (2 * Math.PI);
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTexture(u, v);
      const idx = (py * OUT_W + px) * 3;
      refPixels[idx] = r;
      refPixels[idx + 1] = g;
      refPixels[idx + 2] = b;
    }
  }

  // Pour chaque formule, calculer l'image et la différence
  for (const [name, formula] of Object.entries(formulas)) {
    console.log(`Calcul ${name}...`);
    const diffBuf = Buffer.alloc(OUT_W * OUT_H * 3);
    let totalDiff = 0;

    for (let py = 0; py < OUT_H; py++) {
      const lat_deg = 90 - (py / (OUT_H - 1)) * 180;
      for (let px = 0; px < OUT_W; px++) {
        const lon_deg = -180 + (px / (OUT_W - 1)) * 360;
        const lon360 = ((lon_deg % 360) + 360) % 360;

        const u = formula(lon360);
        const v = (90 - lat_deg) / 180;

        const [r, g, b] = sampleTexture(u, v);
        const idx = (py * OUT_W + px) * 3;

        // Différence absolue (amplifiée x3 pour visibilité)
        const dr = Math.abs(r - refPixels[idx]);
        const dg = Math.abs(g - refPixels[idx + 1]);
        const db = Math.abs(b - refPixels[idx + 2]);

        diffBuf[idx] = Math.min(255, dr * 3);
        diffBuf[idx + 1] = Math.min(255, dg * 3);
        diffBuf[idx + 2] = Math.min(255, db * 3);

        totalDiff += dr + dg + db;
      }
    }

    const avgDiff = totalDiff / (OUT_W * OUT_H * 3);
    const diffPath = path.join(OUTPUT_DIR, `diff_${name}.jpg`);
    await sharp(diffBuf, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
      .jpeg({ quality: 90 })
      .toFile(diffPath);
    console.log(`  → ${diffPath}  (diff moyenne: ${avgDiff.toFixed(2)}, ${avgDiff < 0.5 ? '✅ MATCH' : '❌ décalé'})`);
  }

  console.log('\nDone. Image noire = parfait alignement.');
}

main().catch(console.error);
