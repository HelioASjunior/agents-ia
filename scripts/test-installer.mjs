// Teste de distribuição: usa o instalador de verdade, como uma pessoa usaria.
//   node scripts/test-installer.mjs              instalador e versão portátil
// Dados e instalação ficam em uma pasta temporária, sem tocar nos dados reais do XinoIA.
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { refuseRealInstall } from './guard-real-install.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8'));
const release = path.join(root, 'release');
refuseRealInstall();
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-dist-'));
// O Electron no Windows ignora a variável APPDATA: a pasta de teste vai pela opção própria.
const dataDir = path.join(sandbox, 'dados-do-usuario', 'XinoIA');
fs.mkdirSync(dataDir, { recursive: true });
const screenshots = process.env.XINOIA_TEST_SHOTS;
let debugPort = 9400;

const step = (text) => process.stdout.write(`\n▶ ${text}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch(exe, userData) {
  debugPort += 1;
  const port = debugPort;
  const args = [`--remote-debugging-port=${port}`];
  if (userData) args.push(`--user-data-dir=${userData}`);
  const child = spawn(exe, args, { stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 120 && !browser; i += 1) {
    await wait(500);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
  }
  assert.ok(browser, 'o app abriu e aceitou a conexão de teste');
  let page;
  for (let i = 0; i < 120 && !page; i += 1) {
    page = browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().startsWith('http://127.0.0.1'));
    if (!page) await wait(500);
  }
  assert.ok(page, 'a janela principal abriu');
  await page.waitForSelector('nav[aria-label="Navegação principal"]', { timeout: 60_000 });
  const api = (method, url, body) => page.evaluate(async ({ method, url, body }) => {
    const token = sessionStorage.getItem('xinoia.token');
    const response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { method, url, body });
  return { child, browser, page, api };
}

function listLeftovers() {
  const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq XinoIA*', '/NH'], { encoding: 'utf8' });
  return /XinoIA/i.test(output);
}

/** Fecha como quem clica no X: o próprio app encerra o backend e sai. */
async function close(app) {
  const session = await app.browser.newBrowserCDPSession();
  // A conexão morre junto com o app, então a resposta deste comando pode nunca chegar.
  void session.send('Browser.close').catch(() => undefined);
  await wait(500);
  for (let i = 0; i < 60 && listLeftovers(); i += 1) await wait(500);
  assert.equal(listLeftovers(), false, 'nenhum processo do XinoIA ficou para trás');
  await wait(500);
}

async function exercise(app, label, expectedDataDir) {
  const { page, api } = app;
  const system = await api('GET', '/api/system');
  assert.equal(system.status, 200);
  assert.equal(system.body.product, 'XinoIA');
  assert.ok(system.body.schemaVersion >= 4, 'banco migrado');
  assert.equal(path.resolve(system.body.dataDir).toLowerCase(), path.resolve(expectedDataDir).toLowerCase(), 'dados na pasta certa');
  process.stdout.write(`  backend ok, banco v${system.body.schemaVersion}, dados em ${system.body.dataDir}\n`);

  assert.equal(await page.title(), 'XinoIA');
  const providers = await api('GET', '/api/providers');
  assert.equal(providers.status, 200);
  assert.ok(providers.body.some((provider) => provider.id === 'claude'));
  process.stdout.write(`  detecção: ${providers.body.map((p) => `${p.label}=${p.installed ? 'sim' : 'não'}`).join(', ')}\n`);

  const folder = path.join(sandbox, `projeto-${label}`);
  const project = await api('POST', '/api/projects', { path: folder, create: true, name: `Projeto ${label}` });
  assert.equal(project.status, 201, JSON.stringify(project.body));

  // Terminal real: prova que o módulo nativo veio no pacote e funciona.
  const terminal = await api('POST', '/api/terminals', { kind: 'shell', projectId: project.body.id });
  assert.equal(terminal.status, 201, JSON.stringify(terminal.body));
  const output = await page.evaluate(async (id) => {
    const token = sessionStorage.getItem('xinoia.token');
    return new Promise((resolve) => {
      let text = '';
      const socket = new WebSocket(`ws://${location.host}/ws/terminal/${id}?token=${token}`);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'input', data: 'echo marca-pty\r' }));
      socket.onmessage = (event) => {
        text += JSON.parse(event.data).data ?? '';
        if ((text.match(/marca-pty/g) ?? []).length >= 2) {
          socket.close();
          resolve(text);
        }
      };
      setTimeout(() => resolve(text), 15000);
    });
  }, terminal.body.id);
  assert.match(output, /marca-pty[\s\S]*marca-pty/, 'terminal executou um comando');
  await api('DELETE', `/api/terminals/${terminal.body.id}`);
  process.stdout.write('  terminal PTY ok\n');

  // Chave de API: o Windows precisa cifrar a partir do backend empacotado, e ela não volta.
  const secret = 'chave-de-teste-do-instalador-12345';
  const keyed = await api('POST', '/api/profiles', { provider: 'claude', label: 'Chave', apiKey: secret });
  assert.equal(keyed.status, 201, JSON.stringify(keyed.body));
  assert.equal(keyed.body.credential, 'api_key');
  const checked = await api('POST', `/api/profiles/${keyed.body.id}/check`);
  assert.equal(checked.body.auth.subscription, false);
  const listed = await api('GET', '/api/profiles');
  assert.ok(!JSON.stringify(listed.body).includes(secret), 'a chave não pode voltar pela API');
  await api('DELETE', `/api/profiles/${keyed.body.id}`);
  process.stdout.write('  chave de API cifrada ok\n');

  // Sem permissões do Node na página: a ponte é só a lista combinada.
  const bridge = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, bridge: Object.keys(window.xinoia ?? {}).sort() }));
  assert.equal(bridge.require, 'undefined');
  assert.equal(bridge.process, 'undefined');
  assert.deepEqual(bridge.bridge, ['notify', 'pickFolder', 'updates']);
  process.stdout.write('  isolamento da página ok\n');

  if (screenshots) {
    fs.mkdirSync(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, `${label}.png`) });
  }
  return project.body;
}

