import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.img': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

export interface DataServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

/**
 * Start a local HTTP server that serves moon data files from the given folder.
 * Supports HTTP Range requests for partial file loading.
 * Listens on 127.0.0.1 only (no external access).
 */
export function startDataServer(dataFolder: string): Promise<DataServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);
      const urlPath = decodeURIComponent(url.pathname);

      // Resolve the file path
      const filePath = path.resolve(path.join(dataFolder, urlPath));

      // Security: prevent directory traversal (trailing sep avoids prefix collisions)
      const normalizedDataFolder = path.resolve(dataFolder) + path.sep;
      if (!filePath.startsWith(normalizedDataFolder)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // Check file exists (single statSync instead of existsSync + statSync + statSync)
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error('not a file');
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const contentType = getMimeType(filePath);

      // CORS headers (same-origin fetch from Electron renderer)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');

      // HTTP Range request support
      const rangeHeader = req.headers.range;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const parts = rangeHeader.replace('bytes=', '').split('-');
        const start = parts[0] ? parseInt(parts[0], 10) : stat.size - parseInt(parts[1], 10);
        const end = parts[0] && parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        if (isNaN(start) || isNaN(end) || start < 0 || start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, {
            'Content-Range': `bytes */${stat.size}`,
          });
          res.end();
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (err) => {
          console.error('[data-server] Stream error:', err.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        stream.pipe(res);
      } else {
        // Full file response
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
          console.error('[data-server] Stream error:', err.message);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        stream.pipe(res);
      }
    });

    server.on('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      console.log(`[data-server] Serving ${dataFolder} on http://127.0.0.1:${port}`);
      resolve({
        server,
        port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
