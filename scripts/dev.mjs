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
// no fixed port: esbuild takes the first free one from 8000–8009, since 8000 is sometimes held by another program
const { port } = await ctx.serve({ servedir: 'www' });
console.log(`\n  守燈人 dev server → http://localhost:${port}/\n`);
