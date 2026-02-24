import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: './',
  server: {
    open: false,
    fs: {
      allow: ['..', 'D:/MoonOrbiterData'],
    },
  },
  resolve: {
    alias: {
      '@data': path.resolve('D:/MoonOrbiterData'),
    },
  },
  build: {
    target: 'esnext',
  },
  plugins: [
    {
      // Plugin pour servir D:\MoonOrbiterData sous /moon-data/ en dev
      name: 'serve-moon-data',
      configureServer(server) {
        server.middlewares.use('/moon-data', (req, res, next) => {
          const dataRoot = path.resolve('D:/MoonOrbiterData');
          const filePath = path.resolve(path.join(dataRoot, req.url || ''));
          // Security: prevent directory traversal
          if (!filePath.startsWith(dataRoot + path.sep)) { next(); return; }
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff',
            '.bin': 'application/octet-stream', '.json': 'application/json',
            '.img': 'application/octet-stream', '.IMG': 'application/octet-stream',
          };
          import('fs').then(fs => {
            if (!fs.existsSync(filePath)) { next(); return; }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Support HTTP Range requests for partial file loading
            const rangeHeader = req.headers.range;
            if (rangeHeader && rangeHeader.startsWith('bytes=')) {
              const stat = fs.statSync(filePath);
              const parts = rangeHeader.replace('bytes=', '').split('-');
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
              const chunkSize = end - start + 1;

              res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
              });
              fs.createReadStream(filePath, { start, end }).pipe(res);
            } else {
              if (contentType) res.setHeader('Content-Type', contentType);
              fs.createReadStream(filePath).pipe(res);
            }
          });
        });
      },
    },
  ],
});
