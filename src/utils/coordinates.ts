import * as THREE from 'three';
import { SPHERE_RADIUS } from './config';

const DEG2RAD = Math.PI / 180;

/** Convertit latitude/longitude (degrés) en position 3D sur la sphère */
export function latLonToCartesian(
  latDeg: number,
  lonDeg: number,
  radius: number = SPHERE_RADIUS
): THREE.Vector3 {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;

  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)
  );
}

/** Même conversion mais écrit dans un Vector3 existant (zero-alloc) */
export function latLonToVec3(latDeg: number, lonDeg: number, r: number, out: THREE.Vector3): void {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  out.set(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon),
  );
}

/** Convertit une position 3D en latitude/longitude (degrés) */
export function cartesianToLatLon(
  position: THREE.Vector3
): { lat: number; lon: number } {
  const r = position.length();
  const lat = THREE.MathUtils.radToDeg(Math.asin(position.y / r));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(-position.z, position.x));
  return { lat, lon };
}
