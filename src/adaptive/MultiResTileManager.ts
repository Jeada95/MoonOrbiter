import * as THREE from 'three';
import { LocalGridLoader, GridResolution } from './LocalGridLoader';
import { AdaptiveMesher, MartiniErrors } from './AdaptiveMesher';
import { SPHERE_RADIUS, DEFAULT_MAX_ERROR, DEFAULT_VERTICAL_EXAGGERATION } from '../utils/config';
import type { HeightmapGrid } from './types';

const DEG2RAD = Math.PI / 180;

const MAX_CONCURRENT_LOADS = 8;
const UPDATE_THROTTLE_MS = 100;

/** Nombre max de rebuilds RTIN par appel update() — évite de geler l'UI */
const REBUILD_BUDGET_PER_FRAME = 6;

/** Nombre max de tuiles chargées simultanément en fetch réseau */
const LOAD_BUDGET_PER_FRAME = 4;

// maxError adapté à la distance caméra (en mètres d'altitude)
function errorForDistance(dist: number): number {
  if (dist > 30) return 500;   // vue globale : gros triangles
  if (dist > 15) return 200;   // zoom moyen
  if (dist > 8) return 100;    // zoom modéré
  return 50;                    // gros plan
}

interface ManagedTile {
  latMin: number;
  lonMin: number;
  center: THREE.Vector3;
  activeResolution: GridResolution | null;
  targetResolution: GridResolution | null;
  /** Exagération avec laquelle le mesh courant a été construit */
  activeExaggeration: number;
  activeMaxError: number;
  mesh: THREE.Mesh | null;
  cachedGrid: HeightmapGrid | null;
  cachedGridResolution: GridResolution | null;
  /** Erreurs Martini pré-calculées (lourd, ne dépend que de la grille) */
  cachedMartini: MartiniErrors | null;
  loading: boolean;
}

/**
 * Gère les 288 tuiles adaptatives (15°×15°) avec résolution manuelle.
 *
 * Optimisation clé : les erreurs Martini (phase 1, ~80% du CPU) sont calculées
 * une seule fois par grille et mises en cache. Quand l'exagération ou le maxError
 * change, seule la phase 2 (extraction + projection 3D) est refaite — ~5× plus rapide.
 *
 * Rebuild incrémental : max REBUILD_BUDGET_PER_FRAME tuiles par frame,
 * priorisées par distance caméra (les plus proches d'abord).
 */
export class MultiResTileManager {
  private gridLoader = new LocalGridLoader(60);
  private tiles: ManagedTile[] = [];
  private parent: THREE.Object3D;
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private material: THREE.MeshStandardMaterial;

  private lastUpdateTime = 0;
  private concurrentLoads = 0;

  // Pre-allocated objects to avoid per-frame GC pressure
  private _tmpSphere = new THREE.Sphere();
  private _visibleWork: {
    tile: ManagedTile;
    dist: number;
    wantedError: number;
    needsLoad: boolean;
    needsRebuild: boolean;
  }[] = [];

  /** Résolution choisie par l'utilisateur (défaut = basse) */
  private currentResolution: GridResolution = 513;

  maxError = DEFAULT_MAX_ERROR;
  exaggeration = DEFAULT_VERTICAL_EXAGGERATION;
  wireframe = false;

  renderedTileCount = 0;
  totalTriangles = 0;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;

