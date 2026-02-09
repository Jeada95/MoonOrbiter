/**
 * compare-uv-mapping.mjs
 *
 * Génère deux images équirectangulaires montrant comment chaque convention
 * mappe la texture LROC sur le globe :
 *
 * 1. globe_uv_map.jpg — Convention Globe (Three.js SphereGeometry)
 *    UV = { U: phi/(2*PI), V: theta/PI } où phi part de l'axe -X
 *
 * 2. adaptive_uv_map.jpg — Convention mesh adaptatif
 *    UV = { U: lon/360, V: (90-lat)/180 }
 *
 * Chaque image est une projection équirectangulaire (lat -90..+90, lon -180..+180)
 * colorée par l'échantillonnage de la texture LROC aux UV correspondants.
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const TEXTURE_PATH = path.join(DATA_DIR, 'moon_texture_4k.jpg') // ou 2k
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');

// Résolution de sortie
const OUT_W = 2048;
const OUT_H = 1024;

async function main() {
  // Créer le dossier de sortie
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Charger la texture LROC
  console.log('Chargement texture LROC...');
  const texMeta = await sharp(TEXTURE_PATH).metadata();
  const texW = texMeta.width;
  const texH = texMeta.height;
  console.log(`Texture: ${texW}x${texH}`);

  const texBuf = await sharp(TEXTURE_PATH)
    .raw()
    .toBuffer();

  const texChannels = texMeta.channels || 3;
  console.log(`Texture chargée: ${texBuf.length} bytes, ${texChannels} channels`);

  // Fonction pour échantillonner un pixel de la texture
  function sampleTexture(u, v) {
    // Clamp et wrap
    u = ((u % 1) + 1) % 1; // wrap [0, 1)
    v = Math.max(0, Math.min(1, v));

    const px = Math.floor(u * (texW - 1));
    const py = Math.floor(v * (texH - 1));
    const idx = (py * texW + px) * texChannels;

    return [texBuf[idx], texBuf[idx + 1], texBuf[idx + 2]];
  }

  // ========================================
  // Convention Globe (Three.js SphereGeometry)
  // ========================================
  // Three.js SphereGeometry UV:
  //   U = phiIndex / phiSegments (phi va de 0 à 2PI, partant de l'axe -X)
  //   V = thetaIndex / thetaSegments (theta va de 0 en haut à PI en bas)
  //
  // Pour un point à (lat, lon) :
  //   Le vertex Three.js a :
  //     x = -R cos(phi) sin(theta)
  //     y = R cos(theta)
  //     z = R sin(phi) sin(theta)
  //
  //   Avec theta = PI/2 - lat, phi = lon (en radians)
  //   Mais l'UV Three.js est basé sur phi qui va de 0 à 2PI à partir de x=-R
  //
  //   atan2(z, x) pour le vertex donne :
  //     atan2(R sin(phi) sin(theta), -R cos(phi) sin(theta))
  //     = atan2(sin(phi), -cos(phi))
  //     = PI - phi  (pour phi dans [0, 2PI])
  //
  //   Donc lon = atan2(nz, nx) = PI - phi
  //   Donc phi = PI - lon
  //   Et U = phi / (2*PI) = (PI - lon) / (2*PI)
  //
  // En fait, Three.js SphereGeometry attribue l'UV directement :
  //   U progresse linéairement de 0 à 1 quand phi va de 0 à 2PI
  //   phi = 0 → vertex sur l'axe -X → U = 0
  //   phi = PI → vertex sur l'axe +X → U = 0.5
  //   phi = 2PI → vertex retour axe -X → U = 1
  //
  // Pour un lon donné (en degrés, -180 à +180) :
  //   Le vertex est à phi tel que atan2(sin(phi), -cos(phi)) = lon_rad
  //   => phi = PI - lon_rad  (pour lon_rad dans [-PI, +PI])
  //   => U_globe = phi / (2*PI) = (PI - lon_rad) / (2*PI)
  //
  // Pour lat :
  //   theta = PI/2 - lat_rad
  //   V_globe = theta / PI = (PI/2 - lat_rad) / PI = 0.5 - lat_rad/PI = (90 - lat_deg) / 180

  console.log('\nGénération image Globe (Three.js)...');
  const globeImg = Buffer.alloc(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const lat_deg = 90 - (py / (OUT_H - 1)) * 180; // +90 en haut, -90 en bas
    const lat_rad = lat_deg * Math.PI / 180;

    for (let px = 0; px < OUT_W; px++) {
      const lon_deg = -180 + (px / (OUT_W - 1)) * 360; // -180 à gauche, +180 à droite
      const lon_rad = lon_deg * Math.PI / 180;

      // UV selon Three.js SphereGeometry
      const phi = ((Math.PI - lon_rad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      const u_globe = phi / (2 * Math.PI);
      const v_globe = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTexture(u_globe, v_globe);
      const idx = (py * OUT_W + px) * 3;
      globeImg[idx] = r;
      globeImg[idx + 1] = g;
      globeImg[idx + 2] = b;
    }
  }

  const globePath = path.join(OUTPUT_DIR, 'globe_uv_map.jpg');
  await sharp(globeImg, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(globePath);
  console.log(`Globe UV map sauvé: ${globePath}`);

  // ========================================
  // Convention Mesh Adaptatif
  // ========================================
  // gridToUV: U = lon/360, V = (90 - lat) / 180
  // Avec lon dans [0, 360] dans les tuiles (lonMin..lonMax)
  //
  // Pour notre image equirectangulaire, lon va de -180 à +180
  // On le convertit en [0, 360] : lon360 = (lon + 360) % 360

  console.log('Génération image Adaptatif...');
  const adaptImg = Buffer.alloc(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const lat_deg = 90 - (py / (OUT_H - 1)) * 180;

    for (let px = 0; px < OUT_W; px++) {
      const lon_deg = -180 + (px / (OUT_W - 1)) * 360;

      // Convertir en lon [0, 360] comme nos tuiles
      const lon360 = ((lon_deg % 360) + 360) % 360;

      // UV selon notre convention adaptative
      const u_adapt = lon360 / 360;
      const v_adapt = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTexture(u_adapt, v_adapt);
      const idx = (py * OUT_W + px) * 3;
      adaptImg[idx] = r;
      adaptImg[idx + 1] = g;
      adaptImg[idx + 2] = b;
    }
  }

  const adaptPath = path.join(OUTPUT_DIR, 'adaptive_uv_map.jpg');
  await sharp(adaptImg, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(adaptPath);
  console.log(`Adaptive UV map sauvé: ${adaptPath}`);

  // ========================================
  // Convention Mesh Adaptatif CORRIGÉE (U + 0.5)
  // ========================================
  console.log('Génération image Adaptatif corrigé (U+0.5)...');
  const fixedImg = Buffer.alloc(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const lat_deg = 90 - (py / (OUT_H - 1)) * 180;

    for (let px = 0; px < OUT_W; px++) {
      const lon_deg = -180 + (px / (OUT_W - 1)) * 360;
      const lon360 = ((lon_deg % 360) + 360) % 360;

      // UV corrigé : U décalé de 0.5
      const u_fixed = (lon360 / 360 + 0.5) % 1.0;
      const v_fixed = (90 - lat_deg) / 180;

      const [r, g, b] = sampleTexture(u_fixed, v_fixed);
      const idx = (py * OUT_W + px) * 3;
      fixedImg[idx] = r;
      fixedImg[idx + 1] = g;
      fixedImg[idx + 2] = b;
    }
  }

  const fixedPath = path.join(OUTPUT_DIR, 'adaptive_uv_fixed.jpg');
  await sharp(fixedImg, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
    .jpeg({ quality: 90 })
    .toFile(fixedPath);
  console.log(`Adaptive UV fixé sauvé: ${fixedPath}`);

  console.log('\n=== Comparaison terminée ===');
  console.log(`Ouvrir les 3 images dans ${OUTPUT_DIR} pour comparer.`);
  console.log('Si globe_uv_map.jpg == adaptive_uv_fixed.jpg, le fix U+0.5 est correct.');
}

main().catch(console.error);
