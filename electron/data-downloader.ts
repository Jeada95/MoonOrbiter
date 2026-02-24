/**
 * Data pack downloader — handles download, extraction, verification and cleanup.
 *
 * Uses:
 * - Node.js https/http for downloading with redirect following
 * - System tar.exe for .tar.xz extraction (native on Windows 10+)
 * - Progress reporting via BrowserWindow.webContents.send()
 */

import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { BrowserWindow } from 'electron';
import { DATA_PACKS, type DataPackStatus } from './data-packs';
import { detectAvailableGrids } from './config-store';

export interface DownloadProgress {
  packId: string;
  /** Current phase: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error' */
  phase: string;
  /** Bytes downloaded so far */
  bytesDownloaded: number;
  /** Total bytes (from Content-Length or estimated) */
  bytesTotal: number;
  /** Percentage 0-100 */
  percent: number;
  /** Optional error message */
  error?: string;
}

// Track active downloads to prevent duplicates
const activeDownloads = new Set<string>();

/**
 * Check which data packs are installed.
 */
export function getDataPackStatuses(dataFolder: string): DataPackStatus[] {
  return DATA_PACKS.map(pack => ({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    archiveSizeLabel: pack.archiveSizeLabel,
    installed: pack.verifyPaths.every(p => fs.existsSync(path.join(dataFolder, p))),
    gridsProvided: pack.gridsProvided,
  }));
}

/**
 * Download a data pack, extract it, verify, and clean up.
 * Returns the updated list of available grids after completion.
 */
export async function downloadDataPack(
  packId: string,
  dataFolder: string,
  mainWindow: BrowserWindow | null,
): Promise<number[]> {
  const pack = DATA_PACKS.find(p => p.id === packId);
  if (!pack) throw new Error(`Unknown data pack: ${packId}`);

  if (activeDownloads.has(packId)) {
    throw new Error(`Download already in progress: ${packId}`);
  }

  activeDownloads.add(packId);

  const sendProgress = (progress: DownloadProgress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', progress);
    }
  };

  try {
    const archivePath = path.join(dataFolder, pack.archiveFilename);
    const partialPath = archivePath + '.partial';

    // ─── Phase 1: Download ──────────────────────────────────
    sendProgress({
      packId, phase: 'downloading',
      bytesDownloaded: 0, bytesTotal: pack.archiveSizeBytes, percent: 0,
    });

    await downloadFile(pack.url, partialPath, pack.archiveSizeBytes, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      sendProgress({
        packId, phase: 'downloading',
        bytesDownloaded: downloaded, bytesTotal: total, percent: pct,
      });
    });

    // Rename .partial → final
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    fs.renameSync(partialPath, archivePath);

    // ─── Phase 2: Extract ───────────────────────────────────
    sendProgress({
      packId, phase: 'extracting',
      bytesDownloaded: pack.archiveSizeBytes, bytesTotal: pack.archiveSizeBytes, percent: 100,
    });

    await extractTarXz(archivePath, dataFolder);

    // ─── Phase 3: Verify ────────────────────────────────────
    sendProgress({
      packId, phase: 'verifying',
      bytesDownloaded: pack.archiveSizeBytes, bytesTotal: pack.archiveSizeBytes, percent: 100,
    });

    for (const verifyPath of pack.verifyPaths) {
      const fullPath = path.join(dataFolder, verifyPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Verification failed: ${verifyPath} not found after extraction`);
      }
    }

    // ─── Phase 4: Cleanup ───────────────────────────────────
    try {
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    } catch (e) {
      console.warn('[downloader] Could not delete archive:', e);
    }
    // Clean up any leftover .partial
    try {
      if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
    } catch { /* ignore */ }

    // ─── Phase 5: Refresh grids ─────────────────────────────
    const grids = detectAvailableGrids(dataFolder);

    sendProgress({
      packId, phase: 'done',
      bytesDownloaded: pack.archiveSizeBytes, bytesTotal: pack.archiveSizeBytes, percent: 100,
    });

    return grids;
  } catch (err) {
    sendProgress({
      packId, phase: 'error',
      bytesDownloaded: 0, bytesTotal: pack.archiveSizeBytes, percent: 0,
      error: (err as Error).message,
    });
    throw err;
  } finally {
    activeDownloads.delete(packId);
  }
}

/**
 * Download a file from a URL with redirect following and resume support.
 */
function downloadFile(
  url: string,
  destPath: string,
  estimatedSize: number,
  onProgress: (downloaded: number, total: number) => void,
  maxRedirects = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check for partial download (resume support)
    let startByte = 0;
    if (fs.existsSync(destPath)) {
      startByte = fs.statSync(destPath).size;
    }

    const headers: Record<string, string> = {
      'User-Agent': 'MoonOrbiter-DataManager/1.0',
    };
    if (startByte > 0) {
      headers['Range'] = `bytes=${startByte}-`;
    }

    const doRequest = (requestUrl: string, redirectCount: number) => {
      const parsedUrl = new URL(requestUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.get(requestUrl, { headers }, (res) => {
        const status = res.statusCode ?? 0;

        // Handle redirects (GitHub releases always redirect)
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error('Too many redirects'));
            return;
          }
          // Follow redirect — don't send Range header to new URL if server didn't understand it
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (status === 416) {
          // Range not satisfiable — file already complete
          resolve();
          return;
        }

        if (status !== 200 && status !== 206) {
          reject(new Error(`HTTP ${status} downloading ${parsedUrl.pathname}`));
          return;
        }

        // Determine total size
        let totalSize = estimatedSize;
        if (status === 200) {
          // Full download (not a resume)
          startByte = 0;
          const cl = res.headers['content-length'];
          if (cl) totalSize = parseInt(cl, 10);
        } else if (status === 206) {
          // Partial content — Content-Range: bytes 100-999/1000
          const cr = res.headers['content-range'];
          if (cr) {
            const match = cr.match(/\/(\d+)$/);
            if (match) totalSize = parseInt(match[1], 10);
          }
        }

        // Open file for writing (append if resuming, overwrite if fresh)
        const flags = startByte > 0 ? 'a' : 'w';
        const fileStream = fs.createWriteStream(destPath, { flags });

        let downloaded = startByte;

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          onProgress(downloaded, totalSize);
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve());
        });

        fileStream.on('error', (err) => {
          fileStream.close(() => reject(err));
        });

        res.on('error', (err) => {
          fileStream.close(() => reject(err));
        });
      });

      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy(new Error('Connection timed out'));
      });
    };

    doRequest(url, 0);
  });
}

/**
 * Extract a .tar.xz archive using system tar.exe (Windows 10+ native).
 */
function extractTarXz(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use system tar which supports xz on Windows 10+
    execFile('tar', ['-xf', archivePath, '-C', destDir], { timeout: 600_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`tar extraction failed: ${err.message}\n${stderr}`));
      } else {
        console.log('[downloader] Extraction complete:', archivePath);
        resolve();
      }
    });
  });
}
