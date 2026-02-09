import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPHERE_RADIUS, BG_COLOR } from '../utils/config';

export class MoonScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  constructor(canvas?: HTMLCanvasElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    if (!canvas) {
      document.body.appendChild(this.renderer.domElement);
    }

    // Scène
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(BG_COLOR);

    // Caméra
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, SPHERE_RADIUS * 3.5);

    // Contrôles orbitaux
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = SPHERE_RADIUS * 1.05;
    this.controls.maxDistance = SPHERE_RADIUS * 10;
    this.controls.rotateSpeed = 0.4;
    this.controls.zoomSpeed = 0.8;

    // Redimensionnement
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
