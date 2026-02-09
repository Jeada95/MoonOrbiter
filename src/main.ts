import * as THREE from 'three';
import { MoonScene } from './core/Scene';
import { Lighting } from './core/Lighting';
import { Globe } from './moon/Globe';
import { HUD } from './ui/HUD';
import { GuiControls } from './ui/GuiControls';
import { MultiResTileManager } from './adaptive/MultiResTileManager';

// --- Initialisation ---
const moonScene = new MoonScene();
const lighting = new Lighting(moonScene.scene);

// Globe avec vrai mesh déformé par LOLA
const globe = new Globe();
globe.addToScene(moonScene.scene);


// --- Charger les données ---
const textureLoader = new THREE.TextureLoader();

// Variable pour stocker la texture LROC (partagée entre Globe et TileManager)
let lrocTexture: THREE.Texture | null = null;

// 1) Texture couleur LROC
textureLoader.load(
  '/moon-data/moon_texture_4k.jpg',
  (texture) => {
    lrocTexture = texture;
    globe.setTexture(texture);
    tileManager.setTexture(texture);
    console.log('Texture LROC 4K chargée');
  },
  undefined,
  (err) => {
    console.warn('Échec texture 4K, tentative 2K...', err);
    textureLoader.load(
      '/moon-data/moon_texture_2k.jpg',
      (texture) => {
        lrocTexture = texture;
        globe.setTexture(texture);
        tileManager.setTexture(texture);
        console.log('Texture LROC 2K chargée');
      },
      undefined,
      (err2) => console.error('Impossible de charger la texture', err2)
    );
  }
);

// 2) Normal map
textureLoader.load(
  '/moon-data/moon_normal_16ppd.png',
  (normalTexture) => globe.setNormalMap(normalTexture, 1.5),
  undefined,
  () => {
    textureLoader.load(
      '/moon-data/moon_normal_4ppd.png',
      (normalTexture) => globe.setNormalMap(normalTexture, 1.5),
      undefined,
      () => {}
    );
  }
);

// 3) Données d'élévation — directement depuis LDEM NASA (Int16 LE, DN × 0.5 = mètres)
globe.loadLDEM('/moon-data/raw/LDEM_64.IMG', 23040, 11520, 0.5)
  .then(() => console.log('Élévation LDEM 64ppd appliquée'))
  .catch((err) => console.error('Erreur chargement LDEM:', err));

// --- Maillage adaptatif multi-tuiles ---
const tileManager = new MultiResTileManager(moonScene.scene);
let adaptiveMode = false;

// Résolution → description pour le HUD
const RES_HUD_INFO: Record<number, string> = {
  513:  'LDEM 64ppd — ~889 m/px',
  1025: 'LDEM 64ppd — ~444 m/px',
  2049: 'LDEM 128ppd — ~222 m/px',
};
let currentAdaptiveRes = 513;

// UI
const hud = new HUD();
const gui = new GuiControls(lighting, globe, {
  onToggleAdaptive: (enabled: boolean) => {
    adaptiveMode = enabled;
    globe.setVisible(!enabled);
    tileManager.setVisible(enabled);
    hud.setResolutionInfo(enabled ? RES_HUD_INFO[currentAdaptiveRes] : 'LDEM 64ppd — Globe');
    console.log(`Mode adaptatif: ${enabled ? 'ON' : 'OFF'}`);
  },
  onResolutionChange: (resolution) => {
    currentAdaptiveRes = resolution;
    tileManager.setResolution(resolution);
    if (adaptiveMode) {
      hud.setResolutionInfo(RES_HUD_INFO[resolution] || `LDEM — ${resolution}px`);
    }
    console.log(`Résolution: ${resolution}`);
  },
  onMaxErrorChange: (maxError: number) => {
    tileManager.setMaxError(maxError);
  },
  onExaggerationChange: (v: number) => {
    tileManager.setExaggeration(v);
  },
  onWireframeChange: (enabled: boolean) => {
    tileManager.setWireframe(enabled);
  },
  getStats: () => ({
    tiles: tileManager.renderedTileCount,
    triangles: tileManager.totalTriangles,
  }),
});

// --- Boucle de rendu ---
function animate(time: number) {
  requestAnimationFrame(animate);

  // Adapter la vitesse de rotation/pan au niveau de zoom
  // Plus on est proche, plus on ralentit (facteur linéaire normalisé)
  const dist = moonScene.camera.position.length();
  const distRatio = (dist - moonScene.controls.minDistance)
                  / (moonScene.controls.maxDistance - moonScene.controls.minDistance);
  const speedFactor = 0.05 + 0.95 * Math.max(0, Math.min(1, distRatio));
  moonScene.controls.rotateSpeed = 0.4 * speedFactor;
  moonScene.controls.panSpeed = 0.4 * speedFactor;

  // Passer la scène entière (globe + tuiles) au HUD pour le raycast
  hud.update(moonScene.camera, moonScene.scene, time);

  // Mise à jour du gestionnaire de tuiles adaptatives si actif
  if (adaptiveMode) {
    tileManager.update(moonScene.camera);
  }

  moonScene.render();
}

requestAnimationFrame(animate);

console.log('MoonOrbiter démarré');
console.log('Contrôles: Souris gauche = orbite, Molette = zoom, Souris droite = pan');
