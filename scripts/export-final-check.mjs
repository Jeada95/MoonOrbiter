/**
 * export-final-check.mjs
 *
 * Deux images à comparer :
 * 1. photo_equirect.jpg — texture LROC via la convention UV de Three.js SphereGeometry
 * 2. ldem64_equirect.jpg — élévation directe depuis LDEM_64.IMG (le fichier source réel)
 *
 * Même projection (equirect, lon -180..+180, lat +90..-90), même grille de repères.
 * Si les cratères coïncident → les deux modes sont alignés.
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');
const OUT_W = 2048, OUT_H = 1024;

// Bitmap font minimal
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
function drawChar(buf,bx,by,ch,r,g,b){const gl=FONT[ch];if(!gl)return;for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(gl[row][col]==='1'){const px=bx+col,py=by+row;if(px>=0&&px<OUT_W&&py>=0&&py<OUT_H){const i=(py*OUT_W+px)*3;buf[i]=r;buf[i+1]=g;buf[i+2]=b;}}}
function drawText(buf,x,y,text,r,g,b){for(let i=0;i<text.length;i++)drawChar(buf,x+i*6,y,text[i],r,g,b);}

function drawGrid(buf) {
  for (let lonDeg=-180;lonDeg<=180;lonDeg+=30){
    const px=Math.round(((lonDeg+180)/360)*(OUT_W-1));
    const isZ=lonDeg===0;
    for(let py=0;py<OUT_H;py++){const i=(py*OUT_W+px)*3;if(isZ){buf[i]=255;buf[i+1]=255;buf[i+2]=0;}else{buf[i]=255;buf[i+1]=0;buf[i+2]=0;}}
    drawText(buf,px+3,OUT_H/2-10,`${lonDeg}`,255,255,255);
  }
  for(let latDeg=-90;latDeg<=90;latDeg+=30){
    const py=Math.round(((90-latDeg)/180)*(OUT_H-1));
    const isZ=latDeg===0;
    for(let px=0;px<OUT_W;px++){const i=(py*OUT_W+px)*3;if(isZ){buf[i]=255;buf[i+1]=255;buf[i+2]=0;}else{buf[i]=255;buf[i+1]=0;buf[i+2]=0;}}
    drawText(buf,10,py+3,`${latDeg}`,255,255,255);
  }
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // === IMAGE 1 : TEXTURE LROC (mode photo) ===
  console.log('Chargement texture LROC 4k...');
  const texPath = path.join(DATA_DIR, 'moon_texture_4k.jpg');
  const texMeta = await sharp(texPath).metadata();
  const texW=texMeta.width, texH=texMeta.height, texCh=texMeta.channels||3;
  const texBuf = await sharp(texPath).raw().toBuffer();

  console.log('Image photo...');
  const photoBuf = Buffer.alloc(OUT_W*OUT_H*3);
  for(let py=0;py<OUT_H;py++){
    const latDeg=90-(py/(OUT_H-1))*180;
    for(let px=0;px<OUT_W;px++){
      const lonDeg=-180+(px/(OUT_W-1))*360;
      const lonRad=lonDeg*Math.PI/180;
      const phi=((Math.PI-lonRad)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
      const u=phi/(2*Math.PI);
      const v=(90-latDeg)/180;
      const su=((u%1)+1)%1;
      const sv=Math.max(0,Math.min(0.9999,v));
      const tpx=Math.min(Math.floor(su*texW),texW-1);
      const tpy=Math.min(Math.floor(sv*texH),texH-1);
      const ti=(tpy*texW+tpx)*texCh;
      const idx=(py*OUT_W+px)*3;
      photoBuf[idx]=texBuf[ti]; photoBuf[idx+1]=texBuf[ti+1]; photoBuf[idx+2]=texBuf[ti+2];
    }
  }
  drawGrid(photoBuf);
  await sharp(photoBuf,{raw:{width:OUT_W,height:OUT_H,channels:3}}).jpeg({quality:92}).toFile(path.join(OUTPUT_DIR,'photo_equirect.jpg'));
  console.log('→ photo_equirect.jpg');

  // === IMAGE 2 : ÉLÉVATION directe depuis LDEM_64.IMG ===
  console.log('Chargement LDEM_64.IMG...');
  const ldemPath = path.join(DATA_DIR, 'raw/LDEM_64.IMG');
  const ldemBuf = fs.readFileSync(ldemPath);
  const LDEM_W=23040, LDEM_H=11520;
  const ldem = new Int16Array(ldemBuf.buffer, ldemBuf.byteOffset, LDEM_W*LDEM_H);

  let dnMin=Infinity, dnMax=-Infinity;
  for(let i=0;i<ldem.length;i++){if(ldem[i]<dnMin)dnMin=ldem[i];if(ldem[i]>dnMax)dnMax=ldem[i];}
  const eMin=dnMin*0.5, eMax=dnMax*0.5;
  console.log(`LDEM: DN ${dnMin}..${dnMax}, elev ${eMin}..${eMax} m`);

  console.log('Image élévation...');
  const elevBuf = Buffer.alloc(OUT_W*OUT_H*3);
  for(let py=0;py<OUT_H;py++){
    const latDeg=90-(py/(OUT_H-1))*180;
    // LDEM : row 0 = lat +90°, row H-1 = lat -90°
    const ldemRowF=((90-latDeg)/180)*(LDEM_H-1);
    for(let px=0;px<OUT_W;px++){
      const lonDeg=-180+(px/(OUT_W-1))*360;
      // LDEM : col 0 = lon 0°E, col W-1 = lon ~360°E
      const lon360=((lonDeg%360)+360)%360;
      const ldemColF=(lon360/360)*(LDEM_W-1);

      const r0=Math.floor(ldemRowF), r1=Math.min(r0+1,LDEM_H-1);
      const c0=Math.floor(ldemColF), c1=Math.min(c0+1,LDEM_W-1);
      const fr=ldemRowF-r0, fc=ldemColF-c0;
      const dn=ldem[r0*LDEM_W+c0]*(1-fr)*(1-fc)+ldem[r0*LDEM_W+c1]*(1-fr)*fc
               +ldem[r1*LDEM_W+c0]*fr*(1-fc)+ldem[r1*LDEM_W+c1]*fr*fc;
      const elev=dn*0.5;
      const gray=Math.round(((elev-eMin)/(eMax-eMin))*255);
      const idx=(py*OUT_W+px)*3;
      elevBuf[idx]=gray; elevBuf[idx+1]=gray; elevBuf[idx+2]=gray;
    }
  }
  drawGrid(elevBuf);
  await sharp(elevBuf,{raw:{width:OUT_W,height:OUT_H,channels:3}}).jpeg({quality:92}).toFile(path.join(OUTPUT_DIR,'ldem64_equirect.jpg'));
  console.log('→ ldem64_equirect.jpg');

  console.log('\nDone. Comparer photo_equirect.jpg et ldem64_equirect.jpg');
}

main().catch(console.error);
