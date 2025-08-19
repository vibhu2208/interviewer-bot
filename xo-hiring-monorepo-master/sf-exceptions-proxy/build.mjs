import { build } from 'esbuild';
import pkg from './package.json' assert { type: 'json' };

await build({
  bundle: true,
  sourcemap: 'inline',
  sourcesContent: false,
  target: 'node18',
  platform: 'node',
  format: 'esm',
  external: [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ],
  outdir: 'dist/code',
  entryPoints: ['src/index.ts'],
  outExtension: {
    '.js': '.mjs',
  },
});
