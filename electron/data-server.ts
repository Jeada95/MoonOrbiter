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
 * Supports HTTP Range requests for partial file loading (LDEM_128.IMG).
 * Listens on 127.0.0.1 only (no external access).
 */
export function startDataServer(dataFolder: string): Promise<DataServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost`);
      const urlPath = decodeURIComponent(url.pathname);

      // Resolve the file path
      const filePath = path.resolve(path.join(dataFolder, urlPath));

      // Security: prevent directory traversal
      const normalizedDataFolder = path.resolve(dataFolder);
      if (!filePath.startsWith(normalizedDataFolder)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }

      // Check file exists
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const stat = fs.statSync(filePath);
      const contentType = getMimeType(filePath);

      // CORS headers (same-origin fetch from Electron renderer)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');

      // HTTP Range request support
      const rangeHeader = req.headers.range;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const parts = rangeHeader.replace('bytes=', '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        if (start >= stat.size || end >= stat.size || start > end) {
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
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        // Full file response
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
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
