/**
 * Computes the Sun's direction as seen from the Moon's center at a given UTC date,
 * expressed in MoonOrbiter's Three.js coordinate system (Y-up, selenographic).
 *
 * Uses astronomy-engine for J2000 equatorial positions + IAU rotation axis.
 */

import * as THREE from 'three';
import {
  Body,
  MakeTime,
  HelioVector,
  GeoMoon,
  RotationAxis,
} from 'astronomy-engine';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Reusable vectors (avoid per-call allocations)
const _j2000Z = new THREE.Vector3(0, 0, 1); // J2000 equatorial north pole
const _sunJ2000 = new THREE.Vector3();
const _zBody = new THREE.Vector3();
const _xPrelim = new THREE.Vector3();
const _xBody = new THREE.Vector3();
const _yBody = new THREE.Vector3();
const _quat = new THREE.Quaternion();

export interface SunInfo {
  /** Normalized direction vector from Moon center to Sun, in Three.js Y-up coords */
  direction: THREE.Vector3;
  /** Sub-solar selenographic latitude in degrees (-90..+90) */
  subSolarLat: number;
  /** Sub-solar selenographic longitude in degrees (-180..+180) */
  subSolarLon: number;
}

/**
 * Compute the Sun's position relative to the Moon at a given UTC date.
 *
 * Algorithm:
 * 1. Compute Earth heliocentric position (J2000 equatorial)
 * 2. Compute Moon geocentric position (J2000 equatorial)
 * 3. Moon heliocentric = Earth helio + Moon geo
 * 4. Sun direction from Moon = -moonHelio (normalized)
 * 5. Get Moon's IAU rotation axis (north pole + spin)
 * 6. Build selenographic body-fixed frame
 * 7. Project sun direction into body frame → selenographic lat/lon
 * 8. Convert to Three.js coordinates
 */
export function computeSunPosition(date: Date): SunInfo {
  const time = MakeTime(date);

  // 1. Earth heliocentric position in J2000 equatorial (AU)
  const earthHelio = HelioVector(Body.Earth, time);

  // 2. Moon geocentric position in J2000 equatorial (AU)
  const moonGeo = GeoMoon(time);

  // 3. Moon heliocentric = Earth heliocentric + Moon geocentric
  const mhx = earthHelio.x + moonGeo.x;
  const mhy = earthHelio.y + moonGeo.y;
  const mhz = earthHelio.z + moonGeo.z;

  // 4. Sun direction from Moon center (J2000 equatorial) = -moonHelio, normalized
  //    J2000 eq: X→vernal equinox, Z→north celestial pole
  const len = Math.sqrt(mhx * mhx + mhy * mhy + mhz * mhz);
  _sunJ2000.set(-mhx / len, -mhy / len, -mhz / len);

  // 5. Moon's IAU rotation axis
  const axis = RotationAxis(Body.Moon, time);
  //    axis.north = unit vector of Moon's north pole in J2000 equatorial
  //    axis.spin  = prime meridian angle W (degrees)

  // 6. Build selenographic body-fixed frame in J2000 coordinates
  //    Zbody = Moon north pole
  _zBody.set(axis.north.x, axis.north.y, axis.north.z);

  //    Xprelim = ascending node direction = cross(J2000_Z, Zbody)
  _xPrelim.crossVectors(_j2000Z, _zBody).normalize();

  //    Rotate Xprelim around Zbody by spin angle to get Xbody (prime meridian)
  _quat.setFromAxisAngle(_zBody, axis.spin * DEG2RAD);
  _xBody.copy(_xPrelim).applyQuaternion(_quat);

  //    Ybody = cross(Zbody, Xbody) — completes right-handed frame
  _yBody.crossVectors(_zBody, _xBody);

  // 7. Project sun direction into body-fixed frame
  const sx = _sunJ2000.dot(_xBody);
  const sy = _sunJ2000.dot(_yBody);
  const sz = _sunJ2000.dot(_zBody);

  // 8. Extract selenographic coordinates
  //    In body frame: Z = north pole, X = prime meridian (toward mean sub-Earth point)
  const subSolarLat = Math.asin(Math.max(-1, Math.min(1, sz))) * RAD2DEG;
  const subSolarLon = Math.atan2(sy, sx) * RAD2DEG;

  // 9. Convert selenographic (lat, lon) to MoonOrbiter Three.js direction
  //    Convention (same as latLonToVec3 in FormationsOverlay):
  //    x = cos(lat) * cos(lon), y = sin(lat), z = cos(lat) * sin(lon)
  const latRad = subSolarLat * DEG2RAD;
  const lonRad = subSolarLon * DEG2RAD;
  const direction = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    Math.cos(latRad) * Math.sin(lonRad),
  ).normalize();

  return { direction, subSolarLat, subSolarLon };
}
