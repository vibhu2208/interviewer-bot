import { build } from 'esbuild';
import * as fs from 'fs';

const packageFile = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }));

build({
  bundle: true,
  sourcemap: 'inline',
  sourcesContent: false,
  target: 'node18',
  platform: 'node',
  format: 'esm',
  external: [...Object.keys(packageFile.dependencies || {}), ...Object.keys(packageFile.peerDependencies || {})],
  outdir: 'dist/code',
  entryPoints: ['src/index.ts'],
  outExtension: {
    '.js': '.mjs',
  },
}).then(() => {
  console.log('Build successful');
});
