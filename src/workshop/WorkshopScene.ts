/**
 * Dedicated Three.js scene for the 3D Print Workshop mode.
 *
 * Reuses the main WebGLRenderer. Provides its own camera, controls,
 * and lighting with manual azimuth/elevation control.
 */

import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import type { BrickResult } from './BrickMeshBuilder';

const DEG2RAD = Math.PI / 180;

/** Alternating piece colors for Full Moon Print assembly view */
const PIECE_COLORS = [0xb0b0b0, 0xd4a06a, 0x8ab4c8];

export class WorkshopScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: TrackballControls;

  private renderer: THREE.WebGLRenderer;
  private light: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  private brickMesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial;

  // ─── Full Moon Print: multi-piece group ─────────────────────
  private piecesGroup: THREE.Group | null = null;
  private pieceMeshes: THREE.Mesh[] = [];
  private pieceMaterials: THREE.MeshStandardMaterial[] = [];

  /** When true, the directional light follows the camera each frame */
  private headlightMode = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      10000,
    );

    // Controls — TrackballControls for free rotation on all axes
    this.controls = new TrackballControls(this.camera, renderer.domElement);
    this.controls.staticMoving = false; // enable damping
    this.controls.dynamicDampingFactor = 0.1;
    this.controls.enabled = false; // enabled only when workshop is active

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(this.ambientLight);

    this.light = new THREE.DirectionalLight(0xffffff, 2.5);
    this.setLightDirection(45, 30); // default: 45° azimuth, 30° elevation
    this.scene.add(this.light);

    // Material for the brick (neutral gray, good for inspecting relief)
    this.material = new THREE.MeshStandardMaterial({
      color: 0xb0b0b0,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });

    // Handle resize
    window.addEventListener('resize', this.onResize);
  }

  // ─── Brick management ─────────────────────────────────────────

  /** Set the brick geometry and frame the camera around it */
  setBrick(brick: BrickResult): void {
    // Remove previous brick if any
    if (this.brickMesh) {
      this.scene.remove(this.brickMesh);
      this.brickMesh.geometry.dispose();
    }

    this.brickMesh = new THREE.Mesh(brick.geometry, this.material);
    this.scene.add(this.brickMesh);

    // Frame camera to see the whole brick
    const maxDim = Math.max(brick.widthKm, brick.heightKm);
    const camDist = maxDim * 1.5;
    this.camera.position.set(0, -camDist * 0.3, camDist * 0.8);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // Update light distance to match brick scale
    this.setLightDirection(45, 30);
  }

  /** Get the current brick mesh for STL export */
  getBrickMesh(): THREE.Mesh | null {
    return this.brickMesh;
  }

  /** Update the geometry reference (after exaggeration rebuild) */
  updateGeometry(geometry: THREE.BufferGeometry): void {
    if (this.brickMesh) {
      this.brickMesh.geometry = geometry;
    }
  }

  /** Remove the brick mesh from the scene (geometry NOT disposed — caller owns it) */
  clearBrick(): void {
    if (this.brickMesh) {
      this.scene.remove(this.brickMesh);
      this.brickMesh = null;
    }
  }

  // ─── Full Moon Print: multi-piece management ─────────────────

  /** Set a group of piece meshes for Full Moon Print assembly view */
  setPieces(geometries: THREE.BufferGeometry[], explode = 0.05): void {
    this.clearPieces();

    this.piecesGroup = new THREE.Group();
    this.pieceMeshes = [];
    this.pieceMaterials = [];

    for (let i = 0; i < geometries.length; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: PIECE_COLORS[i % PIECE_COLORS.length],
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometries[i], mat);

      // Explode outward slightly (radial offset from center)
      if (explode > 0) {
        const center = new THREE.Vector3();
        geometries[i].computeBoundingBox();
        geometries[i].boundingBox!.getCenter(center);
        const dir = center.clone().normalize();
        mesh.position.copy(dir.multiplyScalar(center.length() * explode));
      }

      this.pieceMeshes.push(mesh);
      this.pieceMaterials.push(mat);
      this.piecesGroup.add(mesh);
    }

    this.scene.add(this.piecesGroup);

    // Frame camera to see all pieces
    const box = new THREE.Box3().setFromObject(this.piecesGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const camDist = maxDim * 1.5;
    this.camera.position.set(
      center.x,
      center.y - camDist * 0.3,
      center.z + camDist * 0.8,
    );
    this.controls.target.copy(center);
    this.controls.update();
  }

  /** Show a single piece in print orientation (inner surface down, centered) */
  showSinglePiece(geometry: THREE.BufferGeometry, pieceCenterDir: THREE.Vector3): void {
    this.clearPieces();

    const mat = new THREE.MeshStandardMaterial({
      color: 0xb0b0b0,
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, mat);

    // Rotate so the piece center direction points up (+Y for print bed)
    // Create rotation from pieceCenterDir to +Y
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(pieceCenterDir.clone().normalize(), up);
    mesh.quaternion.copy(q);

    // Center the mesh at origin after rotation
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    mesh.position.sub(center);
    // Place bottom on Y=0
    mesh.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(mesh);
    mesh.position.y -= box2.min.y;

    this.piecesGroup = new THREE.Group();
    this.piecesGroup.add(mesh);
    this.pieceMeshes = [mesh];
    this.pieceMaterials = [mat];
    this.scene.add(this.piecesGroup);

    // Frame camera
    mesh.updateMatrixWorld(true);
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const size = finalBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const camDist = maxDim * 1.5;
    const meshCenter = finalBox.getCenter(new THREE.Vector3());
    this.camera.position.set(meshCenter.x, meshCenter.y + camDist * 0.5, meshCenter.z + camDist * 0.8);
    this.controls.target.copy(meshCenter);
    this.controls.update();
  }

  /** Get a specific piece mesh by index (for STL export) */
  getPieceMesh(index: number): THREE.Mesh | null {
    return this.pieceMeshes[index] ?? null;
  }

  /** Get all piece meshes */
  getAllPieceMeshes(): THREE.Mesh[] {
    return this.pieceMeshes;
  }

  /**
   * Clear all pieces from the scene.
   * @param disposeGeometry If true, also dispose geometry buffers.
   *   Default false because geometries are owned by the caller (main.ts fmpSegments).
   */
  clearPieces(disposeGeometry = false): void {
    if (this.piecesGroup) {
      this.scene.remove(this.piecesGroup);
      if (disposeGeometry) {
        for (const mesh of this.pieceMeshes) {
          mesh.geometry.dispose();
        }
      }
      for (const mat of this.pieceMaterials) {
        mat.dispose();
      }
      this.piecesGroup = null;
      this.pieceMeshes = [];
      this.pieceMaterials = [];
    }
  }

  // ─── Lighting ─────────────────────────────────────────────────

  /** Set light direction from azimuth (0-360°) and elevation (0-90°) angles */
  setLightDirection(azimuthDeg: number, elevationDeg: number): void {
    const az = azimuthDeg * DEG2RAD;
    const el = elevationDeg * DEG2RAD;
    const dist = 500; // far enough for directional light
    this.light.position.set(
      dist * Math.cos(el) * Math.cos(az),
      dist * Math.cos(el) * Math.sin(az),
      dist * Math.sin(el),
    );
  }

  /** Enable/disable headlight mode (light follows camera, for FMP) */
  setHeadlightMode(enabled: boolean): void {
    this.headlightMode = enabled;
  }

  // ─── Wireframe ────────────────────────────────────────────────

  setWireframe(enabled: boolean): void {
    this.material.wireframe = enabled;
  }

  // ─── Activation ───────────────────────────────────────────────

  activate(): void {
    this.controls.enabled = true;
  }

  deactivate(): void {
    this.controls.enabled = false;
  }

  // ─── Render ───────────────────────────────────────────────────

  render(): void {
    this.controls.update();
    // In headlight mode, position light at camera so the visible face is always lit
    if (this.headlightMode) {
      this.light.position.copy(this.camera.position);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    if (this.brickMesh) {
      this.scene.remove(this.brickMesh);
      this.brickMesh.geometry.dispose();
    }
    this.clearPieces();
    this.material.dispose();
    this.controls.dispose();
  }
}
