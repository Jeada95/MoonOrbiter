// Write a package.json marker to force CommonJS in dist-electron/
import { writeFileSync, mkdirSync } from 'fs';
mkdirSync('dist-electron', { recursive: true });
writeFileSync('dist-electron/package.json', '{"type":"commonjs"}\n');
