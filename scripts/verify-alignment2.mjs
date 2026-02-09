/**
 * verify-alignment2.mjs — Dérivation rigoureuse de la correspondance.
 *
 * Three.js SphereGeometry (source code, phiStart=0, phiLength=2PI) :
 *   phi va de 0 à 2PI (paramètre U = phi/(2PI))
 *   theta va de 0 à PI (paramètre V = theta/PI)
 *
 *   vertex.x = -R * cos(phi) * sin(theta)
 *   vertex.y =  R * cos(theta)
 *   vertex.z =  R * sin(phi) * sin(theta)
 *
 * Relations avec lat/lon :
 *   theta = PI/2 - lat  (0 au nord, PI au sud)
 *   sin(theta) = cos(lat), cos(theta) = sin(lat)
 *
 *   En substituant :
 *   vertex.x = -R * cos(phi) * cos(lat)
 *   vertex.y =  R * sin(lat)
 *   vertex.z =  R * sin(phi) * cos(lat)
 *
 * Globe.ts extrait lon via : lon_rad = atan2(nz, nx)
 *   = atan2(sin(phi)*cos(lat), -cos(phi)*cos(lat))
 *   = atan2(sin(phi), -cos(phi))
 *   = PI - phi   (pour phi dans [0, 2PI], résultat dans [-PI, +PI])
 *
 * Donc phi = PI - lon_rad, et on peut écrire :
 *   cos(phi) = cos(PI - lon_rad) = -cos(lon_rad)
 *   sin(phi) = sin(PI - lon_rad) = sin(lon_rad)
 *
 * En substituant :
 *   vertex.x = -R * (-cos(lon_rad)) * cos(lat) = +R * cos(lon_rad) * cos(lat)
 *   vertex.y = R * sin(lat)
 *   vertex.z = R * sin(lon_rad) * cos(lat)
 *
 * CONCLUSION : pour lon en [-PI, +PI], la formule 3D est :
 *   x = +R * cos(lat) * cos(lon)
 *   y = +R * sin(lat)
 *   z = +R * cos(lat) * sin(lon)
 *
 * C'est exactement la formule standard SANS inversion de X !
 *
 * MAIS : notre grille utilise lon360 (0..360), pas lonStd (-180..+180).
 * cos et sin sont 2PI-périodiques, donc cos(lon360) = cos(lonStd) et sin(lon360) = sin(lonStd).
 * La formule reste identique.
 *
 * VÉRIFICATION UV :
 * U_threejs = phi / (2PI) = (PI - lon_rad) / (2PI) = 0.5 - lon_rad/(2PI) = 0.5 - lonDeg/360
 * Pour lon360 : lonDeg = lon360 quand lon360 < 180, sinon lonDeg = lon360 - 360
 *   0.5 - lonDeg/360 = 0.5 - ((lon360 > 180 ? lon360-360 : lon360) / 360)
 * Simplifions : 0.5 - lon360/360 + (lon360 > 180 ? 1 : 0)
 *   = (0.5 - lon360/360) mod 1
 * C'est bien la formule qu'on a ! ✅
 */

const SPHERE_RADIUS = 10;

const LANDMARKS = [
  { name: 'Tycho',     lat: -43.3, lon: -11.4 },
  { name: 'Copernic',  lat:   9.6, lon: -20.1 },
  { name: 'Aristarque', lat: 23.7, lon: -47.5 },
  { name: 'Mare Crisium', lat: 17.0, lon: 59.1 },
];

console.log('=== VÉRIFICATION AVEC FORMULE CORRECTE (X POSITIF) ===\n');

for (const lm of LANDMARKS) {
  const lat = lm.lat;
  const lonStd = lm.lon;
  const lon360 = ((lonStd % 360) + 360) % 360;
  const latRad = lat * Math.PI / 180;
  const lonStdRad = lonStd * Math.PI / 180;
  const lon360Rad = lon360 * Math.PI / 180;

  console.log(`--- ${lm.name} (lat=${lat}°, lon=${lonStd}°, lon360=${lon360.toFixed(1)}°) ---`);

  // Globe Three.js (via substitution phi = PI - lon)
  const globe_x = SPHERE_RADIUS * Math.cos(latRad) * Math.cos(lonStdRad);
  const globe_y = SPHERE_RADIUS * Math.sin(latRad);
  const globe_z = SPHERE_RADIUS * Math.cos(latRad) * Math.sin(lonStdRad);

  // Adaptatif CORRIGÉ (X positif, lon360)
  const adapt_x = SPHERE_RADIUS * Math.cos(latRad) * Math.cos(lon360Rad);
  const adapt_y = SPHERE_RADIUS * Math.sin(latRad);
  const adapt_z = SPHERE_RADIUS * Math.cos(latRad) * Math.sin(lon360Rad);

  // UV
  const globe_phi = ((Math.PI - lonStdRad) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  const globe_U = globe_phi / (2 * Math.PI);
  const globe_V = (90 - lat) / 180;

  const adapt_U = ((0.5 - lon360/360) % 1.0 + 1.0) % 1.0;
  const adapt_V = (90 - lat) / 180;

  const dx = globe_x - adapt_x;
  const dy = globe_y - adapt_y;
  const dz = globe_z - adapt_z;
  const dist3D = Math.sqrt(dx**2 + dy**2 + dz**2);
  const dU = Math.abs(globe_U - adapt_U);

  console.log(`  GLOBE: (${globe_x.toFixed(4)}, ${globe_y.toFixed(4)}, ${globe_z.toFixed(4)}) UV(${globe_U.toFixed(4)}, ${globe_V.toFixed(4)})`);
  console.log(`  ADAPT: (${adapt_x.toFixed(4)}, ${adapt_y.toFixed(4)}, ${adapt_z.toFixed(4)}) UV(${adapt_U.toFixed(4)}, ${adapt_V.toFixed(4)})`);
  console.log(`  DIFF:  3D=${dist3D.toFixed(6)} UV=${dU.toFixed(6)} ${dist3D < 0.001 && dU < 0.001 ? '✅ ALIGNÉ' : '❌'}`);
  console.log();
}
