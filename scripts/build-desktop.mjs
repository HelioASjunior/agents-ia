// Compila o backend, a interface e a casca desktop em apps/desktop/dist.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const desktop = path.join(root, 'apps', 'desktop');
const dist = path.join(desktop, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

execSync('npm run build:web', { cwd: root, stdio: 'inherit' });
fs.cpSync(path.join(root, 'apps', 'web', 'dist'), path.join(dist, 'web'), { recursive: true });

await build({
  entryPoints: [path.join(desktop, 'src', 'main.ts'), path.join(desktop, 'src', 'preload.ts')],
  outdir: dist,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', 'electron-updater'],
  logLevel: 'warning',
  // Só o teste de atualização define isto, para usar um servidor local.
  define: process.env.XINOIA_TEST_RELEASE_BASE
    ? { __XINOIA_RELEASE_BASE__: JSON.stringify(process.env.XINOIA_TEST_RELEASE_BASE) }
    : {},
});

// O backend é ESM (usa await no topo) e leva junto dependências CommonJS.
await build({
  entryPoints: [path.join(root, 'apps', 'server', 'src', 'index.ts')],
  outfile: path.join(dist, 'server', 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['node-pty'],
  logLevel: 'warning',
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __dirnameOf } from 'node:path';",
      'const require = __createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __dirnameOf(__filename);',
    ].join('\n'),
  },
});

fs.copyFileSync(path.join(desktop, 'src', 'splash.html'), path.join(dist, 'splash.html'));
fs.copyFileSync(path.join(root, 'docs', 'assets', 'logo.svg'), path.join(dist, 'logo.svg'));
fs.copyFileSync(path.join(desktop, 'build', 'icon.png'), path.join(dist, 'icon.png'));
fs.copyFileSync(path.join(desktop, 'build', 'update-public-key.pem'), path.join(dist, 'update-public-key.pem'));

process.stdout.write(`Pronto: ${dist}\n`);
