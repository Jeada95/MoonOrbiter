import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    open: true,
    fs: {
      allow: ['..', 'D:/MoonOrbiterData'],
    },
  },
  resolve: {
    alias: {
      '@data': path.resolve('D:/MoonOrbiterData'),
    },
  },
  optimizeDeps: {
    // On laisse Vite optimiser copc/laz-perf (conversion CJS→ESM).
    // Le WASM est géré par le plugin serve-wasm ci-dessous.
  },
  build: {
    target: 'es2020',
  },
  plugins: [
    {
      // Plugin pour servir les fichiers .wasm de laz-perf avec le bon MIME type.
      // Emscripten dans laz-perf fait un fetch("laz-perf.wasm") relatif au script.
      // Vite bundle le script dans .vite/deps/, donc le WASM n'est pas trouvé.
      // Ce middleware intercepte toute requête contenant "laz-perf.wasm" et sert
      // le vrai fichier depuis node_modules.
      name: 'serve-wasm',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Matcher avec ou sans query string (?v=xxx)
          const urlPath = (req.url || '').split('?')[0];
          if (urlPath.includes('laz-perf.wasm')) {
            const wasmPath = path.resolve('node_modules/laz-perf/lib/web/laz-perf.wasm');
            import('fs').then(fs => {
              if (fs.existsSync(wasmPath)) {
                res.setHeader('Content-Type', 'application/wasm');
                res.setHeader('Access-Control-Allow-Origin', '*');
                fs.createReadStream(wasmPath).pipe(res);
              } else {
                console.error('[serve-wasm] laz-perf.wasm introuvable à', wasmPath);
                next();
              }
            });
          } else {
            next();
          }
        });
      },
    },
    {
      // Plugin pour servir D:\MoonOrbiterData sous /moon-data/ en dev
      name: 'serve-moon-data',
      configureServer(server) {
        server.middlewares.use('/moon-data', (req, res, next) => {
          const filePath = path.join('D:/MoonOrbiterData', req.url || '');
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff',
            '.bin': 'application/octet-stream', '.json': 'application/json',
            '.img': 'application/octet-stream', '.IMG': 'application/octet-stream',
          };
          import('fs').then(fs => {
            if (fs.existsSync(filePath)) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              const ext = path.extname(filePath).toLowerCase();
              if (mimeTypes[ext]) res.setHeader('Content-Type', mimeTypes[ext]);
              fs.createReadStream(filePath).pipe(res);
            } else {
              next();
            }
          });
        });
      },
    },
  ],
});
