import { build } from 'esbuild';
import eslint from 'esbuild-plugin-eslint';
import { glob } from 'glob';

const files = await glob('src/resolvers/**/*.ts');

await build({
  bundle: true,
  sourcemap: 'inline',
  sourcesContent: false,
  target: 'esnext',
  platform: 'node',
  format: 'esm',
  external: ['@aws-appsync/utils'],
  outdir: 'dist/',
  entryPoints: files,
  plugins: [eslint({ useEslintrc: true })],
});