    this.material = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.FrontSide,
      wireframe: false,
    });

    for (let latMin = -90; latMin < 90; latMin += 15) {
      for (let lonMin = 0; lonMin < 360; lonMin += 15) {
        this.tiles.push({
          latMin,
          lonMin,
          center: this.computeTileCenter(latMin, lonMin),
          activeResolution: null,
          targetResolution: null,
          activeExaggeration: 0,
          activeMaxError: 0,
          mesh: null,
          cachedGrid: null,
          cachedGridResolution: null,
          cachedMartini: null,
          loading: false,
        });
      }
    }
  }

  private computeTileCenter(latMin: number, lonMin: number): THREE.Vector3 {
    const lat = (latMin + 7.5) * DEG2RAD;
    const lon = (lonMin + 7.5) * DEG2RAD;
    return new THREE.Vector3(
      SPHERE_RADIUS * Math.cos(lat) * Math.cos(lon),
      SPHERE_RADIUS * Math.sin(lat),
      SPHERE_RADIUS * Math.cos(lat) * Math.sin(lon),
    );
  }

  /** Mise à jour appelée chaque frame (throttlée). */
  update(camera: THREE.Camera): void {
    const now = performance.now();
    if (now - this.lastUpdateTime < UPDATE_THROTTLE_MS) return;
    this.lastUpdateTime = now;

    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const cameraPos = camera.position;
    const wantedRes = this.currentResolution;

    // --- Phase 1 : calculer distance + visibilité, cacher les tuiles hors frustum ---
    const visibleWork = this._visibleWork;
    visibleWork.length = 0;
    const tileRadius = SPHERE_RADIUS * 0.15;
    const tmpSphere = this._tmpSphere;
    tmpSphere.radius = tileRadius;

    for (const tile of this.tiles) {
      tmpSphere.center.copy(tile.center);
      const visible = this.frustum.intersectsSphere(tmpSphere);

      if (!visible) {
        if (tile.mesh) tile.mesh.visible = false;
        continue;
      }

      // Cacher les tuiles à l'arrière de la sphère (dot product caméra→tuile vs normale)
      // Évite de voir le wireframe de l'autre côté
      const dot = tile.center.dot(cameraPos);
      if (dot < 0) {
        if (tile.mesh) tile.mesh.visible = false;
        continue;
      }

      if (tile.mesh) tile.mesh.visible = true;

      const dist = cameraPos.distanceTo(tile.center);
      const wantedError = errorForDistance(dist);

      let needsLoad = false;
      let needsRebuild = false;

      if (!tile.cachedGrid || tile.cachedGridResolution !== wantedRes) {
        needsLoad = !tile.loading;
      } else if (!tile.cachedMartini || !tile.mesh) {
        needsRebuild = true;
      } else {
        const exagChanged = tile.activeExaggeration !== this.exaggeration;
        const errorRatio = tile.activeMaxError / wantedError;
        const errorChanged = errorRatio > 1.5 || errorRatio < 0.67;
        if (exagChanged || errorChanged) {
          needsRebuild = true;
        }
      }

      visibleWork.push({ tile, dist, wantedError, needsLoad, needsRebuild });
    }

    // --- Phase 2 : trier par distance (plus proche en premier) ---
    visibleWork.sort((a, b) => a.dist - b.dist);

    // --- Phase 3 : traiter les chargements (limité) ---
    let loadsBudget = LOAD_BUDGET_PER_FRAME;
    for (const work of visibleWork) {
      if (!work.needsLoad) continue;
      if (loadsBudget <= 0) break;
      if (this.concurrentLoads >= MAX_CONCURRENT_LOADS) break;

      work.tile.targetResolution = wantedRes;
      this.loadTileGrid(work.tile, wantedRes);
      loadsBudget--;
    }

    // --- Phase 4 : traiter les rebuilds (limité, les plus proches d'abord) ---
    let rebuildBudget = REBUILD_BUDGET_PER_FRAME;
    for (const work of visibleWork) {
      if (!work.needsRebuild) continue;
      if (rebuildBudget <= 0) break;

      this.buildTileMesh(work.tile, work.tile.cachedGrid!, work.wantedError);
      rebuildBudget--;
    }

    // --- Phase 5 : stats ---
    let rendered = 0;
    let triangles = 0;
    for (const tile of this.tiles) {
      if (tile.mesh && tile.mesh.visible) {
        rendered++;
        const idx = tile.mesh.geometry.getIndex();
        if (idx) triangles += idx.count / 3;
      }
    }
    this.renderedTileCount = rendered;
    this.totalTriangles = triangles;
  }

  private async loadTileGrid(tile: ManagedTile, resolution: GridResolution): Promise<void> {
    tile.loading = true;
    this.concurrentLoads++;

    try {
      const grid = await this.gridLoader.loadGrid(tile.latMin, tile.lonMin, resolution);
      tile.cachedGrid = grid;
      tile.cachedGridResolution = resolution;
      tile.cachedMartini = null; // Sera calculé dans le rebuild budget
    } catch (err) {
      console.warn(`Erreur chargement tuile ${tile.latMin},${tile.lonMin} @${resolution}:`, err);
    } finally {
      tile.loading = false;
      this.concurrentLoads--;
    }
  }

  private buildTileMesh(tile: ManagedTile, grid: HeightmapGrid, maxError?: number): void {
    const tileMaxError = maxError ?? this.maxError;

    // Calculer les erreurs Martini si pas encore cachées (phase lourde, une seule fois par grille)
    if (!tile.cachedMartini) {
      tile.cachedMartini = AdaptiveMesher.computeErrors(grid);
    }

    const meshData = AdaptiveMesher.extractMesh(grid, tile.cachedMartini, tileMaxError, this.exaggeration);

    if (tile.mesh) {
      this.parent.remove(tile.mesh);
      tile.mesh.geometry.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeBoundingSphere();

    tile.mesh = new THREE.Mesh(geometry, this.material);
    tile.mesh.castShadow = true;
    tile.mesh.receiveShadow = true;
    this.parent.add(tile.mesh);

    tile.activeResolution = tile.cachedGridResolution;
    tile.activeExaggeration = this.exaggeration;
    tile.activeMaxError = tileMaxError;
  }

  private removeTileMesh(tile: ManagedTile): void {
    if (tile.mesh) {
      this.parent.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.mesh = null;
    }
    tile.activeResolution = null;
  }

  // ─── Contrôles globaux ──────────────────────────────────────────────────

  setResolution(resolution: GridResolution): void {
    if (resolution === this.currentResolution) return;
    this.currentResolution = resolution;
    // Pas besoin d'invalider le cache : update() détecte cachedGridResolution !== wantedRes
    // et recharge uniquement les tuiles visibles à la demande.
  }

  setMaxError(maxError: number): void {
    this.maxError = maxError;
  }

  setExaggeration(exaggeration: number): void {
    this.exaggeration = exaggeration;
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    this.material.wireframe = enabled;
    this.material.color.set(enabled ? 0x00ff88 : 0xcccccc);
    this.material.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    for (const tile of this.tiles) {
      if (tile.mesh) {
        tile.mesh.visible = visible;
      }
    }
  }

  setTexture(texture: THREE.Texture): void {
    texture.colorSpace = THREE.SRGBColorSpace;
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    for (const tile of this.tiles) {
      this.removeTileMesh(tile);
      tile.cachedGrid = null;
      tile.cachedMartini = null;
    }
    this.material.dispose();
    this.gridLoader.clearCache();
  }
}
