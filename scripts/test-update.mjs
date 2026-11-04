// Teste de atualização real, contra o GitHub Releases:
//   node scripts/test-update.mjs <instalador-antigo.exe> <versão-nova> [--forged]
// Instala em uma pasta temporária, atualiza pelo próprio app e confere os dados. Com
// --forged, a versão nova foi publicada com assinatura falsa e precisa ser recusada.
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const [setup, newVersion, mode] = process.argv.slice(2);
const forged = mode === '--forged';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-update-'));
const dataDir = path.join(sandbox, 'dados', 'XinoIA');
const installDir = path.join(sandbox, 'Programas', 'XinoIA');
const exe = path.join(installDir, 'XinoIA.exe');
const uninstaller = path.join(installDir, 'Uninstall XinoIA.exe');
fs.mkdirSync(dataDir, { recursive: true });
let port = 9500;

class Finished extends Error {}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (text) => process.stdout.write(`\n▶ ${text}\n`);

function running() {
  return /XinoIA/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq XinoIA*', '/NH'], { encoding: 'utf8' }));
}

async function launch() {
  port += 1;
  const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`], { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 120 && !browser; i += 1) {
    await wait(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  assert.ok(browser, 'o app abriu');
  let page;
  for (let i = 0; i < 120 && !page; i += 1) {
    page = browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith('http://127.0.0.1'));
    if (!page) await wait(500);
  }
  assert.ok(page, 'a janela abriu');
  await page.waitForSelector('nav[aria-label="Navegação principal"]', { timeout: 60_000 });
  return { child, browser, page };
}

async function close(app) {
  const session = await app.browser.newBrowserCDPSession();
  void session.send('Browser.close').catch(() => undefined);
  await wait(500);
  for (let i = 0; i < 60 && running(); i += 1) await wait(500);
}

const api = (page, method, url, body) => page.evaluate(async ({ method, url, body }) => {
  const token = sessionStorage.getItem('xinoia.token');
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}, { method, url, body });

const updateState = (page) => page.evaluate(() => window.xinoia.updates.getState());

async function untilStatus(page, wanted, seconds) {
  for (let i = 0; i < seconds * 2; i += 1) {
    const state = await updateState(page);
    if (wanted.includes(state.status)) return state;
    await wait(500);
  }
  throw new Error(`Esperava ${wanted.join('/')}, e o estado é ${JSON.stringify(await updateState(page))}`);
}

try {
  step(`Instalar a versão antiga: ${path.basename(setup)}`);
  execFileSync(setup, ['/S', `/D=${installDir}`], { timeout: 300_000 });
  for (let i = 0; i < 60 && !fs.existsSync(exe); i += 1) await wait(1000);
  assert.ok(fs.existsSync(exe));

  step('Criar dados na versão antiga');
  let app = await launch();
  const before = await updateState(app.page);
  process.stdout.write(`  versão instalada: ${before.currentVersion}, canal ${before.channel}\n`);
  const project = await api(app.page, 'POST', '/api/projects', { path: path.join(sandbox, 'projeto'), create: true, name: 'Antes da atualização' });
  assert.equal(project.status, 201);
  const schemaBefore = (await api(app.page, 'GET', '/api/system')).body.schemaVersion;

  step('Detectar a versão nova');
  await app.page.evaluate(() => window.xinoia.updates.check());
  let state = await untilStatus(app.page, ['available', 'error'], 60);
  assert.equal(state.status, 'available', state.error ?? '');
  assert.equal(state.available.version, newVersion);
  process.stdout.write(`  disponível: ${state.available.version}. Novidades: ${(state.available.notes ?? '').slice(0, 80).replace(/\n/g, ' ')}…\n`);

  step('Baixar e conferir a assinatura');
  await app.page.evaluate(() => window.xinoia.updates.download());
  state = await untilStatus(app.page, ['ready', 'error'], 300);
  if (forged) {
    assert.equal(state.status, 'error', 'um pacote com assinatura falsa não pode ficar pronto');
    assert.match(state.error, /assinatura do pacote é inválida/);
    assert.equal(state.currentVersion, before.currentVersion);
    const untouched = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim();
    assert.equal(untouched, before.currentVersion, 'o programa instalado não mudou');
    process.stdout.write(`  recusado: ${state.error}\n`);
    await close(app);
    process.stdout.write('\n✔ Pacote adulterado foi recusado.\n');
    process.exitCode = 0;
    throw new Finished();
  }
  assert.equal(state.status, 'ready', state.error ?? '');
  process.stdout.write('  assinatura válida, pronta para instalar\n');

  step('Instalar: o app fecha, atualiza e reabre sozinho');
  void app.page.evaluate(() => window.xinoia.updates.install(false)).catch(() => undefined);
  const expected = `"${newVersion}"`;
  let updated = false;
  for (let i = 0; i < 240 && !updated; i += 1) {
    await wait(1000);
    try {
      const raw = fs.readFileSync(path.join(installDir, 'resources', 'app-update.yml'), 'utf8');
      const version = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim();
      updated = version === newVersion && raw.length > 0 && running();
    } catch {
      updated = false;
    }
  }
  assert.ok(updated, `o programa foi atualizado para ${expected} e reabriu`);
  process.stdout.write('  atualizado e reaberto\n');

  // A reabertura automática usa a pasta normal de dados: fecha e abre na pasta do teste.
  await wait(4000);
  execFileSync('taskkill', ['/IM', 'XinoIA.exe', '/T'], { stdio: 'ignore' });
  for (let i = 0; i < 40 && running(); i += 1) await wait(500);
  if (running()) execFileSync('taskkill', ['/IM', 'XinoIA.exe', '/T', '/F'], { stdio: 'ignore' });
  await wait(1000);

  step('Conferir versão e dados depois da atualização');
  app = await launch();
  state = await updateState(app.page);
  assert.equal(state.currentVersion, newVersion);
  const projects = await api(app.page, 'GET', '/api/projects');
  assert.ok(projects.body.some((item) => item.name === 'Antes da atualização'), 'o projeto continua lá');
  const system = await api(app.page, 'GET', '/api/system');
  assert.ok(system.body.schemaVersion >= schemaBefore);
  const backups = fs.readdirSync(path.join(dataDir, 'backups'));
  assert.ok(backups.some((name) => name.includes('manual')), 'cópia de segurança feita antes de instalar');
  process.stdout.write(`  versão ${state.currentVersion}, dados preservados, ${backups.length} cópia(s) de segurança\n`);

  await close(app);
  process.stdout.write('\n✔ Teste de atualização passou.\n');
} catch (error) {
  if (!(error instanceof Finished)) throw error;
} finally {
  try {
    execFileSync('taskkill', ['/IM', 'XinoIA.exe', '/F', '/T'], { stdio: 'ignore' });
  } catch {
    // Nada rodando.
  }
  await wait(1000);
  if (fs.existsSync(uninstaller)) {
    try {
      execFileSync(uninstaller, ['/S', `_?=${installDir}`], { timeout: 120_000 });
    } catch {
      process.stderr.write('Não foi possível desinstalar ao final do teste.\n');
    }
  }
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(0);
