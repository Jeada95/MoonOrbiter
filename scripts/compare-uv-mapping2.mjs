/**
 * compare-uv-mapping2.mjs
 *
 * Génère une texture de test avec des bandes de couleur par longitude,
 * puis montre comment elle apparaît dans chaque convention.
 *
 * Bandes : lon 0° = Rouge, 90°E = Vert, 180° = Bleu, 90°W(-90°/270°) = Jaune
 * + Tycho marker à lat=-43°, lon=-11° (carré blanc)
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');

const W = 2048;
const H = 1024;

// Couleurs par quadrant de longitude (dans la texture source, lon 0..360)
// La texture LROC est organisée : colonne 0 = lon 0°, colonne W-1 = lon 360°
function colorForLon360(lon360) {
  // lon360 dans [0, 360)
  if (lon360 < 90) return [255, 0, 0];       // 0-90° : Rouge
  if (lon360 < 180) return [0, 255, 0];      // 90-180° : Vert
  if (lon360 < 270) return [0, 0, 255];      // 180-270° : Bleu
  return [255, 255, 0];                       // 270-360° : Jaune
}

// Créer texture de test (équirectangulaire, lon 0→360 de gauche à droite)
function createTestTexture() {
  const buf = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const lon360 = (px / (W - 1)) * 360;
      const lat = 90 - (py / (H - 1)) * 180;
      let [r, g, b] = colorForLon360(lon360);

      // Grille tous les 30°
      const lonMod30 = lon360 % 30;
      const latMod30 = ((lat + 180) % 30);
      if (lonMod30 < 1 || lonMod30 > 29) { r = 128; g = 128; b = 128; }
      if (latMod30 < 1 || latMod30 > 29) { r = 128; g = 128; b = 128; }

      // Marqueur Tycho : lat=-43.3°, lon=-11.4° → lon360 = 348.6°
      const tychoLat = -43.3, tychoLon360 = 348.6;
      if (Math.abs(lat - tychoLat) < 3 && Math.abs(lon360 - tychoLon360) < 3) {
        r = 255; g = 255; b = 255;
      }

      // Marqueur Copernic : lat=9.6°, lon=-20.1° → lon360 = 339.9°
      const copLat = 9.6, copLon360 = 339.9;
      if (Math.abs(lat - copLat) < 3 && Math.abs(lon360 - copLon360) < 3) {
        r = 255; g = 0; b = 255; // Magenta
      }

      const idx = (py * W + px) * 3;
      buf[idx] = r; buf[idx + 1] = g; buf[idx + 2] = b;
    }
  }
  return buf;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const texBuf = createTestTexture();

  // Sauver la texture source
  await sharp(texBuf, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '0_test_texture_source.jpg'));
  console.log('Texture test source sauvée');

  function sampleTex(u, v) {
    u = ((u % 1) + 1) % 1;
    v = Math.max(0, Math.min(1, v));
    const px = Math.floor(u * (W - 1));
    const py = Math.floor(v * (H - 1));
    const idx = (py * W + px) * 3;
    return [texBuf[idx], texBuf[idx + 1], texBuf[idx + 2]];
  }

  // Les 3 images sont en projection equirectangulaire :
  // pixel x=0 → lon=-180°, x=W-1 → lon=+180°
  // pixel y=0 → lat=+90°, y=H-1 → lat=-90°

  // === IMAGE 1 : Globe (Three.js SphereGeometry) ===
  // Three.js SphereGeometry UV :
  //   phi va de 0 à 2PI, en partant de l'axe -X
  //   U = phi / (2*PI)
  //
  // Pour un vertex à (lat, lon), la position 3D est :
  //   x = -R cos(phi) sin(theta), y = R cos(theta), z = R sin(phi) sin(theta)
  //   avec phi = azimuth dans [0, 2PI], theta = colatitude [0, PI]
  //
  // On retrouve lon via atan2(z, x) = atan2(sin(phi), -cos(phi))
  // Pour phi = 0 : atan2(0, -1) = PI → lon = PI (180°)
  // Pour phi = PI/2 : atan2(1, 0) = PI/2 → lon = 90°
  // Pour phi = PI : atan2(0, 1) = 0 → lon = 0°
  // Pour phi = 3PI/2 : atan2(-1, 0) = -PI/2 → lon = -90° (270°)
  //
  // Donc phi → lon : lon = PI - phi (pour phi in [0, PI]) et lon = PI - phi + 2PI (for phi in [PI, 2PI])
  // Ou plus simplement: phi = (PI - lon + 2PI) % 2PI
  // Et U = phi / (2PI)

  const img1 = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    const lat_deg = 90 - (py / (H - 1)) * 180;
    for (let px = 0; px < W; px++) {
      const lon_deg = -180 + (px / (W - 1)) * 360;
      const lon_rad = lon_deg * Math.PI / 180;

      const phi = ((Math.PI - lon_rad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const u = phi / (2 * Math.PI);
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTex(u, v);
      const idx = (py * W + px) * 3;
      img1[idx] = r; img1[idx + 1] = g; img1[idx + 2] = b;
    }
  }
  await sharp(img1, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '1_globe_threejs.jpg'));
  console.log('1_globe_threejs.jpg sauvé');

  // === IMAGE 2 : Adaptatif actuel (U = lon/360) ===
  const img2 = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    const lat_deg = 90 - (py / (H - 1)) * 180;
    for (let px = 0; px < W; px++) {
      const lon_deg = -180 + (px / (W - 1)) * 360;
      const lon360 = ((lon_deg % 360) + 360) % 360;

      const u = lon360 / 360;
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTex(u, v);
      const idx = (py * W + px) * 3;
      img2[idx] = r; img2[idx + 1] = g; img2[idx + 2] = b;
    }
  }
  await sharp(img2, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '2_adaptive_current.jpg'));
  console.log('2_adaptive_current.jpg sauvé');

  // === IMAGE 3 : Adaptatif avec U+0.5 ===
  const img3 = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    const lat_deg = 90 - (py / (H - 1)) * 180;
    for (let px = 0; px < W; px++) {
      const lon_deg = -180 + (px / (W - 1)) * 360;
      const lon360 = ((lon_deg % 360) + 360) % 360;

      const u = (lon360 / 360 + 0.5) % 1.0;
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTex(u, v);
      const idx = (py * W + px) * 3;
      img3[idx] = r; img3[idx + 1] = g; img3[idx + 2] = b;
    }
  }
  await sharp(img3, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '3_adaptive_plus05.jpg'));
  console.log('3_adaptive_plus05.jpg sauvé');

  // === IMAGE 4 : Adaptatif avec miroir U (1-U) ===
  const img4 = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    const lat_deg = 90 - (py / (H - 1)) * 180;
    for (let px = 0; px < W; px++) {
      const lon_deg = -180 + (px / (W - 1)) * 360;
      const lon360 = ((lon_deg % 360) + 360) % 360;

      const u = 1.0 - lon360 / 360;
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTex(u, v);
      const idx = (py * W + px) * 3;
      img4[idx] = r; img4[idx + 1] = g; img4[idx + 2] = b;
    }
  }
  await sharp(img4, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '4_adaptive_mirror.jpg'));
  console.log('4_adaptive_mirror.jpg sauvé');

  // === IMAGE 5 : Adaptatif avec miroir + décalage (0.5 - lon/360) ===
  const img5 = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) {
    const lat_deg = 90 - (py / (H - 1)) * 180;
    for (let px = 0; px < W; px++) {
      const lon_deg = -180 + (px / (W - 1)) * 360;
      const lon360 = ((lon_deg % 360) + 360) % 360;

      const u = ((0.5 - lon360 / 360) % 1.0 + 1.0) % 1.0;
      const v = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTex(u, v);
      const idx = (py * W + px) * 3;
      img5[idx] = r; img5[idx + 1] = g; img5[idx + 2] = b;
    }
  }
  await sharp(img5, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(path.join(OUTPUT_DIR, '5_adaptive_mirror_shift.jpg'));
  console.log('5_adaptive_mirror_shift.jpg sauvé');

  console.log('\n=== Résumé ===');
  console.log('0 = texture source (lon 0→360, Rouge/Vert/Bleu/Jaune par quadrant)');
  console.log('    Tycho (blanc) à ~lon 349° (~11°W), lat -43°');
  console.log('    Copernic (magenta) à ~lon 340° (~20°W), lat 10°');
  console.log('1 = Globe Three.js : la référence');
  console.log('2 = Adaptatif actuel : U = lon/360');
  console.log('3 = Adaptatif + 0.5 : U = (lon/360 + 0.5) % 1');
  console.log('4 = Adaptatif miroir : U = 1 - lon/360');
  console.log('5 = Adaptatif miroir+shift : U = (0.5 - lon/360)');
  console.log('\nChercher quelle image 2-5 est identique à image 1 !');
}

main().catch(console.error);
