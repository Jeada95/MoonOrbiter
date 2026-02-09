/**
 * export-equirect.mjs
 *
 * Exporte deux images équirectangulaires avec repères lat/lon :
 * 1. globe_equirect.jpg — ce que le Globe Three.js affiche (texture via UV SphereGeometry)
 * 2. adaptive_equirect.jpg — ce que le mesh adaptatif affiche (texture via notre gridToUV)
 *
 * Chaque image : projection equirectangulaire lat [-90,+90], lon [-180,+180]
 * avec grille de repères tous les 30° et labels.
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
  const texCh = texMeta.channels || 3;
  const texBuf = await sharp(TEXTURE_PATH).raw().toBuffer();
  console.log(`Texture: ${texW}x${texH}, ${texCh}ch`);

  function sampleTex(u, v) {
    u = ((u % 1) + 1) % 1;
    v = Math.max(0, Math.min(0.9999, v));
    const px = Math.min(Math.floor(u * texW), texW - 1);
    const py = Math.min(Math.floor(v * texH), texH - 1);
    const idx = (py * texW + px) * texCh;
    return [texBuf[idx], texBuf[idx + 1], texBuf[idx + 2]];
  }

  // Dessiner un caractère simple (bitmap 5x7 pixels)
  const FONT = {
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00110','01000','10000','11111'],
    '3': ['01110','10001','00001','00110','00001','10001','01110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','11110','00001','00001','10001','01110'],
    '6': ['01110','10000','11110','10001','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    '°': ['01100','10010','01100','00000','00000','00000','00000'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'S': ['01110','10001','10000','01110','00001','10001','01110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'W': ['10001','10001','10001','10101','10101','10101','01010'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  };

  function drawChar(buf, bx, by, ch, r, g, b) {
    const glyph = FONT[ch];
    if (!glyph) return;
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          const px = bx + col;
          const py = by + row;
          if (px >= 0 && px < OUT_W && py >= 0 && py < OUT_H) {
            const idx = (py * OUT_W + px) * 3;
            buf[idx] = r; buf[idx+1] = g; buf[idx+2] = b;
          }
        }
      }
    }
  }

  function drawText(buf, x, y, text, r, g, b) {
    for (let i = 0; i < text.length; i++) {
      drawChar(buf, x + i * 6, y, text[i], r, g, b);
    }
  }

  function drawGridOverlay(buf) {
    // Lignes de grille tous les 30°
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 30) {
      const px = Math.round(((lonDeg + 180) / 360) * (OUT_W - 1));
      const isZero = lonDeg === 0;
      const thick = isZero ? 2 : 1;
      for (let py = 0; py < OUT_H; py++) {
        for (let t = -thick+1; t <= thick-1; t++) {
          const ppx = px + t;
          if (ppx >= 0 && ppx < OUT_W) {
            const idx = (py * OUT_W + ppx) * 3;
            if (isZero) {
              buf[idx] = 255; buf[idx+1] = 255; buf[idx+2] = 0; // jaune pour 0°
            } else {
              buf[idx] = 255; buf[idx+1] = 0; buf[idx+2] = 0; // rouge
            }
          }
        }
      }
      // Label longitude
      const label = `${lonDeg}${String.fromCharCode(176)}`;
      drawText(buf, px + 3, OUT_H / 2 + 2, label, 255, 255, 255);
    }

    for (let latDeg = -90; latDeg <= 90; latDeg += 30) {
      const py = Math.round(((90 - latDeg) / 180) * (OUT_H - 1));
      const isZero = latDeg === 0;
      const thick = isZero ? 2 : 1;
      for (let px = 0; px < OUT_W; px++) {
        for (let t = -thick+1; t <= thick-1; t++) {
          const ppy = py + t;
          if (ppy >= 0 && ppy < OUT_H) {
            const idx = (ppy * OUT_W + px) * 3;
            if (isZero) {
              buf[idx] = 255; buf[idx+1] = 255; buf[idx+2] = 0;
            } else {
              buf[idx] = 255; buf[idx+1] = 0; buf[idx+2] = 0;
            }
          }
        }
      }
      // Label latitude
      const label = `${latDeg}${String.fromCharCode(176)}`;
      drawText(buf, OUT_W / 2 + 3, py + 3, label, 255, 255, 255);
    }

    // Repères supplémentaires tous les 10° (petits tirets)
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 10) {
      if (lonDeg % 30 === 0) continue; // déjà tracé
      const px = Math.round(((lonDeg + 180) / 360) * (OUT_W - 1));
      // Petit tiret de 6px au centre vertical
      const cy = Math.round(OUT_H / 2);
      for (let dy = -3; dy <= 3; dy++) {
        const py = cy + dy;
        if (py >= 0 && py < OUT_H) {
          const idx = (py * OUT_W + px) * 3;
          buf[idx] = 200; buf[idx+1] = 200; buf[idx+2] = 0;
        }
      }
    }
    for (let latDeg = -90; latDeg <= 90; latDeg += 10) {
      if (latDeg % 30 === 0) continue;
      const py = Math.round(((90 - latDeg) / 180) * (OUT_H - 1));
      const cx = Math.round(OUT_W / 2);
      for (let dx = -3; dx <= 3; dx++) {
        const px = cx + dx;
        if (px >= 0 && px < OUT_W) {
          const idx = (py * OUT_W + px) * 3;
          buf[idx] = 200; buf[idx+1] = 200; buf[idx+2] = 0;
        }
      }
    }
  }

  // ===== IMAGE 1 : Globe (Three.js SphereGeometry) =====
  // UV SphereGeometry : phi = (PI - lon_rad), U = phi/(2PI), V = (PI/2 - lat_rad)/PI
  console.log('Globe...');
  const globeBuf = Buffer.alloc(OUT_W * OUT_H * 3);
  for (let py = 0; py < OUT_H; py++) {
    const latDeg = 90 - (py / (OUT_H - 1)) * 180;
    const latRad = latDeg * Math.PI / 180;
    for (let px = 0; px < OUT_W; px++) {
      const lonDeg = -180 + (px / (OUT_W - 1)) * 360;
      const lonRad = lonDeg * Math.PI / 180;
      const phi = ((Math.PI - lonRad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const u = phi / (2 * Math.PI);
      const v = (90 - latDeg) / 180;
      const [r, g, b] = sampleTex(u, v);
      const idx = (py * OUT_W + px) * 3;
      globeBuf[idx] = r; globeBuf[idx+1] = g; globeBuf[idx+2] = b;
    }
  }
  drawGridOverlay(globeBuf);
  await sharp(globeBuf, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .jpeg({ quality: 92 }).toFile(path.join(OUTPUT_DIR, 'globe_equirect.jpg'));
  console.log('→ globe_equirect.jpg');

  // ===== IMAGE 2 : Mesh adaptatif (notre gridToUV) =====
  // gridToUV : U = (0.5 - lon360/360) mod 1, V = (90 - lat)/180
  console.log('Adaptatif...');
  const adaptBuf = Buffer.alloc(OUT_W * OUT_H * 3);
  for (let py = 0; py < OUT_H; py++) {
    const latDeg = 90 - (py / (OUT_H - 1)) * 180;
    for (let px = 0; px < OUT_W; px++) {
      const lonDeg = -180 + (px / (OUT_W - 1)) * 360;
      const lon360 = ((lonDeg % 360) + 360) % 360;
      const u = ((0.5 - lon360 / 360) % 1.0 + 1.0) % 1.0;
      const v = (90 - latDeg) / 180;
      const [r, g, b] = sampleTex(u, v);
      const idx = (py * OUT_W + px) * 3;
      adaptBuf[idx] = r; adaptBuf[idx+1] = g; adaptBuf[idx+2] = b;
    }
  }
  drawGridOverlay(adaptBuf);
  await sharp(adaptBuf, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .jpeg({ quality: 92 }).toFile(path.join(OUTPUT_DIR, 'adaptive_equirect.jpg'));
  console.log('→ adaptive_equirect.jpg');

  console.log('\nDone. Compare les deux images dans', OUTPUT_DIR);
  console.log('Les repères sont identiques (même grille lat/lon).');
  console.log('Ligne jaune = 0° lon / 0° lat. Lignes rouges = tous les 30°.');
}

main().catch(console.error);
