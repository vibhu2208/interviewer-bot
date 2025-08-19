import { build } from 'esbuild';
import * as fs from 'fs';

(async () => {
  const packageFile = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }));
  await build({
    bundle: true,
    minify: false,
    sourcemap: 'linked',
    sourcesContent: false,
    target: 'node20',
    platform: 'node',
    format: 'esm',
    outdir: './dist/code',
    entryPoints: ['src/index.ts'],
    external: [...Object.keys(packageFile.dependencies || {}), ...Object.keys(packageFile.peerDependencies || {})],
    outExtension: {
      '.js': '.mjs',
    },
  });
})();
