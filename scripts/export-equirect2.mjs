/**
 * export-equirect2.mjs
 *
 * Exporte deux VRAIES images comparables :
 * 1. photo_equirect.jpg — la texture LROC telle que Three.js SphereGeometry la mappe
 *    (c'est ce que l'utilisateur voit en mode photo)
 * 2. elevation_equirect.jpg — les données d'élévation LOLA (hauteur → niveaux de gris)
 *    (c'est ce qui positionne les vertices du mesh adaptatif)
 *
 * Les deux sont projetées en équirectangulaire lat [-90,+90], lon [-180,+180]
 * avec grille de repères identique. Si les cratères coïncident entre les deux
 * images, l'alignement est correct.
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const TEXTURE_PATH = path.join(DATA_DIR, 'moon_texture_4k.jpg');
const LOLA_PATH = path.join(DATA_DIR, 'lola_elevation_16ppd.bin');
const LOLA_W = 5760;
const LOLA_H = 2880;
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');

const OUT_W = 2048;
const OUT_H = 1024;

// Grille et labels
const FONT = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00110','01000','10000','11111'],
  '3':['01110','10001','00001','00110','00001','10001','01110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['01110','10000','11110','10001','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};

function drawChar(buf, bx, by, ch, r, g, b) {
  const gl = FONT[ch]; if (!gl) return;
  for (let row = 0; row < 7; row++)
    for (let col = 0; col < 5; col++)
      if (gl[row][col] === '1') {
        const px = bx+col, py = by+row;
        if (px>=0 && px<OUT_W && py>=0 && py<OUT_H) {
          const i=(py*OUT_W+px)*3; buf[i]=r; buf[i+1]=g; buf[i+2]=b;
        }
      }
}
function drawText(buf, x, y, text, r, g, b) {
  for (let i=0;i<text.length;i++) drawChar(buf, x+i*6, y, text[i], r, g, b);
}

function drawGrid(buf) {
  for (let lonDeg = -180; lonDeg <= 180; lonDeg += 30) {
    const px = Math.round(((lonDeg+180)/360)*(OUT_W-1));
    const isZ = lonDeg===0;
    for (let py=0; py<OUT_H; py++) {
      const i=(py*OUT_W+px)*3;
      if (isZ) { buf[i]=255;buf[i+1]=255;buf[i+2]=0; }
      else { buf[i]=255;buf[i+1]=0;buf[i+2]=0; }
    }
    drawText(buf, px+3, OUT_H/2-10, `${lonDeg}`, 255,255,255);
  }
  for (let latDeg = -90; latDeg <= 90; latDeg += 30) {
    const py = Math.round(((90-latDeg)/180)*(OUT_H-1));
    const isZ = latDeg===0;
    for (let px=0; px<OUT_W; px++) {
      const i=(py*OUT_W+px)*3;
      if (isZ) { buf[i]=255;buf[i+1]=255;buf[i+2]=0; }
      else { buf[i]=255;buf[i+1]=0;buf[i+2]=0; }
    }
    drawText(buf, 10, py+3, `${latDeg}`, 255,255,255);
  }
  // Tirets 10°
  for (let lonDeg=-180; lonDeg<=180; lonDeg+=10) {
    if (lonDeg%30===0) continue;
    const px = Math.round(((lonDeg+180)/360)*(OUT_W-1));
    const cy = Math.round(OUT_H/2);
    for (let dy=-4;dy<=4;dy++) {
      const py=cy+dy;
      if (py>=0&&py<OUT_H) { const i=(py*OUT_W+px)*3; buf[i]=200;buf[i+1]=200;buf[i+2]=0; }
    }
  }
  for (let latDeg=-90;latDeg<=90;latDeg+=10) {
    if (latDeg%30===0) continue;
    const py = Math.round(((90-latDeg)/180)*(OUT_H-1));
    const cx = Math.round(OUT_W/2);
    for (let dx=-4;dx<=4;dx++) {
      const px=cx+dx;
      if (px>=0&&px<OUT_W) { const i=(py*OUT_W+px)*3; buf[i]=200;buf[i+1]=200;buf[i+2]=0; }
    }
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // === IMAGE 1 : TEXTURE LROC (mode photo) ===
  console.log('Chargement texture LROC...');
  const texMeta = await sharp(TEXTURE_PATH).metadata();
  const texW = texMeta.width, texH = texMeta.height, texCh = texMeta.channels||3;
  const texBuf = await sharp(TEXTURE_PATH).raw().toBuffer();

  // La texture LROC est en projection équirectangulaire standard :
  //   pixel (0,0) = coin haut-gauche = (lat +90°, lon 0°E) pour les données NASA
  //   OU bien = (lat +90°, lon -180°) selon la source
  //
  // Three.js SphereGeometry plaque cette texture via ses UV.
  // Le Globe.ts utilise atan2(nz, nx) pour retrouver lon.
  // Pour l'image equirect, on simule : pour chaque (lat, lon) de l'image de sortie,
  // on calcule la position 3D du vertex SphereGeometry, on en extrait l'UV,
  // et on sample la texture à cet UV.
  //
  // Mais plus simplement : le Globe plaque la texture directement via les UV
  // de SphereGeometry. Donc le résultat c'est juste la texture LROC elle-même,
  // mais "déroulée" selon la convention d'azimuth de Three.js.
  //
  // SphereGeometry : U=0 → phi=0 → axe -X → atan2(0,-1)=PI → lon=180°
  // Donc la colonne gauche de la texture (U=0) correspond à lon=180°.
  //
  // Pour notre image de sortie (lon=-180 à gauche, +180 à droite) :
  //   lon = -180 → lonRad = -PI → phi = PI-(-PI) = 2PI → U = 1.0
  //   lon = 0    → lonRad = 0   → phi = PI      → U = 0.5
  //   lon = +180 → lonRad = PI  → phi = 0       → U = 0.0

  console.log('Génération image photo (texture LROC via UV SphereGeometry)...');
  const photoBuf = Buffer.alloc(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const latDeg = 90 - (py/(OUT_H-1))*180;
    for (let px = 0; px < OUT_W; px++) {
      const lonDeg = -180 + (px/(OUT_W-1))*360;
      const lonRad = lonDeg * Math.PI/180;
      const phi = ((Math.PI - lonRad) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
      const u = phi / (2*Math.PI);
      const v = (90 - latDeg) / 180;

      // Sample texture
      const su = ((u%1)+1)%1;
      const sv = Math.max(0, Math.min(0.9999, v));
      const tpx = Math.min(Math.floor(su*texW), texW-1);
      const tpy = Math.min(Math.floor(sv*texH), texH-1);
      const ti = (tpy*texW+tpx)*texCh;

      const idx = (py*OUT_W+px)*3;
      photoBuf[idx] = texBuf[ti];
      photoBuf[idx+1] = texBuf[ti+1];
      photoBuf[idx+2] = texBuf[ti+2];
    }
  }
  drawGrid(photoBuf);
  await sharp(photoBuf, {raw:{width:OUT_W,height:OUT_H,channels:3}})
    .jpeg({quality:92}).toFile(path.join(OUTPUT_DIR, 'photo_equirect.jpg'));
  console.log('→ photo_equirect.jpg');

  // === IMAGE 2 : ÉLÉVATION LOLA (ce qui positionne les vertices adaptatifs) ===
  console.log('Chargement élévation LOLA 16ppd...');
  const lolaBuf = fs.readFileSync(LOLA_PATH);
  const lola = new Float32Array(lolaBuf.buffer, lolaBuf.byteOffset, LOLA_W*LOLA_H);

  // Trouver min/max pour normaliser en niveaux de gris
  let eMin = Infinity, eMax = -Infinity;
  for (let i=0; i<lola.length; i++) {
    if (lola[i]<eMin) eMin=lola[i];
    if (lola[i]>eMax) eMax=lola[i];
  }
  console.log(`Élévation: min=${eMin.toFixed(0)}m, max=${eMax.toFixed(0)}m`);

  // LOLA grid : row 0 = lat +90° (nord), col 0 = lon 0°E
  // Projection equirect identique : lat [-90,+90], lon [-180,+180]
  //
  // Pour lon=-180..+180, convertir en lon360=0..360 pour indexer le LOLA.
  // LOLA col = (lon360 / 360) * (W-1)
  // LOLA row = ((90 - lat) / 180) * (H-1)

  console.log('Génération image élévation LOLA...');
  const elevBuf = Buffer.alloc(OUT_W * OUT_H * 3);

  for (let py = 0; py < OUT_H; py++) {
    const latDeg = 90 - (py/(OUT_H-1))*180;
    const lolaRow = ((90-latDeg)/180) * (LOLA_H-1);

    for (let px = 0; px < OUT_W; px++) {
      const lonDeg = -180 + (px/(OUT_W-1))*360;
      const lon360 = ((lonDeg%360)+360)%360;
      const lolaCol = (lon360/360) * (LOLA_W-1);

      // Interpolation bilinéaire
      const r0=Math.floor(lolaRow), r1=Math.min(r0+1,LOLA_H-1);
      const c0=Math.floor(lolaCol), c1=Math.min(c0+1,LOLA_W-1);
      const fr=lolaRow-r0, fc=lolaCol-c0;
      const elev = lola[r0*LOLA_W+c0]*(1-fr)*(1-fc)
                 + lola[r0*LOLA_W+c1]*(1-fr)*fc
                 + lola[r1*LOLA_W+c0]*fr*(1-fc)
                 + lola[r1*LOLA_W+c1]*fr*fc;

      // Normaliser en 0..255
      const gray = Math.round(((elev-eMin)/(eMax-eMin))*255);
      const idx = (py*OUT_W+px)*3;
      elevBuf[idx] = gray; elevBuf[idx+1] = gray; elevBuf[idx+2] = gray;
    }
  }
  drawGrid(elevBuf);
  await sharp(elevBuf, {raw:{width:OUT_W,height:OUT_H,channels:3}})
    .jpeg({quality:92}).toFile(path.join(OUTPUT_DIR, 'elevation_equirect.jpg'));
  console.log('→ elevation_equirect.jpg');

  console.log('\nDone. Comparer photo_equirect.jpg et elevation_equirect.jpg');
  console.log('Les cratères doivent être aux mêmes coordonnées lat/lon.');
  console.log('Ligne jaune = 0°, lignes rouges = 30°, tirets = 10°.');
}

main().catch(console.error);
