/**
 * Data pack catalog — defines downloadable data packs and their metadata.
 */

export interface DataPack {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Download size label (human-readable) */
  archiveSizeLabel: string;
  /** Archive size in bytes (approximate, for progress calculation) */
  archiveSizeBytes: number;
  /** GitHub release download URL */
  url: string;
  /** Archive filename */
  archiveFilename: string;
  /** Paths (relative to data folder) to verify after extraction */
  verifyPaths: string[];
  /** Grid resolutions provided by this pack */
  gridsProvided: number[];
}

export const DATA_PACKS: DataPack[] = [
  {
    id: 'essential',
    name: 'Essential Data',
    description: 'Textures, elevation, formations, tiles, and low-res grids (513)',
    archiveSizeLabel: '186 MB',
    archiveSizeBytes: 195_018_592,
    url: 'https://github.com/Jeada95/MoonOrbiter/releases/download/v0.1.0/MoonOrbiter-Data-Essential.tar.xz',
    archiveFilename: 'MoonOrbiter-Data-Essential.tar.xz',
    verifyPaths: ['moon_texture_4k.jpg', 'grids/513'],
    gridsProvided: [513],
  },
  {
    id: 'hd',
    name: 'HD Grid Pack',
    description: 'Medium-res grids (1025) for higher detail in Workshop and Adaptive mode',
    archiveSizeLabel: '428 MB',
    archiveSizeBytes: 448_197_312,
    url: 'https://github.com/Jeada95/MoonOrbiter/releases/download/v0.1.0/MoonOrbiter-Data-HD.tar.xz',
    archiveFilename: 'MoonOrbiter-Data-HD.tar.xz',
    verifyPaths: ['grids/1025'],
    gridsProvided: [1025],
  },
];

export interface DataPackStatus {
  id: string;
  name: string;
  description: string;
  archiveSizeLabel: string;
  installed: boolean;
  gridsProvided: number[];
}
