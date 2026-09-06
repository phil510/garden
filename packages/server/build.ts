import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['bin/garden.ts'],
  bundle: true,
  format: 'esm',
  // The shebang must stay the first line: package.json's `bin` points a
  // symlink straight at this file, so the kernel needs an interpreter.
  //
  // CJS deps bundled into ESM output (fastify's avvio, notably) contain
  // dynamic require('node:events') calls that esbuild's ESM shim rejects at
  // runtime. createRequire gives the bundle a real CJS loader for those
  // lookups — Node builtins only, since the bundle ships no node_modules.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  platform: 'node',
  target: 'node22',
  minify: false,
  // No source map. Node resolves a script's map when it compiles it, so nothing
  // the bundle itself can execute turns mapping on in time — a map here only
  // pays off under `node --enable-source-maps dist/garden.js`, run by hand.
  // Debug from src via `tsx bin/garden.ts` instead.
  sourcemap: false,
  outdir: 'dist',
  // node-pty ships a native addon; esbuild cannot bundle a .node file, so the
  // import stays a real module reference and Node resolves it from node_modules
  // at runtime, the same as any other unbundled dependency.
  external: ['node-pty'],
});

chmodSync('dist/garden.js', 0o755);

writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }));

// node-pty finds its native binary through paths relative to its own package
// directory, one of which is prebuilds/<platform>-<arch>. Ship that directory
// next to dist/ so the built server still finds pty.node when run somewhere
// that doesn't carry the full node_modules tree.
const platformDir = `${process.platform}-${process.arch}`;
const nodePtyRoot = dirname(fileURLToPath(import.meta.resolve('node-pty/package.json')));
cpSync(join(nodePtyRoot, 'prebuilds', platformDir), join('dist', 'prebuilds', platformDir), {
  recursive: true,
});

console.log(`Build succeeded: dist/garden.js dist/package.json dist/prebuilds/${platformDir}`);
