import * as esbuild from 'esbuild';

const ctx = await esbuild.context({
  entryPoints: ['src/main.js'],
  bundle: true,
  outfile: 'www/app.js',
  format: 'iife',
  sourcemap: true,
  target: 'es2020',
  logLevel: 'info',
  define: { __DEV__: 'true' },
});

await ctx.watch();
const { port } = await ctx.serve({ servedir: 'www', port: 8000 });
console.log(`\n  守燈人 dev server → http://localhost:${port}/\n`);
