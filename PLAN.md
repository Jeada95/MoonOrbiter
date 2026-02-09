# MoonOrbiter - Plan d'Architecture

## Vision
Explorateur 3D interactif de la Lune utilisant les données réelles de la sonde LRO (NASA).
Globe lunaire navigable avec zoom adaptatif, topographie haute résolution et éclairage dynamique.

---

## Stack Technique

| Composant | Technologie | Justification |
|-----------|------------|---------------|
| Rendu 3D | **Three.js** | Mature, performant via WebGL, excellent pour les globes |
| Langage | **TypeScript** | Typage, maintenabilité |
| Bundler | **Vite** | Rapide, HMR, support TypeScript natif |
| UI | **HTML/CSS + lil-gui** | Interface légère pour les contrôles |
| Données | **GDAL (scripts Python)** | Pré-traitement des données LRO en tuiles |

---

## Architecture des Données

### Sources LRO à télécharger

1. **Topographie (élévation)** - LOLA GDR
   - Basse résolution : 16 ppd (~7 km/pixel) → globe entier, ~10 Mo
   - Moyenne résolution : 64 ppd (~1.7 km/pixel) → ~200 Mo
   - Haute résolution : 256 ppd (~474 m/pixel) → ~8 Go
   - Source : PDS Geosciences Node (pds-geosciences.wustl.edu)

2. **Texture visuelle** - WAC Global Mosaic
   - 100 m/pixel, GeoTIFF, ~5.5 Go
   - Source : USGS Astrogeology

### Stockage (sur D:\)

```
D:\MoonOrbiterData\
├── raw/                    # Données brutes téléchargées
│   ├── lola_16ppd.img
│   ├── lola_64ppd.img
│   ├── lola_256ppd.img
│   └── wac_mosaic_100m.tif
├── tiles/                  # Tuiles pré-calculées
│   ├── elevation/
│   │   ├── level0/         # 1x2 tuiles (globe grossier)
│   │   ├── level1/         # 4x8 tuiles
│   │   ├── level2/         # 16x32 tuiles
│   │   ├── level3/         # 64x128 tuiles
│   │   └── level4/         # 256x512 tuiles (max détail)
│   └── texture/
│       ├── level0/
│       ├── level1/
│       ├── level2/
│       ├── level3/
│       └── level4/
└── config.json             # Métadonnées des tuiles
```

Chaque tuile = image PNG 256x256 pixels (élévation encodée en 16-bit via 2 canaux RGB).

### Système de tuiles pyramidales (Quadtree)

```
Level 0 : 2 tuiles   (1x2)    → vue très éloignée
Level 1 : 8 tuiles   (2x4)    → continent visible
Level 2 : 32 tuiles  (4x8)    → grands cratères
Level 3 : 128 tuiles (8x16)   → structures moyennes
Level 4 : 512 tuiles (16x32)  → détail fin (~500m), Mur Droit visible
```

---

## Architecture de l'Application

### Structure du projet

```
C:\Users\Jeada\Documents\Dev\MoonOrbiter\
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts              # Point d'entrée, init Three.js
│   ├── core/
│   │   ├── Scene.ts         # Setup scène Three.js, caméra, renderer
│   │   ├── Controls.ts      # Contrôles orbitaux (rotation, zoom, pan)
│   │   └── Lighting.ts      # Soleil dynamique + lumière ambiante
│   ├── moon/
│   │   ├── Globe.ts         # Sphère de base + gestion LOD
│   │   ├── TileManager.ts   # Chargement/déchargement des tuiles
│   │   ├── TileQuadtree.ts  # Arbre quadtree pour le LOD
│   │   ├── TerrainTile.ts   # Mesh individuel d'une tuile avec displacement
│   │   └── TileCache.ts     # Cache mémoire des tuiles chargées
│   ├── shaders/
│   │   ├── terrain.vert     # Vertex shader (displacement mapping)
│   │   └── terrain.frag     # Fragment shader (texture + éclairage)
│   ├── ui/
│   │   ├── HUD.ts           # Affichage coordonnées, altitude, FPS
│   │   ├── Controls.ts      # Panel de contrôle (position soleil, etc.)
│   │   └── SearchBar.ts     # Recherche de cratères par nom (bonus)
│   └── utils/
│       ├── coordinates.ts   # Conversions lat/lon ↔ cartésien
│       ├── config.ts        # Configuration (chemins, constantes)
│       └── tileIndex.ts     # Index des tuiles disponibles
├── scripts/
│   ├── download_data.py     # Téléchargement des données LRO
│   └── generate_tiles.py    # Découpage en tuiles pyramidales
└── public/
    └── (assets statiques)
```

