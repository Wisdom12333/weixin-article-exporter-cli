import { chmod } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const banner = [
  '#!/usr/bin/env node',
  'import { createRequire as __createRequire } from "module";',
  'const require = __createRequire(import.meta.url);',
].join('\n');

await esbuild.build({
  entryPoints: ['src/cli.mjs'],
  outfile: 'index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  banner: { js: banner },
});

await chmod('index.mjs', 0o755);
