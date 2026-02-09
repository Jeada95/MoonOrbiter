import * as THREE from 'three';
import {
  SPHERE_RADIUS,
  SPHERE_SEGMENTS_DISPLACEMENT,
  MOON_RADIUS,
  DEFAULT_VERTICAL_EXAGGERATION,
} from '../utils/config';

/**
 * Globe lunaire dont les vertices sont déformés par les vraies altitudes LOLA.
 *
 * Charge directement un fichier LDEM NASA (.IMG, Int16 LE, row-major,
 * lat nord→sud, lon 0→360°). Altitude_m = DN × scale.
 * Chaque vertex est repositionné à la distance exacte du centre.
 */
export class Globe {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private geometry: THREE.SphereGeometry;
  private verticalExaggeration = DEFAULT_VERTICAL_EXAGGERATION;

  /** Données LDEM brutes (Int16, DN values) */
  private elevationData: Int16Array | null = null;
  private elevWidth = 0;
  private elevHeight = 0;
  /** Facteur de conversion DN → mètres */
  private elevScale = 0.5;

  /** Positions originales (rayon unitaire × SPHERE_RADIUS, sans élévation) */
  private basePositions: Float32Array | null = null;

  constructor(segments: number = SPHERE_SEGMENTS_DISPLACEMENT) {
    this.geometry = new THREE.SphereGeometry(
      SPHERE_RADIUS,
      segments,
      segments
    );

    // Three.js SphereGeometry génère des UV où U progresse en sens inverse
    // de la longitude (phi va de 0 à 2PI depuis l'axe -X).
    // Les textures NASA (LROC) ont lon croissant = U croissant.
    // On mirore les U pour aligner la texture avec les coordonnées LDEM.
    const uvAttr = this.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const uvs = uvAttr.array as Float32Array;
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i] = 1 - uvs[i];
    }
    uvAttr.needsUpdate = true;

    this.material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.95,
      metalness: 0.0,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
  }

  /** Applique une texture diffuse sur le globe */
  setTexture(texture: THREE.Texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    this.material.map = texture;
    this.material.needsUpdate = true;
  }

  /**
   * Charge un fichier LDEM NASA (.IMG, Int16 Little-Endian) et déforme les vertices.
   * @param url URL du fichier LDEM (ex: /moon-data/raw/LDEM_64.IMG)
   * @param width Largeur du grid (nb colonnes, ex: 23040 pour 64ppd)
   * @param height Hauteur du grid (nb lignes, ex: 11520 pour 64ppd)
   * @param scale Facteur DN → mètres (0.5 pour LDEM standard)
   */
  async loadLDEM(url: string, width: number, height: number, scale = 0.5): Promise<void> {
    console.log(`[Globe] Chargement LDEM ${width}x${height} depuis ${url}...`);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Échec chargement ${url}: ${response.status}`);

    const buffer = await response.arrayBuffer();
    this.elevationData = new Int16Array(buffer);
    this.elevWidth = width;
    this.elevHeight = height;
    this.elevScale = scale;

    const expected = width * height;
    if (this.elevationData.length !== expected) {
      console.warn(`[Globe] Taille inattendue: ${this.elevationData.length} (attendu ${expected})`);
    }

    console.log(`[Globe] LDEM chargé: ${this.elevationData.length} valeurs (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);

    // Sauvegarder les positions de base
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.basePositions = new Float32Array(posAttr.array);

    // Appliquer la déformation
    this.applyElevation();
  }

  /**
   * Applique les altitudes LOLA aux vertices de la géométrie.
   * Pour chaque vertex, on calcule sa lat/lon, on échantillonne l'altitude,
   * puis on repositionne le vertex au bon rayon.
   */
  private applyElevation() {
    if (!this.elevationData || !this.basePositions) return;

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const count = posAttr.count;

    const moonRadiusM = MOON_RADIUS * 1000; // 1737.4 km → 1737400 m

    for (let i = 0; i < count; i++) {
      // Position de base (sur la sphère non déformée)
      const bx = this.basePositions[i * 3];
      const by = this.basePositions[i * 3 + 1];
      const bz = this.basePositions[i * 3 + 2];

      // Calculer la direction normalisée (= position sur sphère unitaire)
      const r = Math.sqrt(bx * bx + by * by + bz * bz);
      const nx = bx / r;
      const ny = by / r;
      const nz = bz / r;

      // Convertir en lat/lon
      // Three.js SphereGeometry : Y = up, convention:
      //   lat = asin(ny)  → -PI/2 (sud) à +PI/2 (nord)
      //   lon = atan2(nz, nx) → -PI à +PI
      const lat = Math.asin(ny); // radians, -PI/2..+PI/2
      const lon = Math.atan2(nz, nx); // radians, -PI..+PI

      // Convertir lat/lon en coordonnées pixel dans le grid LOLA
      // Three.js : atan2(nz,nx) = 0 → axe +X → centre texture UV = lon 0° (sub-Earth)
      // LDEM NASA : col 0 = lon 0°E, col W/2 = lon 180°E. Range 0–360°.
      // Pas de décalage nécessaire : les deux conventions sont directement compatibles.
      const latDeg = lat * (180 / Math.PI); // -90..+90
      const lonDeg = ((lon * (180 / Math.PI)) + 360) % 360; // 0..360, sans décalage

      // Row : 0 (nord, lat=+90) → H-1 (sud, lat=-90)
      const rowF = ((90 - latDeg) / 180) * (this.elevHeight - 1);
      // Col : 0 (lon=0°) → W-1 (lon=~360°)
      const colF = (lonDeg / 360) * (this.elevWidth - 1);

      // Interpolation bilinéaire
      const elevM = this.sampleElevation(rowF, colF);

      // Nouveau rayon = SPHERE_RADIUS × (1 + exagération × altitude / rayon_réel)
      const newRadius = SPHERE_RADIUS * (1 + this.verticalExaggeration * elevM / moonRadiusM);

      positions[i * 3] = nx * newRadius;
      positions[i * 3 + 1] = ny * newRadius;
      positions[i * 3 + 2] = nz * newRadius;
    }

    posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** Échantillonne l'élévation par interpolation bilinéaire */
  private sampleElevation(rowF: number, colF: number): number {
    const data = this.elevationData!;
    const w = this.elevWidth;
    const h = this.elevHeight;

    // Clamper aux bords
    const r = Math.max(0, Math.min(rowF, h - 1));
    const c = Math.max(0, Math.min(colF, w - 1));

    const r0 = Math.floor(r);
    const r1 = Math.min(r0 + 1, h - 1);
    const c0 = Math.floor(c);
    const c1 = Math.min(c0 + 1, w - 1);

    const dr = r - r0;
    const dc = c - c0;

    // 4 voisins (DN Int16 → mètres via scale)
    const s = this.elevScale;
    const v00 = data[r0 * w + c0] * s;
    const v01 = data[r0 * w + c1] * s;
    const v10 = data[r1 * w + c0] * s;
    const v11 = data[r1 * w + c1] * s;

    // Interpolation bilinéaire
    return (
      v00 * (1 - dr) * (1 - dc) +
      v01 * (1 - dr) * dc +
      v10 * dr * (1 - dc) +
      v11 * dr * dc
    );
  }

  /** Règle l'exagération verticale et recalcule les positions */
  setVerticalExaggeration(factor: number) {
    this.verticalExaggeration = factor;
    this.applyElevation();
  }

  getVerticalExaggeration(): number {
    return this.verticalExaggeration;
  }

  /**
   * Applique une normal map pour le détail haute fréquence de l'éclairage.
   * Complémentaire à la déformation géométrique (qui donne le relief basse fréquence).
   */
  setNormalMap(texture: THREE.Texture, scale = 1.0) {
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    this.material.normalMap = texture;
    this.material.normalMapType = THREE.TangentSpaceNormalMap;
    this.material.normalScale = new THREE.Vector2(scale, scale);
    this.material.needsUpdate = true;
  }

  setNormalScale(scale: number) {
    this.material.normalScale.set(scale, scale);
  }

  getNormalScale(): number {
    return this.material.normalScale.x;
  }

  setWireframe(enabled: boolean) {
    this.material.wireframe = enabled;
    this.material.needsUpdate = true;
  }

  getWireframe(): boolean {
    return this.material.wireframe;
  }

  setVisible(visible: boolean) {
    this.mesh.visible = visible;
  }

  addToScene(scene: THREE.Scene) {
    scene.add(this.mesh);
  }
}
