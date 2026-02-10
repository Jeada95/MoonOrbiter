/**
 * Dedicated Three.js scene for the 3D Print Workshop mode.
 *
 * Reuses the main WebGLRenderer. Provides its own camera, controls,
 * and lighting with manual azimuth/elevation control.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BrickResult } from './BrickMeshBuilder';

const DEG2RAD = Math.PI / 180;

export class WorkshopScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private renderer: THREE.WebGLRenderer;
  private light: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;

  private brickMesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial;

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

    // Controls
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
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
    this.material.dispose();
    this.controls.dispose();
  }
}
