/**
 * Convert IAU Gazetteer KML to a compact JSON of lunar features.
 *
 * Input:  D:\MoonOrbiterData\raw\MOON_kmz_extracted\MOON_nomenclature_center_pts.kml
 * Output: D:\MoonOrbiterData\lunar_features.json
 *
 * Usage:  npx tsx scripts/convert-iau-gazetteer.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// ─── Paths ───────────────────────────────────────────────────────
const KML_PATH = resolve('D:/MoonOrbiterData/raw/MOON_kmz_extracted/MOON_nomenclature_center_pts.kml');
const OUT_PATH = resolve('D:/MoonOrbiterData/lunar_features.json');

// ─── Types ───────────────────────────────────────────────────────
interface LunarFeature {
  name: string;
  lat: number;
  lon: number;
  diameter: number;
  type: string;
  id: number;       // USGS Gazetteer feature ID (from link field)
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Extract the text content of a SimpleData element with a given name attribute. */
function extractSimpleData(block: string, name: string): string {
  const re = new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`);
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

/** Normalize the feature type string from IAU format to a clean singular form. */
function normalizeType(raw: string): string {
  // IAU uses "Crater, craters", "Mare, maria", "Mons, montes", etc.
  const first = raw.split(',')[0].trim();
  // Satellite Features are sub-craters (e.g. "Copernicus A") → classify as Crater
  if (first === 'Satellite Feature') return 'Crater';
  return first;
}

/** Extract the USGS Gazetteer feature ID from the link field. */
function extractFeatureId(block: string): number {
  const link = extractSimpleData(block, 'link');
  const m = link.match(/Feature\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// ─── Main ────────────────────────────────────────────────────────

console.log(`Reading KML: ${KML_PATH}`);
const kml = readFileSync(KML_PATH, 'utf-8');

// Split by Placemark
const placemarks = kml.split('<Placemark ');
console.log(`Found ${placemarks.length - 1} Placemarks`);

const features: LunarFeature[] = [];
let skippedNoName = 0;
let skippedNoDiameter = 0;
let skippedNoId = 0;
let satelliteCount = 0;

for (let i = 1; i < placemarks.length; i++) {
  const block = placemarks[i];

  const name = extractSimpleData(block, 'clean_name');
  if (!name) { skippedNoName++; continue; }

  const approval = extractSimpleData(block, 'approval');
  if (approval !== 'Adopted by IAU') continue;

  const rawType = extractSimpleData(block, 'type');
  const isSatellite = rawType.startsWith('Satellite');
  const type = normalizeType(rawType);
  if (isSatellite) satelliteCount++;

  const id = extractFeatureId(block);
  if (!id) { skippedNoId++; continue; }

  const diameterStr = extractSimpleData(block, 'diameter');
  const diameter = parseFloat(diameterStr);
  if (!diameter || diameter <= 0) { skippedNoDiameter++; continue; }

  // Use center_lat and center_lon from ExtendedData (0-360 longitude system)
  const centerLon360 = parseFloat(extractSimpleData(block, 'center_lon'));
  const centerLat = parseFloat(extractSimpleData(block, 'center_lat'));

  if (isNaN(centerLon360) || isNaN(centerLat)) continue;

  // Normalize longitude: 0-360 → -180/+180
  const lon = centerLon360 > 180 ? centerLon360 - 360 : centerLon360;

  features.push({
    name,
    lat: Math.round(centerLat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
    diameter: Math.round(diameter * 100) / 100,
    type,
    id,
  });
}

// Sort by diameter descending (largest first)
features.sort((a, b) => b.diameter - a.diameter);

console.log(`\nResults:`);
console.log(`  Total features: ${features.length}`);
console.log(`  Including satellite features (sub-craters): ${satelliteCount}`);
console.log(`  Skipped no name: ${skippedNoName}`);
console.log(`  Skipped no diameter: ${skippedNoDiameter}`);
console.log(`  Skipped no USGS ID: ${skippedNoId}`);
console.log(`  Top 10:`);
for (const f of features.slice(0, 10)) {
  console.log(`    ${f.name} (${f.type}, id=${f.id}) — ${f.diameter} km at ${f.lat}°, ${f.lon}°`);
}

// Count by type
const typeCounts: Record<string, number> = {};
for (const f of features) {
  typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
}
console.log(`\n  By type:`);
for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type}: ${count}`);
}

// Write JSON
writeFileSync(OUT_PATH, JSON.stringify(features, null, 0));
const sizeMB = (Buffer.byteLength(JSON.stringify(features)) / 1024 / 1024).toFixed(2);
console.log(`\nWritten to ${OUT_PATH} (${sizeMB} MB)`);
