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