let uninstaller = null;

try {
  // -------------------------------------------------------------------------
  step(`Instalar XinoIA-Setup-v${version}.exe (primeira vez, em ambiente limpo)`);
  const setup = path.join(release, `XinoIA-Setup-v${version}.exe`);
  assert.ok(fs.existsSync(setup), `instalador existe: ${setup}`);
  const installDir = path.join(sandbox, 'Programas', 'XinoIA');
  uninstaller = path.join(installDir, 'Uninstall XinoIA.exe');
  execFileSync(setup, ['/S', `/D=${installDir}`], { timeout: 300_000 });
  for (let i = 0; i < 60 && !fs.existsSync(path.join(installDir, 'XinoIA.exe')); i += 1) await wait(1000);
  const exe = path.join(installDir, 'XinoIA.exe');
  assert.ok(fs.existsSync(exe), 'XinoIA.exe instalado');
  assert.ok(fs.existsSync(path.join(installDir, 'Uninstall XinoIA.exe')), 'desinstalador presente');
  // Sem este arquivo o programa abre normalmente, mas nunca consegue se atualizar.
  assert.ok(fs.existsSync(path.join(installDir, 'resources', 'app-update.yml')), 'configuração de atualização presente');
  const shipped = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}').VersionInfo | Select-Object -ExpandProperty ProductName`], { encoding: 'utf8' }).trim();
  assert.equal(shipped, 'XinoIA', 'nome nas propriedades do executável');
  process.stdout.write(`  instalado em ${installDir}\n`);

  // -------------------------------------------------------------------------
  step('Primeira abertura');
  let app = await launch(exe, dataDir);
  const welcome = await app.page.getByText('Bem-vindo ao Xino').isVisible().catch(() => false);
  assert.ok(welcome, 'o assistente de primeira execução apareceu');
  process.stdout.write('  assistente de boas-vindas apareceu\n');
  const project = await exercise(app, 'instalado', dataDir);

  // -------------------------------------------------------------------------
  step('Fechar e reabrir: os dados continuam');
  await close(app);
  app = await launch(exe, dataDir);
  const projects = await app.api('GET', '/api/projects');
  assert.ok(projects.body.some((item) => item.id === project.id), 'o projeto continua lá');
  process.stdout.write('  dados preservados, sem processos para trás\n');
  await close(app);

  // -------------------------------------------------------------------------
  step('Pacote não leva arquivos sensíveis nem dados de desenvolvimento');
  const asarFiles = execFileSync(process.execPath, ['-e', `
    const { listPackage } = require(${JSON.stringify(path.join(root, 'node_modules/@electron/asar'))});
    console.log(listPackage(${JSON.stringify(path.join(installDir, 'resources/app.asar'))}).join('\\n'));
  `], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const pattern of [/\.db$/m, /\.xinoia-dev/, /update-signing-key/, /\.env\b/, /[\\/]test[\\/]support/, /CLAUDE\.md/]) {
    assert.doesNotMatch(asarFiles, pattern, `não pode estar no pacote: ${pattern}`);
  }
  assert.match(asarFiles, /update-public-key\.pem/);
  process.stdout.write('  pacote limpo, com a chave pública de atualização\n');

  // -------------------------------------------------------------------------
  step('Desinstalar: remove o programa e preserva os dados do usuário');
  execFileSync(uninstaller, ['/S', `_?=${installDir}`], { timeout: 120_000 });
  await wait(3000);
  uninstaller = null;
  assert.ok(!fs.existsSync(exe), 'programa removido');
  assert.ok(fs.existsSync(path.join(dataDir, 'xinoia.db')), 'dados do usuário preservados');
  process.stdout.write('  programa removido, dados preservados\n');

  // -------------------------------------------------------------------------
  step('Versão portátil: roda sem instalar, com os dados ao lado do programa');
  const portableSource = path.join(release, `XinoIA-Portable-v${version}.exe`);
  assert.ok(fs.existsSync(portableSource));
  const portableDir = path.join(sandbox, 'pendrive');
  fs.mkdirSync(portableDir);
  const portable = path.join(portableDir, 'XinoIA-Portable.exe');
  fs.copyFileSync(portableSource, portable);
  app = await launch(portable);
  await exercise(app, 'portatil', path.join(portableDir, 'XinoIA-dados'));
  await close(app);
  assert.ok(fs.existsSync(path.join(portableDir, 'XinoIA-dados', 'xinoia.db')), 'dados ao lado do programa');
  process.stdout.write('  portátil ok\n');

  process.stdout.write('\n✔ Teste de distribuição passou.\n');
} finally {
  try {
    execFileSync('taskkill', ['/IM', 'XinoIA.exe', '/F', '/T'], { stdio: 'ignore' });
  } catch {
    // Nada rodando.
  }
  await wait(1000);
  // Se o teste parar no meio, não deixa atalho nem registro de instalação para trás.
  if (uninstaller && fs.existsSync(uninstaller)) {
    try {
      execFileSync(uninstaller, ['/S', `_?=${path.dirname(uninstaller)}`], { timeout: 120_000 });
    } catch {
      process.stderr.write('Não foi possível desinstalar ao final do teste.\n');
    }
  }
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
process.exit(0);
