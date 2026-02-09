/**
 * check-lola-bin.mjs
 *
 * Vérifie l'intégrité de lola_elevation_16ppd.bin en le comparant
 * au fichier source LDEM_64.IMG (Int16 LE, 23040x11520, 64ppd).
 *
 * Génère aussi une image directement depuis LDEM_64.IMG pour comparaison.
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const DATA_DIR = 'D:/MoonOrbiterData';
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // === 1. Vérifier lola_elevation_16ppd.bin ===
  const binPath = path.join(DATA_DIR, 'lola_elevation_16ppd.bin');
  console.log(`Vérification ${binPath}...`);
  const binBuf = fs.readFileSync(binPath);
  const binData = new Float32Array(binBuf.buffer, binBuf.byteOffset, binBuf.length / 4);
  console.log(`  Taille: ${binData.length} valeurs (${binBuf.length} bytes)`);
  console.log(`  Attendu: ${5760 * 2880} valeurs (5760x2880)`);

  let bMin = Infinity, bMax = -Infinity, nanCount = 0;
  for (let i = 0; i < binData.length; i++) {
    if (isNaN(binData[i])) { nanCount++; continue; }
    if (binData[i] < bMin) bMin = binData[i];
    if (binData[i] > bMax) bMax = binData[i];
  }
  console.log(`  Min: ${bMin.toFixed(1)}m, Max: ${bMax.toFixed(1)}m, NaN: ${nanCount}`);
  console.log(`  (Attendu: environ -9130m à +10786m)`);

  // Échantillons
  console.log(`  [0,0] (nord, lon0): ${binData[0].toFixed(1)}m`);
  console.log(`  [0,2880] (nord, lon180): ${binData[2880].toFixed(1)}m`);
  console.log(`  [1440*5760] (centre, lon0): ${binData[1440 * 5760].toFixed(1)}m`);

  // === 2. Charger LDEM_64.IMG directement ===
  const ldemPath = path.join(DATA_DIR, 'raw/LDEM_64.IMG');
  if (!fs.existsSync(ldemPath)) {
    console.log(`\n⚠️  ${ldemPath} introuvable, skip comparaison directe`);
  } else {
    console.log(`\nChargement LDEM_64.IMG (23040x11520, Int16 LE)...`);
    const ldemBuf = fs.readFileSync(ldemPath);
    const ldem = new Int16Array(ldemBuf.buffer, ldemBuf.byteOffset, 23040 * 11520);
    console.log(`  ${ldem.length} valeurs`);

    let lMin = Infinity, lMax = -Infinity;
    for (let i = 0; i < ldem.length; i++) {
      if (ldem[i] < lMin) lMin = ldem[i];
      if (ldem[i] > lMax) lMax = ldem[i];
    }
    console.log(`  DN min: ${lMin}, DN max: ${lMax}`);
    console.log(`  Altitude min: ${lMin * 0.5}m, max: ${lMax * 0.5}m`);

    // === 3. Générer une image directement depuis LDEM_64 ===
    const W = 2048, H = 1024;
    const LDEM_W = 23040, LDEM_H = 11520;
    const eMin = lMin * 0.5, eMax = lMax * 0.5;

    console.log('\nGénération image LDEM directe...');
    const imgBuf = Buffer.alloc(W * H * 3);

    for (let py = 0; py < H; py++) {
      const latDeg = 90 - (py / (H - 1)) * 180;
      const ldemRow = ((90 - latDeg) / 180) * (LDEM_H - 1);

      for (let px = 0; px < W; px++) {
        const lonDeg = -180 + (px / (W - 1)) * 360;
        const lon360 = ((lonDeg % 360) + 360) % 360;
        const ldemCol = (lon360 / 360) * (LDEM_W - 1);

        const r0 = Math.floor(ldemRow), r1 = Math.min(r0 + 1, LDEM_H - 1);
        const c0 = Math.floor(ldemCol), c1 = Math.min(c0 + 1, LDEM_W - 1);
        const fr = ldemRow - r0, fc = ldemCol - c0;

        const dn = ldem[r0*LDEM_W+c0]*(1-fr)*(1-fc)
                  + ldem[r0*LDEM_W+c1]*(1-fr)*fc
                  + ldem[r1*LDEM_W+c0]*fr*(1-fc)
                  + ldem[r1*LDEM_W+c1]*fr*fc;
        const elev = dn * 0.5;

        const gray = Math.round(((elev - eMin) / (eMax - eMin)) * 255);
        const idx = (py * W + px) * 3;
        imgBuf[idx] = gray; imgBuf[idx + 1] = gray; imgBuf[idx + 2] = gray;
      }
    }

    // Grille
    for (let lonDeg = -180; lonDeg <= 180; lonDeg += 30) {
      const px = Math.round(((lonDeg+180)/360)*(W-1));
      const isZ = lonDeg===0;
      for (let py=0; py<H; py++) {
        const i=(py*W+px)*3;
        if(isZ){imgBuf[i]=255;imgBuf[i+1]=255;imgBuf[i+2]=0;}
        else{imgBuf[i]=255;imgBuf[i+1]=0;imgBuf[i+2]=0;}
      }
    }
    for (let latDeg = -90; latDeg <= 90; latDeg += 30) {
      const py = Math.round(((90-latDeg)/180)*(H-1));
      const isZ = latDeg===0;
      for (let px=0; px<W; px++) {
        const i=(py*W+px)*3;
        if(isZ){imgBuf[i]=255;imgBuf[i+1]=255;imgBuf[i+2]=0;}
        else{imgBuf[i]=255;imgBuf[i+1]=0;imgBuf[i+2]=0;}
      }
    }

    await sharp(imgBuf, { raw: { width: W, height: H, channels: 3 } })
      .jpeg({ quality: 92 })
      .toFile(path.join(OUTPUT_DIR, 'ldem64_direct.jpg'));
    console.log('→ ldem64_direct.jpg (image directe depuis LDEM_64.IMG)');
  }

  // === 4. Re-générer l'image depuis lola_elevation_16ppd.bin ===
  console.log('\nGénération image lola_16ppd...');
  const W = 2048, H = 1024;
  const LOLA_W = 5760, LOLA_H = 2880;
  const imgBuf2 = Buffer.alloc(W * H * 3);

  for (let py = 0; py < H; py++) {
    const latDeg = 90 - (py / (H - 1)) * 180;
    const lolaRow = ((90 - latDeg) / 180) * (LOLA_H - 1);

    for (let px = 0; px < W; px++) {
      const lonDeg = -180 + (px / (W - 1)) * 360;
      const lon360 = ((lonDeg % 360) + 360) % 360;
      const lolaCol = (lon360 / 360) * (LOLA_W - 1);

      const r0 = Math.floor(lolaRow), r1 = Math.min(r0 + 1, LOLA_H - 1);
      const c0 = Math.floor(lolaCol), c1 = Math.min(c0 + 1, LOLA_W - 1);
      const fr = lolaRow - r0, fc = lolaCol - c0;

      const elev = binData[r0*LOLA_W+c0]*(1-fr)*(1-fc)
                 + binData[r0*LOLA_W+c1]*(1-fr)*fc
                 + binData[r1*LOLA_W+c0]*fr*(1-fc)
                 + binData[r1*LOLA_W+c1]*fr*fc;

      const gray = Math.round(((elev - bMin) / (bMax - bMin)) * 255);
      const idx = (py * W + px) * 3;
      imgBuf2[idx] = gray; imgBuf2[idx + 1] = gray; imgBuf2[idx + 2] = gray;
    }
  }

  for (let lonDeg = -180; lonDeg <= 180; lonDeg += 30) {
    const px = Math.round(((lonDeg+180)/360)*(W-1));
    const isZ = lonDeg===0;
    for (let py=0; py<H; py++) {
      const i=(py*W+px)*3;
      if(isZ){imgBuf2[i]=255;imgBuf2[i+1]=255;imgBuf2[i+2]=0;}
      else{imgBuf2[i]=255;imgBuf2[i+1]=0;imgBuf2[i+2]=0;}
    }
  }
  for (let latDeg = -90; latDeg <= 90; latDeg += 30) {
    const py = Math.round(((90-latDeg)/180)*(H-1));
    const isZ = latDeg===0;
    for (let px=0; px<W; px++) {
      const i=(py*W+px)*3;
      if(isZ){imgBuf2[i]=255;imgBuf2[i+1]=255;imgBuf2[i+2]=0;}
      else{imgBuf2[i]=255;imgBuf2[i+1]=0;imgBuf2[i+2]=0;}
    }
  }

  await sharp(imgBuf2, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toFile(path.join(OUTPUT_DIR, 'lola16ppd_bin.jpg'));
  console.log('→ lola16ppd_bin.jpg (image depuis lola_elevation_16ppd.bin)');

  // === 5. Comparer quelques valeurs bin vs LDEM ===
  if (fs.existsSync(path.join(DATA_DIR, 'raw/LDEM_64.IMG'))) {
    const ldemBuf = fs.readFileSync(path.join(DATA_DIR, 'raw/LDEM_64.IMG'));
    const ldem = new Int16Array(ldemBuf.buffer, ldemBuf.byteOffset, 23040 * 11520);

    console.log('\nComparaison ponctuelle bin vs LDEM:');
    // Point (lat=0, lon=0) → LDEM row=5760, col=0; bin row=1440, col=0
    const ldemVal = ldem[5760 * 23040 + 0] * 0.5;
    const binVal = binData[1440 * 5760 + 0];
    console.log(`  (lat=0,lon=0): LDEM=${ldemVal.toFixed(1)}m, bin=${binVal.toFixed(1)}m`);

    // Point (lat=-43, lon=349) ≈ Tycho
    const tLdemRow = Math.round((90 - (-43)) / 180 * 11519);
    const tLdemCol = Math.round(349 / 360 * 23039);
    const tBinRow = Math.round((90 - (-43)) / 180 * 2879);
    const tBinCol = Math.round(349 / 360 * 5759);
    const tLdem = ldem[tLdemRow * 23040 + tLdemCol] * 0.5;
    const tBin = binData[tBinRow * 5760 + tBinCol];
    console.log(`  Tycho (~-43,349): LDEM=${tLdem.toFixed(1)}m, bin=${tBin.toFixed(1)}m`);
  }

  console.log('\nDone. Compare ldem64_direct.jpg et lola16ppd_bin.jpg');
}

main().catch(console.error);
