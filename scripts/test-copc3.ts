/**
 * Script de test 3 : Conversion cartésien → lon/lat/alt et statistiques
 * Usage : npx tsx scripts/test-copc3.ts
 */
import { Copc } from 'copc';

const TILE_URL = 'https://astrogeo-ard.s3.us-west-2.amazonaws.com/moon/lro/lola/LolaRDR_0N15N_0E15E.copc.laz';
const MOON_RADIUS_M = 1737400;
const RAD2DEG = 180 / Math.PI;

function cartesianToGeo(x: number, y: number, z: number) {
  const radius = Math.sqrt(x * x + y * y + z * z);
  const lon = Math.atan2(y, x) * RAD2DEG;
  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  const alt = radius - MOON_RADIUS_M;
  return { lon, lat, alt, radius };
}

async function main() {
  console.log('=== Conversion cartésien → lon/lat/alt ===\n');

  const copc = await Copc.create(TILE_URL);

  // Charger la hiérarchie
  const { nodes } = await Copc.loadHierarchyPage(
    TILE_URL,
    copc.info.rootHierarchyPage
  );

  // ---- Noeud racine (level 0, sous-échantillonné) ----
  const rootNode = nodes['0-0-0-0'];
  const view = await Copc.loadPointDataView(TILE_URL, copc, rootNode);

  const getX = view.getter('X');
  const getY = view.getter('Y');
  const getZ = view.getter('Z');

  console.log(`Root : ${view.pointCount.toLocaleString()} points\n`);
  console.log('  Lon (°)    | Lat (°)    | Alt (m)    | Radius (m)');
  console.log('  -----------|------------|------------|------------');

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  let minAlt = Infinity, maxAlt = -Infinity;

  for (let i = 0; i < view.pointCount; i++) {
    const { lon, lat, alt } = cartesianToGeo(getX(i), getY(i), getZ(i));

    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (alt < minAlt) minAlt = alt;
    if (alt > maxAlt) maxAlt = alt;

    if (i < 15) {
      console.log(
        `  ${lon.toFixed(4).padStart(9)} | ${lat.toFixed(4).padStart(10)} | ${alt.toFixed(1).padStart(10)} | ${(alt + MOON_RADIUS_M).toFixed(1)}`
      );
    }
  }

  console.log(`\n  Statistiques root (${view.pointCount} pts) :`);
  console.log(`    Longitude : ${minLon.toFixed(4)}° à ${maxLon.toFixed(4)}° (attendu : ~0° à ~15°)`);
  console.log(`    Latitude  : ${minLat.toFixed(4)}° à ${maxLat.toFixed(4)}° (attendu : ~0° à ~15°)`);
  console.log(`    Altitude  : ${minAlt.toFixed(1)}m à ${maxAlt.toFixed(1)}m`);

  // ---- Noeud level 4 (plus détaillé) pour voir la densité locale ----
  const nodeKeys = Object.keys(nodes);
  const level4Keys = nodeKeys.filter(k => k.startsWith('4-'));
  console.log(`\n=== Level 4 : ${level4Keys.length} noeuds ===`);

  // Prendre un noeud level 4 au milieu
  const midKey = level4Keys[Math.floor(level4Keys.length / 2)];
  const midNode = nodes[midKey];
  console.log(`\nNoeud ${midKey} : ${midNode.pointCount.toLocaleString()} points`);

  const view4 = await Copc.loadPointDataView(TILE_URL, copc, midNode);
  const getX4 = view4.getter('X');
  const getY4 = view4.getter('Y');
  const getZ4 = view4.getter('Z');

  let minLon4 = Infinity, maxLon4 = -Infinity;
  let minLat4 = Infinity, maxLat4 = -Infinity;
  let minAlt4 = Infinity, maxAlt4 = -Infinity;

  for (let i = 0; i < view4.pointCount; i++) {
    const { lon, lat, alt } = cartesianToGeo(getX4(i), getY4(i), getZ4(i));
    if (lon < minLon4) minLon4 = lon;
    if (lon > maxLon4) maxLon4 = lon;
    if (lat < minLat4) minLat4 = lat;
    if (lat > maxLat4) maxLat4 = lat;
    if (alt < minAlt4) minAlt4 = alt;
    if (alt > maxAlt4) maxAlt4 = alt;
  }

  const lonSpan4 = maxLon4 - minLon4;
  const latSpan4 = maxLat4 - minLat4;
  const areaKm2 = lonSpan4 * latSpan4 * (Math.PI / 180) ** 2 * MOON_RADIUS_M ** 2 / 1e6;
  const density = view4.pointCount / areaKm2;

  console.log(`    Longitude : ${minLon4.toFixed(4)}° à ${maxLon4.toFixed(4)}° (span: ${lonSpan4.toFixed(4)}°)`);
  console.log(`    Latitude  : ${minLat4.toFixed(4)}° à ${maxLat4.toFixed(4)}° (span: ${latSpan4.toFixed(4)}°)`);
  console.log(`    Altitude  : ${minAlt4.toFixed(1)}m à ${maxAlt4.toFixed(1)}m (range: ${(maxAlt4 - minAlt4).toFixed(1)}m)`);
  console.log(`    Surface approx : ${areaKm2.toFixed(1)} km²`);
  console.log(`    Densité : ${density.toFixed(1)} pts/km²`);

  console.log('\n=== Test terminé ===');
}

main().catch(err => {
  console.error('Erreur:', err);
  process.exit(1);
});
