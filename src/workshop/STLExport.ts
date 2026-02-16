/**
 * STL binary export utility.
 * Uses the built-in Three.js STLExporter — no extra dependency.
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';

/**
 * Export a mesh as a binary STL file and trigger a browser download.
 *
 * @param mesh The mesh to export
 * @param filename Download filename (e.g. "MoonOrbiter_Copernicus_5x.stl")
 */
export function exportMeshAsSTL(mesh: THREE.Mesh, filename: string): void {
  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary: true });

  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Generate a clean filename for the STL export.
 */
export function makeSTLFilename(featureName: string, exaggeration: number): string {
  const clean = featureName.replace(/[^a-zA-Z0-9]/g, '_');
  return `MoonOrbiter_${clean}_${exaggeration}x.stl`;
}

/**
 * Export a mesh as STL with a scale transform applied (for mm-scale export).
 * The mesh is cloned, scaled, and optionally rotated for print orientation.
 */
export function exportScaledMeshAsSTL(
  geometry: THREE.BufferGeometry,
  scaleFactor: number,
  rotation: THREE.Quaternion | null,
  filename: string,
): void {
  const mesh = new THREE.Mesh(geometry);

  // Apply rotation first if provided
  if (rotation) {
    mesh.quaternion.copy(rotation);
  }

  // Apply scale
  mesh.scale.setScalar(scaleFactor);
  mesh.updateMatrixWorld(true);

  const exporter = new STLExporter();
  const result = exporter.parse(mesh, { binary: true });

  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

/**
 * Generate a filename for a Full Moon Print piece.
 */
export function makePieceSTLFilename(
  band: number, sector: number, exaggeration: number, diameterMM: number,
): string {
  return `MoonOrbiter_Globe_B${band}S${sector}_${exaggeration}x_${diameterMM}mm.stl`;
}
