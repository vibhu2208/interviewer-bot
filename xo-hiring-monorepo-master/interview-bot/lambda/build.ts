import { build } from 'esbuild';
import * as fs from 'fs';
import { glob } from 'glob';

async function doBuild(): Promise<void> {
  const pkg = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }));
  const files = await glob('src/handlers/**.ts');

  await build({
    bundle: true,
    sourcemap: 'inline',
    sourcesContent: false,
    target: 'node18',
    platform: 'node',
    format: 'esm',
    external: [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ],
    outdir: 'dist/code',
    entryPoints: files,
    outExtension: {
      '.js': '.mjs',
    },
  });
}

doBuild().then(() => {
  console.log('Build successful');
});
