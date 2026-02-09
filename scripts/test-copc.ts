/**
 * Script de test : lecture d'une tuile COPC LOLA depuis AWS S3
 * Usage : npx tsx scripts/test-copc.ts
 */
import { Copc, Hierarchy, Key } from 'copc';

const TILE_URL = 'https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/lro/lola/LolaRDR_0N15N_0E15E.copc.laz';
const MOON_RADIUS_M = 1737400; // rayon de référence en mètres

async function main() {
  console.log('=== Test COPC LOLA ===');
  console.log(`Tuile : ${TILE_URL}\n`);

  // 1. Ouvrir le fichier COPC (ne lit que le header, quelques KB)
  console.log('1. Ouverture du header COPC...');
  const copc = await Copc.create(TILE_URL);

  console.log('Header LAS :');
  console.log(`  Version : ${copc.header.majorVersion}.${copc.header.minorVersion}`);
  console.log(`  Point count : ${copc.header.pointCount.toLocaleString()}`);
  console.log(`  Point format : ${copc.header.pointDataRecordFormat}`);
  console.log(`  Scale : [${copc.header.scale.join(', ')}]`);
  console.log(`  Offset : [${copc.header.offset.join(', ')}]`);
  console.log(`  Min : [${copc.header.min.join(', ')}]`);
  console.log(`  Max : [${copc.header.max.join(', ')}]`);

  console.log('\nInfo COPC :');
  console.log(`  Cube center : [${copc.info.cube[0]}, ${copc.info.cube[1]}, ${copc.info.cube[2]}]`);
  console.log(`  Cube halfSize : ${copc.info.cube[3]}`);
  console.log(`  Spacing : ${copc.info.spacing}`);

  // 2. Charger la hiérarchie (octree)
  console.log('\n2. Chargement de la hiérarchie...');
  const hierarchyPage = await Copc.loadHierarchyPage(
    TILE_URL,
    copc.info.rootHierarchyPage
  );

  const nodeKeys = Object.keys(hierarchyPage.nodes);
  console.log(`  Nombre de noeuds : ${nodeKeys.length}`);

  // Compter les points par niveau
  const levelCounts: Record<number, { nodes: number; points: number }> = {};
  for (const key of nodeKeys) {
    const level = parseInt(key.split('-')[0]);
    if (!levelCounts[level]) levelCounts[level] = { nodes: 0, points: 0 };
    levelCounts[level].nodes++;
    levelCounts[level].points += hierarchyPage.nodes[key].pointCount;
  }

  console.log('\n  Points par niveau :');
  for (const [level, counts] of Object.entries(levelCounts).sort((a, b) => +a[0] - +b[0])) {
    console.log(`    Level ${level} : ${counts.nodes} noeuds, ${counts.points.toLocaleString()} points`);
  }

  // 3. Charger les points du noeud racine (level 0)
  console.log('\n3. Chargement des points du noeud racine (level 0)...');
  const rootKey = '0-0-0-0';
  const rootNode = hierarchyPage.nodes[rootKey];

  if (!rootNode) {
    console.log('  Pas de noeud racine trouvé !');
    return;
  }

  console.log(`  Root node : ${rootNode.pointCount.toLocaleString()} points, ${rootNode.pointDataLength} bytes`);

  const view = await Copc.loadPointDataView(TILE_URL, copc, rootNode);

  const getX = view.getter('X');
  const getY = view.getter('Y');
  const getZ = view.getter('Z');
  const getIntensity = view.getter('Intensity');

  console.log(`\n  Premiers 10 points :`);
  console.log('  Lon (°)     | Lat (°)     | Rayon (m)      | Alt (m)    | Intensité');
  console.log('  ------------|-------------|----------------|------------|----------');

  const sampleSize = Math.min(10, view.pointCount);
  let minAlt = Infinity, maxAlt = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (let i = 0; i < view.pointCount; i++) {
    const lon = getX(i);
    const lat = getY(i);
    const radius = getZ(i);
    const alt = radius - MOON_RADIUS_M;

    if (alt < minAlt) minAlt = alt;
    if (alt > maxAlt) maxAlt = alt;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;

    if (i < sampleSize) {
      const intensity = getIntensity(i);
      console.log(
        `  ${lon.toFixed(5).padStart(11)} | ${lat.toFixed(5).padStart(11)} | ${radius.toFixed(1).padStart(14)} | ${alt.toFixed(1).padStart(10)} | ${intensity}`
      );
    }
  }

  console.log(`\n  Statistiques sur ${view.pointCount.toLocaleString()} points (root) :`);
  console.log(`    Longitude : ${minLon.toFixed(4)}° à ${maxLon.toFixed(4)}°`);
  console.log(`    Latitude  : ${minLat.toFixed(4)}° à ${maxLat.toFixed(4)}°`);
  console.log(`    Altitude  : ${minAlt.toFixed(1)}m à ${maxAlt.toFixed(1)}m`);

  // 4. Tester un noeud plus profond (level 1 ou 2) pour voir la densité
  const level1Keys = nodeKeys.filter(k => k.startsWith('1-'));
  if (level1Keys.length > 0) {
    const testKey = level1Keys[0];
    const testNode = hierarchyPage.nodes[testKey];
    console.log(`\n4. Test noeud level 1 (${testKey}) : ${testNode.pointCount.toLocaleString()} points`);

    const view1 = await Copc.loadPointDataView(TILE_URL, copc, testNode);
    const getX1 = view1.getter('X');
    const getY1 = view1.getter('Y');
    const getZ1 = view1.getter('Z');

    let minAlt1 = Infinity, maxAlt1 = -Infinity;
    for (let i = 0; i < view1.pointCount; i++) {
      const alt = getZ1(i) - MOON_RADIUS_M;
      if (alt < minAlt1) minAlt1 = alt;
      if (alt > maxAlt1) maxAlt1 = alt;
    }

    console.log(`    Altitude : ${minAlt1.toFixed(1)}m à ${maxAlt1.toFixed(1)}m`);
    console.log(`    Lon : ${getX1(0).toFixed(4)}° à ${getX1(view1.pointCount - 1).toFixed(4)}°`);
    console.log(`    Lat : ${getY1(0).toFixed(4)}° à ${getY1(view1.pointCount - 1).toFixed(4)}°`);
  }

  console.log('\n=== Test terminé ===');
}

main().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
