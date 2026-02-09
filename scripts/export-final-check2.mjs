/**
 * export-final-check2.mjs
 *
 * Simule exactement les conventions du code actuel :
 *
 * 1. photo : Globe UV miré (u_new = 1 - u_threejs) appliqué à la texture LROC
 * 2. elevation : LDEM_64.IMG direct, projection equirect standard
 *
 * Si les cratères coïncident → les deux modes sont alignés.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/MoonOrbiterData';
const OUTPUT_DIR = path.join(DATA_DIR, 'debug');
const OUT_W = 2048, OUT_H = 1024;

const FONT={'0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00110','01000','10000','11111'],'3':['01110','10001','00001','00110','00001','10001','01110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','11110','00001','00001','10001','01110'],'6':['01110','10000','11110','10001','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],'-':['00000','00000','00000','11111','00000','00000','00000'],' ':['00000','00000','00000','00000','00000','00000','00000']};
function drawChar(buf,bx,by,ch,r,g,b){const gl=FONT[ch];if(!gl)return;for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(gl[row][col]==='1'){const px=bx+col,py=by+row;if(px>=0&&px<OUT_W&&py>=0&&py<OUT_H){const i=(py*OUT_W+px)*3;buf[i]=r;buf[i+1]=g;buf[i+2]=b;}}}
function drawText(buf,x,y,text,r,g,b){for(let i=0;i<text.length;i++)drawChar(buf,x+i*6,y,text[i],r,g,b);}
function drawGrid(buf){
  for(let lonDeg=-180;lonDeg<=180;lonDeg+=30){const px=Math.round(((lonDeg+180)/360)*(OUT_W-1));const isZ=lonDeg===0;for(let py=0;py<OUT_H;py++){const i=(py*OUT_W+px)*3;if(isZ){buf[i]=255;buf[i+1]=255;buf[i+2]=0;}else{buf[i]=255;buf[i+1]=0;buf[i+2]=0;}}drawText(buf,px+3,OUT_H/2-10,`${lonDeg}`,255,255,255);}
  for(let latDeg=-90;latDeg<=90;latDeg+=30){const py=Math.round(((90-latDeg)/180)*(OUT_H-1));const isZ=latDeg===0;for(let px=0;px<OUT_W;px++){const i=(py*OUT_W+px)*3;if(isZ){buf[i]=255;buf[i+1]=255;buf[i+2]=0;}else{buf[i]=255;buf[i+1]=0;buf[i+2]=0;}}drawText(buf,10,py+3,`${latDeg}`,255,255,255);}
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Charger texture LROC
  const texPath = path.join(DATA_DIR, 'moon_texture_4k.jpg');
  const texMeta = await sharp(texPath).metadata();
  const texW=texMeta.width, texH=texMeta.height, texCh=texMeta.channels||3;
  const texBuf = await sharp(texPath).raw().toBuffer();
  function sampleTex(u,v){
    u=((u%1)+1)%1; v=Math.max(0,Math.min(0.9999,v));
    const px=Math.min(Math.floor(u*texW),texW-1);
    const py=Math.min(Math.floor(v*texH),texH-1);
    const i=(py*texW+px)*texCh;
    return[texBuf[i],texBuf[i+1],texBuf[i+2]];
  }

  // === IMAGE 1 : GLOBE avec UV miré ===
  // Code Globe.ts : u_new = 1 - u_threejs
  // u_threejs = phi/(2PI), phi = (PI - lonRad)
  // u_new = 1 - (PI - lonRad)/(2PI) = 0.5 + lonRad/(2PI) = 0.5 + lonDeg/360
  console.log('Image Globe (UV miré)...');
  const photoBuf = Buffer.alloc(OUT_W*OUT_H*3);
  for(let py=0;py<OUT_H;py++){
    const latDeg=90-(py/(OUT_H-1))*180;
    for(let px=0;px<OUT_W;px++){
      const lonDeg=-180+(px/(OUT_W-1))*360;
      // UV miré du Globe
      const u = 0.5 + lonDeg / 360;  // lonDeg -180..+180 → U -0..1
      const v = (90 - latDeg) / 180;
      const [r,g,b] = sampleTex(u, v);
      const idx=(py*OUT_W+px)*3;
      photoBuf[idx]=r; photoBuf[idx+1]=g; photoBuf[idx+2]=b;
    }
  }
  drawGrid(photoBuf);
  await sharp(photoBuf,{raw:{width:OUT_W,height:OUT_H,channels:3}}).jpeg({quality:92}).toFile(path.join(OUTPUT_DIR,'photo_mirrored_equirect.jpg'));
  console.log('→ photo_mirrored_equirect.jpg');

  // === IMAGE 2 : LDEM_64.IMG direct ===
  console.log('Image LDEM...');
  const ldemPath = path.join(DATA_DIR, 'raw/LDEM_64.IMG');
  const ldemBuf = fs.readFileSync(ldemPath);
  const LDEM_W=23040, LDEM_H=11520;
  const ldem=new Int16Array(ldemBuf.buffer,ldemBuf.byteOffset,LDEM_W*LDEM_H);
  let dnMin=Infinity,dnMax=-Infinity;
  for(let i=0;i<ldem.length;i++){if(ldem[i]<dnMin)dnMin=ldem[i];if(ldem[i]>dnMax)dnMax=ldem[i];}
  const eMin=dnMin*0.5, eMax=dnMax*0.5;

  const elevBuf = Buffer.alloc(OUT_W*OUT_H*3);
  for(let py=0;py<OUT_H;py++){
    const latDeg=90-(py/(OUT_H-1))*180;
    const ldemRowF=((90-latDeg)/180)*(LDEM_H-1);
    for(let px=0;px<OUT_W;px++){
      const lonDeg=-180+(px/(OUT_W-1))*360;
      const lon360=((lonDeg%360)+360)%360;
      const ldemColF=(lon360/360)*(LDEM_W-1);
      const r0=Math.floor(ldemRowF),r1=Math.min(r0+1,LDEM_H-1);
      const c0=Math.floor(ldemColF),c1=Math.min(c0+1,LDEM_W-1);
      const fr=ldemRowF-r0,fc=ldemColF-c0;
      const dn=ldem[r0*LDEM_W+c0]*(1-fr)*(1-fc)+ldem[r0*LDEM_W+c1]*(1-fr)*fc+ldem[r1*LDEM_W+c0]*fr*(1-fc)+ldem[r1*LDEM_W+c1]*fr*fc;
      const gray=Math.round(((dn*0.5-eMin)/(eMax-eMin))*255);
      const idx=(py*OUT_W+px)*3;
      elevBuf[idx]=gray;elevBuf[idx+1]=gray;elevBuf[idx+2]=gray;
    }
  }
  drawGrid(elevBuf);
  await sharp(elevBuf,{raw:{width:OUT_W,height:OUT_H,channels:3}}).jpeg({quality:92}).toFile(path.join(OUTPUT_DIR,'ldem64_equirect.jpg'));
  console.log('→ ldem64_equirect.jpg');

  console.log('\nDone.');
}
main().catch(console.error);
