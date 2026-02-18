# MoonOrbiter

Interactive 3D Moon explorer built with real NASA LRO data. Navigate the lunar surface with adaptive high-resolution terrain, real-time astronomical lighting, 9 000+ named formations, and a 3D print workshop.

## Features

- **Photo mode** -- Textured globe with LOLA elevation data (4 ppd) and normal mapping
- **Adaptive mode** -- Multi-resolution terrain tiles (up to 222 m/px) loaded on the fly
- **Astronomical sun** -- Real-time sun position via `astronomy-engine`, with Earth-view orientation and libration
- **9 080 lunar formations** -- IAU database with search, categories (maria, craters, other), Wikipedia links
- **Lat/lon graticule** -- Toggleable grid overlay
- **Fly mode** -- First-person flight over the adaptive terrain
- **3D Print Workshop** -- Extract any formation as a heightmap brick and export to STL
- **Full Moon Print** -- Decompose the entire Moon into printable shell segments
- **Starfield** -- 8 000 procedural background stars
- **Desktop app** -- Electron packaging with NSIS Windows installer

## Screenshots

*Coming soon*

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- Moon data files (see [Data](#data) below)

### Install and run

```bash
git clone https://github.com/Jeada95/MoonOrbiter.git
cd MoonOrbiter
npm install
npm run dev:web    # Browser mode (Vite dev server)
npm run dev        # Electron mode (hot reload)
```

### Build installer

```bash
npm run dist       # Produces Windows NSIS installer in release/
```

## Data

MoonOrbiter requires external lunar data files that are too large for the repository. Download them separately and point the application to the data folder on first launch (Electron) or configure the Vite plugin path (dev).

| File | Size | Source | Required |
|------|------|--------|----------|
| `moon_texture_4k.jpg` | 2 MB | LRO WAC mosaic | Yes |
| `moon_texture_2k.jpg` | 534 KB | LRO WAC mosaic (fallback) | No |
| `moon_normal_4ppd.png` | 1.6 MB | Derived from LOLA | Yes |
| `moon_normal_16ppd.png` | 15 MB | Derived from LOLA | No |
| `lola_elevation_4ppd.bin` | 4 MB | LOLA gridded data | Yes |
| `lunar_features.json` | 826 KB | IAU Gazetteer | Yes |
| `tiles/` | 81 MB | Pyramid tiles (levels 0-4) | Yes |
| `grids/513/` | 146 MB | Int16 terrain grids (889 m/px) | For Adaptive mode |
| `grids/1025/` | 579 MB | Int16 terrain grids (444 m/px) | Optional |
| `grids/2049/` | 2.3 GB | Int16 terrain grids (222 m/px) | Optional |

Data packs will be available on the [Releases](https://github.com/Jeada95/MoonOrbiter/releases) page.

## Controls

| Input | Action |
|-------|--------|
| Left mouse drag | Orbit |
| Scroll wheel | Zoom |
| Right mouse drag | Pan |

## Tech stack

- [Three.js](https://threejs.org/) 0.172 -- 3D rendering
- [TypeScript](https://www.typescriptlang.org/) 5.7
- [Vite](https://vitejs.dev/) 6 -- Build tooling
- [Electron](https://www.electronjs.org/) 33 -- Desktop packaging
- [lil-gui](https://lil-gui.georgealways.com/) -- UI controls
- [astronomy-engine](https://github.com/cosinekitty/astronomy) -- Sun/Earth ephemeris

## Data sources

All lunar data comes from NASA's Lunar Reconnaissance Orbiter (LRO) mission:

- **Elevation**: [LOLA Gridded Data (PDS)](https://pds-geosciences.wustl.edu/missions/lro/lola.htm)
- **Imagery**: [LRO WAC Global Mosaic](https://wms.lroc.asu.edu/lroc/view_rdr/WAC_GLOBAL)
- **Formations**: [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/)

## Acknowledgements

Built with the help of AI assistants (Claude by Anthropic, Codex by OpenAI).

## License

MIT