### Étapes d'implémentation

#### Phase 1 — Fondations (globe basique)
1. **Setup projet** : Vite + TypeScript + Three.js
2. **Scène de base** : Sphère UV, caméra orbitale, contrôles souris
3. **Éclairage basique** : Lumière directionnelle (soleil) + ambiante
4. **Texture placeholder** : Appliquer une image basse résolution de la Lune
5. → **Résultat** : Globe lunaire rotatif avec texture, navigable à la souris

#### Phase 2 — Données réelles & topographie
6. **Script de téléchargement** : download_data.py (LOLA + WAC depuis PDS)
7. **Script de tuilage** : generate_tiles.py (découpage pyramidal avec GDAL)
8. **Chargement des tuiles** : TileManager lit les tuiles depuis le disque
9. **Displacement mapping** : Shader vertex qui déforme la sphère selon l'élévation
10. → **Résultat** : Globe avec vraie topographie, texture réelle

#### Phase 3 — LOD adaptatif
11. **Quadtree** : Structure d'arbre pour gérer les niveaux de détail
12. **Frustum culling** : Ne charger que les tuiles visibles par la caméra
13. **Distance-based LOD** : Résolution proportionnelle au zoom
14. **Cache & recyclage** : Gestion mémoire (déchargement des tuiles éloignées)
15. → **Résultat** : Zoom fluide du globe entier jusqu'aux cratères détaillés

#### Phase 4 — Polish & fonctionnalités
16. **Soleil dynamique** : Slider pour déplacer le soleil, ombres temps réel
17. **HUD** : Coordonnées lat/lon sous le curseur, altitude, échelle
18. **Skybox** : Fond étoilé
19. **Exagération verticale** : Slider pour amplifier le relief
20. **Recherche** : Base de données des cratères nommés, navigation rapide

---

## Détails techniques clés

### Displacement Mapping (topographie)
- Les tuiles d'élévation sont chargées comme textures
- Le vertex shader déplace chaque vertex de la sphère radialement
- Élévation encodée sur 16 bits (2 canaux PNG : R = high byte, G = low byte)
- Rayon moyen de la Lune : 1737.4 km
- Plage d'élévation : environ -9 km à +11 km

### Éclairage dynamique (soleil)
- Lumière directionnelle positionnée à grande distance
- Normal mapping dérivé de la heightmap pour le détail fin
- Ambient occlusion approximé par le shader

### Performance
- Budget : max ~200 tuiles visibles simultanément
- Taille de tuile : 256×256 vertices (ajustable)
- Target : 60 FPS sur GPU intégré
- Web Workers pour le décodage des tuiles en arrière-plan

### Chemins de données
- Projet : `C:\Users\Jeada\Documents\Dev\MoonOrbiter\`
- Données : `D:\MoonOrbiterData\`
- Le chemin des données sera configurable dans `src/utils/config.ts`

---

## Prérequis

- **Node.js** : ✅ v24.13.0
- **Python 3** + GDAL : Pour le pré-traitement (à installer)
- **Espace disque D:** : ✅ ~525 Go libres (besoin : ~15 Go max)
- **Navigateur** : Chrome/Edge récent (WebGL2)

---

## Ordre de développement proposé

On commence par la Phase 1 pour avoir rapidement un résultat visuel,
puis on itère phase par phase. Chaque phase produit un résultat fonctionnel.
