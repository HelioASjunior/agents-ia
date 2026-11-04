// Verificação completa e segura, para uma pessoa ou outra IA rodar sozinha. Não gasta cota,
// não usa contas, não instala nada e não toca nos dados reais: tudo roda em uma pasta temporária.
//   npm run verify              código, testes e o servidor de verdade
//   npm run verify -- --release também baixa a versão publicada e confere as assinaturas
import { execSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = 'HelioASjunior/agents-ia';
const PORT = 4397;
const withRelease = process.argv.includes('--release');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-verify-'));
const results = [];

function report(ok, name, detail = '') {
  results.push(ok);
  process.stdout.write(`${ok ? 'PASSOU' : 'FALHOU'}  ${name}${detail ? `: ${detail}` : ''}\n`);
}

async function check(name, run) {
  try {
    report(true, name, (await run()) ?? '');
  } catch (error) {
    report(false, name, String(error.message ?? error).split('\n').slice(0, 6).join(' | ').slice(0, 500));
  }
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: esperado ${expected}, veio ${actual}`);
}

const sh = (command, env = {}) => execSync(command, { cwd: root, encoding: 'utf8', stdio: 'pipe', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

/** Pedido com cabeçalhos livres: o fetch não deixa escolher o Host. */
const raw = (url, headers = {}) => new Promise((resolve, reject) => {
  const request = http.get(`http://127.0.0.1:${PORT}${url}`, { headers }, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
  });
  request.on('error', reject);
});

async function verifyServer() {
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
    cwd: root,
    env: { ...process.env, XINOIA_DATA_DIR: path.join(work, 'dados'), XINOIA_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let token;
  try {
    token = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('o servidor não abriu em 60 segundos')), 60_000);
      server.stdout.on('data', (data) => {
        const match = /token=([0-9a-f]+)/.exec(String(data));
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      server.on('exit', (code) => reject(new Error(`o servidor parou, código ${code}`)));
    });
    report(true, 'Servidor abre em uma pasta temporária');
  } catch (error) {
    report(false, 'Servidor abre em uma pasta temporária', error.message);
    server.kill();
    return;
  }

  const auth = { authorization: `Bearer ${token}` };
  const json = async (url) => {
    const response = await raw(url, auth);
    equal(response.status, 200, url);
    return JSON.parse(response.body);
  };

  await check('API recusa pedido sem o token', async () => equal((await raw('/api/profiles')).status, 401, 'status'));
  await check('API recusa outro Host, mesmo com o token', async () => {
    const { status } = await raw('/api/profiles', { ...auth, host: 'exemplo.invalid' });
    if (status < 400) throw new Error(`status ${status}`);
  });
  await check('API recusa pedido vindo de outro site', async () => {
    const { status } = await raw('/api/profiles', { ...auth, origin: 'https://exemplo.invalid' });
    if (status < 400) throw new Error(`status ${status}`);
  });
  await check('Instalação nova não traz conta, agente nem projeto', async () => {
    for (const url of ['/api/profiles', '/api/agents', '/api/projects']) equal((await json(url)).length, 0, url);
  });
  await check('Banco de dados na versão mais recente', async () => {
    const { schemaVersion } = await json('/api/system');
    if (!(schemaVersion >= 5)) throw new Error(`versão ${schemaVersion}`);
    return `esquema v${schemaVersion}`;
  });
  await check('Provedores conhecidos e opção de chave de API', async () => {
    const list = await json('/api/providers');
    for (const id of ['claude', 'codex', 'gemini']) {
      const provider = list.find((item) => item.id === id);
      if (!provider) throw new Error(`falta ${id}`);
      equal(provider.supportsApiKey, true, `${id} aceita chave`);
    }
  });
  await check('Interface é servida com a política de segurança', async () => {
    const page = await raw('/');
    equal(page.status, 200, 'status');
    if (!/<title>XinoIA/.test(page.body)) throw new Error('não é a página do XinoIA');
    if (!/default-src 'self'/.test(page.headers['content-security-policy'] ?? '')) throw new Error('sem política de segurança');
  });
  server.kill();
}

