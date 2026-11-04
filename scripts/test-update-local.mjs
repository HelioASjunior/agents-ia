// Prova a cadeia de atualização sem publicar nada: gera três versões apontando para um
// servidor local e usa o electron-updater, o instalador e a assinatura de verdade.
//   1. Instala a versão A, atualiza para a B e confere os dados.
//   2. Instala a B, tenta a C com assinatura de outra chave, e confere a recusa.
// Uso: node scripts/test-update-local.mjs <arquivo-da-chave-privada>
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const keyFile = process.argv[2];
const privateKey = fs.readFileSync(keyFile, 'utf8');
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}`;
const release = path.join(root, 'release');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-update-local-'));
const served = path.join(work, 'servidor');
const setups = path.join(work, 'instaladores');
fs.mkdirSync(served);
fs.mkdirSync(setups);

const original = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version;
const log = (text) => process.stdout.write(`${text}\n`);
const run = (command, cwd = root, env = {}) => execFileSync(command, { cwd, shell: true, stdio: 'pipe', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

function digest(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest();
}

function build(version) {
  log(`\n=== Gerando ${version}`);
  run(`node scripts/set-version.mjs ${version}`);
  fs.rmSync(release, { recursive: true, force: true });
  run('npm run --silent build:desktop', root, { XINOIA_TEST_RELEASE_BASE: `${BASE}/release` });
  run(`npx electron-builder --config electron-builder.yml --publish never --win nsis -c.publish.provider=generic -c.publish.url=${BASE}/`, path.join(root, 'apps/desktop'));
  const name = `XinoIA-Setup-v${version}.exe`;
  fs.copyFileSync(path.join(release, name), path.join(setups, name));
  return name;
}

/** Coloca a versão no ar. A assinatura vem da chave indicada. */
function publishLocally(version, name, signingKey) {
  for (const file of fs.readdirSync(served)) fs.rmSync(path.join(served, file), { recursive: true, force: true });
  for (const file of [name, `${name}.blockmap`, 'beta.yml']) fs.copyFileSync(path.join(release, file), path.join(served, file));
  fs.mkdirSync(path.join(served, 'release', `v${version}`), { recursive: true });
  const signature = crypto.sign(null, digest(path.join(release, name)), signingKey).toString('base64');
  fs.writeFileSync(path.join(served, 'release', `v${version}`, `${name}.sig`), signature);
}

const server = http.createServer((request, response) => {
  const file = path.join(served, decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(served) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  const { size } = fs.statSync(file);
  const range = /bytes=(\d+)-(\d+)?/.exec(request.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    response.writeHead(206, { 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(response);
});

let failed = false;
try {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  const a = build('0.1.0-beta.1');
  const b = build('0.1.0-beta.2');
  publishLocally('0.1.0-beta.2', b, privateKey);

  // O teste roda em outro processo para o servidor continuar respondendo aqui.
  const runTest = (args) => new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn(process.execPath, ['scripts/test-update.mjs', ...args], { cwd: root, stdio: 'inherit' });
      child.on('exit', resolve);
    });
  });

  log('\n=== Atualização válida');
  const first = await runTest([path.join(setups, a), '0.1.0-beta.2']);
  if (first !== 0) throw new Error('o teste de atualização falhou');

  const c = build('0.1.0-beta.3');
  const attacker = crypto.generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  publishLocally('0.1.0-beta.3', c, attacker.privateKey);

  log('\n=== Pacote com assinatura falsa');
  const second = await runTest([path.join(setups, b), '0.1.0-beta.3', '--forged']);
  if (second !== 0) throw new Error('o teste de recusa falhou');
  log('\n✔ Atualização comprovada: a válida foi instalada, e a adulterada, recusada.');
} catch (error) {
  failed = true;
  process.stderr.write(`\n✖ ${error.message}\n`);
} finally {
  server.close();
  server.closeAllConnections();
  spawnSync(process.execPath, ['scripts/set-version.mjs', original], { cwd: root });
  fs.rmSync(release, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(failed ? 1 : 0);
