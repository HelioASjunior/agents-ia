// Assinar um instalador muda o arquivo, então o hash, o tamanho e o blockmap gerados antes
// deixam de valer, e o atualizador recusaria o download. Este script os refaz a partir do
// arquivo já assinado. Uso: node scripts/refresh-update-info.mjs <pasta-da-versão>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

const dir = path.resolve(process.argv[2] ?? 'release');
const manifests = fs.readdirSync(dir).filter((name) => ['latest.yml', 'beta.yml'].includes(name));
if (!manifests.length) {
  process.stderr.write(`Nenhum latest.yml ou beta.yml em ${dir}.\n`);
  process.exit(1);
}

for (const manifest of manifests) {
  const file = path.join(dir, manifest);
  const text = fs.readFileSync(file, 'utf8');
  const name = /^path: (.+)$/m.exec(text)?.[1]?.trim();
  if (!name) throw new Error(`${manifest} não indica o instalador`);
  const installer = path.join(dir, name);
  const info = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const updated = text
    .replace(/^(\s*sha512: ).+$/gm, `$1${info.sha512}`)
    .replace(/^(\s*size: ).+$/gm, `$1${info.size}`);
  fs.writeFileSync(file, updated);
  process.stdout.write(`${manifest}: ${name} com ${info.size} bytes\n`);
}