async function verifyRelease() {
  const headers = { 'user-agent': 'xinoia-verify', accept: 'application/vnd.github+json' };
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  if (!response.ok) {
    report(false, 'Versão publicada existe', `GitHub respondeu ${response.status}`);
    return;
  }
  const release = await response.json();
  report(true, 'Versão publicada existe', release.tag_name);
  const version = release.tag_name.replace(/^v/, '');
  const names = release.assets.map((asset) => asset.name);
  const setup = `XinoIA-Setup-v${version}.exe`;
  const portable = `XinoIA-Portable-v${version}.exe`;
  await check('Versão tem todos os arquivos', () => {
    for (const name of [setup, `${setup}.sig`, `${setup}.blockmap`, portable, `${portable}.sig`, 'latest.yml', 'SHA256SUMS.txt']) {
      if (!names.includes(name)) throw new Error(`falta ${name}`);
    }
  });
  const folder = path.join(work, 'publicada');
  fs.mkdirSync(folder);
  for (const asset of release.assets) {
    const file = await fetch(asset.browser_download_url, { headers: { 'user-agent': 'xinoia-verify' } });
    if (!file.ok) throw new Error(`${asset.name}: ${file.status}`);
    fs.writeFileSync(path.join(folder, asset.name), Buffer.from(await file.arrayBuffer()));
  }
  const hash = (name, algorithm, encoding) => crypto.createHash(algorithm).update(fs.readFileSync(path.join(folder, name))).digest(encoding);
  await check('Checksums batem e só listam o que foi publicado', () => {
    const lines = fs.readFileSync(path.join(folder, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    for (const line of lines) {
      const [expected, name] = line.trim().split(/\s+/);
      if (!names.includes(name)) throw new Error(`lista ${name}, que não foi publicado`);
      equal(hash(name, 'sha256', 'hex'), expected, name);
    }
    return `${lines.length} arquivos`;
  });
  await check('latest.yml aponta para o instalador certo', () => {
    const text = fs.readFileSync(path.join(folder, 'latest.yml'), 'utf8');
    equal(/^version: (.+)$/m.exec(text)?.[1], version, 'versão');
    equal(/^path: (.+)$/m.exec(text)?.[1], setup, 'instalador');
    equal(/^sha512: (.+)$/m.exec(text)?.[1], hash(setup, 'sha512', 'base64'), 'hash do instalador');
  });
  const { verifyFile } = await import('../apps/desktop/src/verify.ts');
  const key = fs.readFileSync(path.join(root, 'apps/desktop/build/update-public-key.pem'), 'utf8');
  await check('Assinaturas valem para a chave pública do app', async () => {
    for (const name of [setup, portable]) {
      const signature = fs.readFileSync(path.join(folder, `${name}.sig`), 'utf8');
      equal(await verifyFile(path.join(folder, name), signature, key), true, name);
    }
  });
  await check('Assinatura é recusada em outro arquivo', async () => {
    const signature = fs.readFileSync(path.join(folder, `${setup}.sig`), 'utf8');
    equal(await verifyFile(path.join(folder, 'latest.yml'), signature, key), false, 'aceitou');
  });
}

try {
  process.stdout.write(`Verificando ${root}\n\n`);
  await check('Node.js 24 ou mais novo', () => {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(`versão ${process.version}`);
    return process.version;
  });
  await check('Dependências instaladas', () => {
    if (!fs.existsSync(path.join(root, 'node_modules'))) throw new Error('rode npm ci primeiro');
  });
  await check('Tipos do TypeScript', () => { sh('npm run --silent typecheck'); });
  await check('Testes automáticos', () => {
    let output;
    try {
      output = sh('npm test --silent');
    } catch (error) {
      throw new Error(String(error.stdout ?? error).split('\n').filter((line) => /^✖/.test(line)).join(' | ') || 'falharam');
    }
    return /ℹ pass (\d+)/.exec(output)?.[1] ? `${/ℹ pass (\d+)/.exec(output)[1]} passaram` : '';
  });
  await check('Interface compila', () => { sh('npm run --silent build:web'); });
  await verifyServer();
  if (withRelease) await verifyRelease().catch((error) => report(false, 'Versão publicada', error.message));
} finally {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

const failed = results.filter((ok) => !ok).length;
process.stdout.write(`\n${failed ? `RESULTADO: ${failed} de ${results.length} falharam` : `RESULTADO: ${results.length} de ${results.length} passaram`}\n`);
process.exit(failed ? 1 : 0);
