import * as esbuild from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  outfile: 'dist/app.js',
  format: 'iife',
  target: 'es2020',
  legalComments: 'eof',
  define: { __DEV__: 'false' },
  logLevel: 'info',
});

// strip the dev-only live-reload snippet from the page
const html = readFileSync('www/index.html', 'utf8').replace(/<!--DEV-->[\s\S]*?<!--\/DEV-->/, '');
writeFileSync('dist/index.html', html);
copyFileSync('www/style.css', 'dist/style.css');
console.log('built → dist/');
