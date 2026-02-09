/**
 * Script de test 2 : Comprendre le système de coordonnées COPC LOLA
 * Usage : npx tsx scripts/test-copc2.ts
 */
import { Copc } from 'copc';

const TILE_URL = 'https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/lro/lola/LolaRDR_0N15N_0E15E.copc.laz';
const MOON_RADIUS_M = 1737400;

async function main() {
  console.log('=== Analyse du système de coordonnées COPC LOLA ===\n');

  const copc = await Copc.create(TILE_URL);

  // Afficher le WKT (projection)
  console.log('WKT (projection) :');
  console.log(copc.wkt || '(pas de WKT)');

  console.log('\nHeader complet :');
  console.log(JSON.stringify(copc.header, null, 2));

  console.log('\nInfo COPC :');
  console.log(JSON.stringify(copc.info, null, 2));

  // Charger les points root
  const { nodes } = await Copc.loadHierarchyPage(
    TILE_URL,
    copc.info.rootHierarchyPage
  );

  const rootNode = nodes['0-0-0-0'];
  const view = await Copc.loadPointDataView(TILE_URL, copc, rootNode);

  const getX = view.getter('X');
  const getY = view.getter('Y');
  const getZ = view.getter('Z');

  // Calculer la norme de quelques vecteurs pour voir si c'est du cartésien 3D
  console.log('\n=== Analyse des 20 premiers points ===');
  console.log('  X           | Y           | Z           | Norme (m)    | Norme-R (m)');
  console.log('  ------------|-------------|-------------|--------------|------------');

  for (let i = 0; i < 20; i++) {
    const x = getX(i);
    const y = getY(i);
    const z = getZ(i);
    const norm = Math.sqrt(x * x + y * y + z * z);

    console.log(
      `  ${x.toFixed(1).padStart(11)} | ${y.toFixed(1).padStart(11)} | ${z.toFixed(1).padStart(11)} | ${norm.toFixed(1).padStart(12)} | ${(norm - MOON_RADIUS_M).toFixed(1).padStart(10)}`
    );
  }

  // Hypothèse : c'est Lon (°), Lat (°), Radius (m) ?
  // Le nom de la tuile dit "0N15N_0E15E" donc lat=0-15, lon=0-15
  // Regardons la Scale et l'Offset du header LAS
  console.log('\n=== Hypothèse : Scale/Offset appliqué par copc.js ===');
  console.log(`Scale: [${copc.header.scale}]`);
  console.log(`Offset: [${copc.header.offset}]`);

  // copc.js applique déjà scale+offset, donc X = raw * scale[0] + offset[0]
  // Offset X = 1679167 → ~rayon lunaire ? Non, c'est l'offset des entiers internes.
  // Si X brut va de ~1.6M à ~1.7M, c'est dans la plage du rayon lunaire

  // Hypothèse alternative : IAU 30100 = coordonnées sphériques (lon, lat, radius)
  // avec lon en mètres d'arc ? Vérifions.
  // Circumference lunaire = 2 * pi * 1737400 = 10,917,353 m
  // 15° en mètres d'arc = 10,917,353 * 15/360 = 454,889 m
  // Y va de 0 à ~450K → ça colle !

  const circumference = 2 * Math.PI * MOON_RADIUS_M;
  const deg15_in_meters = circumference * 15 / 360;
  console.log(`\n=== Hypothèse : mètres d'arc ===`);
  console.log(`Circumférence lunaire : ${circumference.toFixed(0)} m`);
  console.log(`15° en mètres d'arc : ${deg15_in_meters.toFixed(0)} m`);
  console.log(`Y max observé : ~450K → ${(450000 / deg15_in_meters * 15).toFixed(2)}°`);

  // Mais X va de 1.6M à 1.7M... c'est bien le rayon
  // Donc le format est : X = rayon (m), Y = lon (mètres d'arc), Z = lat (mètres d'arc) ?
  // Ou bien X = lon (°/1000), Y = lat (°/1000), Z = radius (m) ?

  // Regardons le premier point :
  const x0 = getX(0), y0 = getY(0), z0 = getZ(0);
  console.log(`\nPremier point : X=${x0}, Y=${y0}, Z=${z0}`);

  // Convertir Y et Z de mètres d'arc en degrés
  const y0_deg = y0 / circumference * 360;
  const z0_deg = z0 / circumference * 360;
  console.log(`Si Y = lon en m d'arc → lon = ${y0_deg.toFixed(4)}°`);
  console.log(`Si Z = lat en m d'arc → lat = ${z0_deg.toFixed(4)}°`);
  console.log(`Si X = rayon → alt = ${(x0 - MOON_RADIUS_M).toFixed(1)} m`);

  // Dimensions disponibles dans le point data
  console.log('\n=== Dimensions disponibles ===');
  console.log(`pointCount: ${view.pointCount}`);
  // Essayons d'accéder à d'autres dimensions
  try {
    const dims = ['X', 'Y', 'Z', 'Intensity', 'ReturnNumber', 'NumberOfReturns',
      'Classification', 'GpsTime', 'ScanAngleRank', 'UserData', 'PointSourceId'];
    for (const dim of dims) {
      try {
        const getter = view.getter(dim);
        console.log(`  ${dim} : ${getter(0)}`);
      } catch {
        console.log(`  ${dim} : non disponible`);
      }
    }
  } catch (e) {
    console.log('Erreur dimensions:', e);
  }
}

main().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
