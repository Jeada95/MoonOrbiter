/**
 * Computes the camera direction to show the Moon as seen from Earth,
 * accounting for libration (optical + physical).
 *
 * Uses astronomy-engine's Libration() which returns selenographic
 * coordinates of the sub-Earth point (elat, elon).
 */

import * as THREE from 'three';
import { Libration } from 'astronomy-engine';

const DEG2RAD = Math.PI / 180;

export interface EarthViewInfo {
  /** Normalized direction from Moon center toward Earth, in Three.js Y-up coords */
  direction: THREE.Vector3;
  /** Sub-Earth selenographic latitude in degrees (-90..+90) */
  subEarthLat: number;
  /** Sub-Earth selenographic longitude in degrees (-180..+180) */
  subEarthLon: number;
}

/**
 * Compute camera position direction to show the Moon as seen from Earth.
 *
 * The sub-Earth point is the point on the Moon's surface closest to Earth.
 * The camera should be placed along this direction (outward from Moon center)
 * to replicate the Earth-based view with correct libration.
 */
export function computeEarthViewPosition(date: Date): EarthViewInfo {
  const lib = Libration(date);

  // lib.elat = sub-Earth selenographic latitude (degrees, ±7°)
  // lib.elon = sub-Earth selenographic longitude (degrees, ±8°)
  const subEarthLat = lib.elat;
  const subEarthLon = lib.elon;

  // Convert selenographic (lat, lon) to MoonOrbiter Three.js direction
  // Convention (same as SunPosition.ts / FormationsOverlay):
  //   x = cos(lat) * cos(lon), y = sin(lat), z = cos(lat) * sin(lon)
  const latRad = subEarthLat * DEG2RAD;
  const lonRad = subEarthLon * DEG2RAD;
  const direction = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lonRad),
    Math.sin(latRad),
    Math.cos(latRad) * Math.sin(lonRad),
  ).normalize();

  return { direction, subEarthLat, subEarthLon };
}
