// Assina os instaladores de release/ com a chave privada de XINOIA_SIGNING_KEY e calcula
// os checksums. A chave existe só como segredo do GitHub, nunca neste repositório.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.resolve(process.argv[2] ?? 'release');
const key = process.env.XINOIA_SIGNING_KEY;
if (!key) {
  process.stderr.write('Defina XINOIA_SIGNING_KEY com a chave privada de assinatura.\n');
  process.exit(1);
}

const digest = (file, algorithm) => new Promise((resolve, reject) => {
  const hash = crypto.createHash(algorithm);
  fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest()));
});

const installers = fs.readdirSync(releaseDir).filter((name) => name.endsWith('.exe') && !name.includes('__uninstaller'));
if (!installers.length) {
  process.stderr.write(`Nenhum instalador em ${releaseDir}.\n`);
  process.exit(1);
}

for (const name of installers) {
  const file = path.join(releaseDir, name);
  const signature = crypto.sign(null, await digest(file, 'sha512'), key.replaceAll('\\n', '\n')).toString('base64');
  fs.writeFileSync(`${file}.sig`, signature);
  process.stdout.write(`Assinado: ${name}\n`);
}

// Checksums servem para conferir que o download chegou inteiro. Quem garante a origem é a
// assinatura acima.
const lines = [];
for (const name of fs.readdirSync(releaseDir).sort()) {
  const file = path.join(releaseDir, name);
  if (!fs.statSync(file).isFile() || name === 'SHA256SUMS.txt' || !/\.(exe|sig|yml|blockmap)$/.test(name)) continue;
  lines.push(`${(await digest(file, 'sha256')).toString('hex')}  ${name}`);
}
fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
process.stdout.write('Checksums em SHA256SUMS.txt\n');
