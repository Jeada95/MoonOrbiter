import * as THREE from 'three';
import { SPHERE_RADIUS } from './config';

/** Convertit latitude/longitude (degrés) en position 3D sur la sphère */
export function latLonToCartesian(
  latDeg: number,
  lonDeg: number,
  radius: number = SPHERE_RADIUS
): THREE.Vector3 {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);

  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    radius * Math.cos(lat) * Math.sin(lon)
  );
}

/** Convertit une position 3D en latitude/longitude (degrés) */
export function cartesianToLatLon(
  position: THREE.Vector3
): { lat: number; lon: number } {
  const r = position.length();
  const lat = THREE.MathUtils.radToDeg(Math.asin(position.y / r));
  const lon = THREE.MathUtils.radToDeg(Math.atan2(position.z, position.x));
  return { lat, lon };
}
