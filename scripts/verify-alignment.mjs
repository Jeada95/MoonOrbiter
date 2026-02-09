/**
 * verify-alignment.mjs
 *
 * Vérifie l'alignement entre Globe (Three.js) et mesh adaptatif
 * en calculant les coordonnées 3D et UV de points connus.
 *
 * Approche honnête : on vérifie que pour un même cratère (Tycho, Copernic),
 * la POSITION 3D et l'UV pointent au bon endroit dans les deux systèmes.
 */

const SPHERE_RADIUS = 10;

// Points de référence (lat en °, lon en ° Est, lon standard -180..+180)
const LANDMARKS = [
  { name: 'Tycho',     lat: -43.3, lon: -11.4 },   // lon360 = 348.6°
  { name: 'Copernic',  lat:   9.6, lon: -20.1 },   // lon360 = 339.9°
  { name: 'Aristarque', lat: 23.7, lon: -47.5 },   // lon360 = 312.5°
  { name: 'Mare Crisium centre', lat: 17.0, lon: 59.1 }, // lon360 = 59.1°
];

console.log('=== VÉRIFICATION ALIGNEMENT GLOBE / ADAPTATIF ===\n');

for (const lm of LANDMARKS) {
  const lat = lm.lat;
  const lonStd = lm.lon; // -180..+180
  const lon360 = ((lonStd % 360) + 360) % 360;
  const latRad = lat * Math.PI / 180;
  const lonRad = lonStd * Math.PI / 180;
  const lon360Rad = lon360 * Math.PI / 180;

  console.log(`--- ${lm.name} (lat=${lat}°, lon=${lonStd}°, lon360=${lon360.toFixed(1)}°) ---`);

  // ============================================================
  // GLOBE (Three.js SphereGeometry)
  // ============================================================
  // Three.js SphereGeometry vertex formula :
  //   x = -R * cos(phi) * sin(theta)
  //   y =  R * cos(theta)
  //   z =  R * sin(phi) * sin(theta)
  // where theta = colatitude (0=north, PI=south), phi = azimuth (0..2PI from -X axis)
  //
  // Pour lat/lon :
  //   theta = PI/2 - latRad
  //   phi tel que atan2(sin(phi), -cos(phi)) = lonRad
  //   => phi = PI - lonRad
  //
  // Globe extrait lat/lon via :
  //   lat = asin(ny)
  //   lon = atan2(nz, nx)
  //
  // UV Three.js :
  //   U = phi / (2*PI), V = theta / PI

  const theta = Math.PI / 2 - latRad;
  const phi = ((Math.PI - lonRad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  const globe_x = -SPHERE_RADIUS * Math.cos(phi) * Math.sin(theta);
  const globe_y =  SPHERE_RADIUS * Math.cos(theta);
  const globe_z =  SPHERE_RADIUS * Math.sin(phi) * Math.sin(theta);
  const globe_U = phi / (2 * Math.PI);
  const globe_V = theta / Math.PI;

  // Vérification : extraire lat/lon depuis la position 3D du globe
  const gn = Math.sqrt(globe_x**2 + globe_y**2 + globe_z**2);
  const globe_lat_check = Math.asin(globe_y / gn) * 180 / Math.PI;
  const globe_lon_check = Math.atan2(globe_z, globe_x) * 180 / Math.PI;

  console.log(`  GLOBE 3D:  (${globe_x.toFixed(4)}, ${globe_y.toFixed(4)}, ${globe_z.toFixed(4)})`);
  console.log(`  GLOBE UV:  (${globe_U.toFixed(4)}, ${globe_V.toFixed(4)})`);
  console.log(`  GLOBE lat/lon check: ${globe_lat_check.toFixed(1)}° / ${globe_lon_check.toFixed(1)}° → lon360=${((globe_lon_check+360)%360).toFixed(1)}°`);

  // ============================================================
  // MESH ADAPTATIF (notre convention)
  // ============================================================
  // gridToCartesian :
  //   x = -r * cos(latRad) * cos(lon360Rad)
  //   y =  r * sin(latRad)
  //   z =  r * cos(latRad) * sin(lon360Rad)
  //
  // Note : la tuile utilise lon360 (0..360), pas lonStd (-180..+180)

  const adapt_x = -SPHERE_RADIUS * Math.cos(latRad) * Math.cos(lon360Rad);
  const adapt_y =  SPHERE_RADIUS * Math.sin(latRad);
  const adapt_z =  SPHERE_RADIUS * Math.cos(latRad) * Math.sin(lon360Rad);

  // gridToUV actuel : U = (0.5 - lon360/360) % 1
  const adapt_U = ((0.5 - lon360 / 360) % 1.0 + 1.0) % 1.0;
  const adapt_V = (90 - lat) / 180;

  console.log(`  ADAPT 3D:  (${adapt_x.toFixed(4)}, ${adapt_y.toFixed(4)}, ${adapt_z.toFixed(4)})`);
  console.log(`  ADAPT UV:  (${adapt_U.toFixed(4)}, ${adapt_V.toFixed(4)})`);

  // ============================================================
  // COMPARAISON
  // ============================================================
  const dx = globe_x - adapt_x;
  const dy = globe_y - adapt_y;
  const dz = globe_z - adapt_z;
  const dist3D = Math.sqrt(dx**2 + dy**2 + dz**2);
  const dU = Math.abs(globe_U - adapt_U);
  const dV = Math.abs(globe_V - adapt_V);

  console.log(`  DIFF 3D:   ${dist3D.toFixed(6)} ${dist3D < 0.001 ? '✅' : '❌ DÉCALÉ!'}`);
  console.log(`  DIFF UV:   dU=${dU.toFixed(6)} dV=${dV.toFixed(6)} ${dU < 0.001 && dV < 0.001 ? '✅' : '❌ DÉCALÉ!'}`);
  console.log();
}
