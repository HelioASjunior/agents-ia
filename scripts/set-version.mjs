// Uso: npm run set-version -- 1.2.3
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  process.stderr.write('Informe uma versão, como 1.2.3 ou 1.2.3-beta.1\n');
  process.exit(1);
}
for (const file of ['package.json', 'apps/desktop/package.json', 'apps/server/package.json', 'apps/web/package.json', 'packages/shared/package.json']) {
  const full = fileURLToPath(new URL(`../${file}`, import.meta.url));
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  json.version = version;
  fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`);
}
process.stdout.write(`Versão ${version}. Atualize o CHANGELOG.md e crie a tag v${version}.\n`);
