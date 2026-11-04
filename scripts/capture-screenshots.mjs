// Grava as capturas de tela do README a partir de uma missão real, com os CLIs e contas
// instalados. Gasta um pouco da cota. Uso: node scripts/capture-screenshots.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = path.join(root, 'docs', 'assets', 'screens');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-shots-'));
const projectDir = process.platform === 'win32' ? 'D:\\meu-projeto' : path.join(os.tmpdir(), 'meu-projeto');
const PORT = 4319;
fs.mkdirSync(out, { recursive: true });
fs.rmSync(projectDir, { recursive: true, force: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (text) => process.stdout.write(`${text}\n`);

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
  cwd: root,
  env: { ...process.env, XINOIA_DATA_DIR: dataDir, XINOIA_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const url = await new Promise((resolve, reject) => {
  server.stdout.on('data', (data) => {
    const match = /Abra: (\S+)/.exec(String(data));
    if (match) resolve(match[1]);
  });
  server.on('exit', () => reject(new Error('o servidor parou')));
});
const token = url.split('token=')[1];

const api = async (method, route, body) => {
  const response = await fetch(`http://127.0.0.1:${PORT}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${route}: ${JSON.stringify(data)}`);
  return data;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', (error) => log(`ERRO NA PÁGINA: ${error.message}`));
const shot = async (name) => {
  // Sem isto, uma animação de entrada pode sair congelada no primeiro quadro.
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled' });
  log(`captura: ${name}`);
};
const go = (label) => page.locator('nav[aria-label="Navegação principal"] button', { hasText: label }).click();

try {
  await page.goto(url);
  await page.getByText('Bem-vindo ao Xino').waitFor();
  await wait(400);
  await shot('boas-vindas');
  await page.getByRole('button', { name: 'Pular a configuração' }).click();

  const claude = await api('POST', '/api/profiles', { provider: 'claude', label: 'Principal', useSystemDefault: true });
  const codex = await api('POST', '/api/profiles', { provider: 'codex', label: 'Principal', useSystemDefault: true });
  await api('POST', '/api/profiles/check');
  const project = await api('POST', '/api/projects', { path: projectDir, create: true, name: 'meu-projeto' });
  const ana = await api('POST', '/api/agents', { name: 'Ana', role: 'coordinator', color: '#2DD4BF', provider: 'claude', profileId: claude.id, model: 'haiku', permission: 'read' });
  await api('POST', '/api/agents', { name: 'Bruno', role: 'developer', color: '#F5B544', provider: 'codex', profileId: codex.id, effort: 'low', permission: 'edit' });
  await api('POST', '/api/agents', { name: 'Davi', role: 'tester', color: '#7FB2FF', provider: 'codex', profileId: codex.id, effort: 'low', permission: 'edit' });
  await api('POST', '/api/agents', { name: 'Carla', role: 'reviewer', color: '#BDA6FF', provider: 'claude', profileId: claude.id, model: 'haiku', permission: 'read' });

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.locator('nav[aria-label="Navegação principal"]').waitFor();
  await page.evaluate(() => localStorage.setItem('xinoia.onboarded', '1'));
  await page.reload();
  await page.locator('nav[aria-label="Navegação principal"]').waitFor();

  log('missão: planejando');
  const mission = await api('POST', '/api/missions', {
    projectId: project.id,
    coordinatorId: ana.id,
    goal: 'Crie uma pequena biblioteca de conversão de temperatura em JavaScript: converter.js, com Celsius, Fahrenheit e Kelvin, e testes em converter.test.js com node:test. Sem dependências. Depois, uma pessoa testa e outra revisa.',
  });
  const status = () => api('GET', `/api/missions/${mission.id}`);
  while ((await status()).status === 'planning') await wait(1500);
  if ((await status()).status !== 'awaiting_approval') throw new Error(`plano falhou: ${JSON.stringify(await status())}`);
  await page.reload();
  await page.locator('nav[aria-label="Navegação principal"]').waitFor();
  await go('Tarefas');
  await page.getByText('O plano está pronto').waitFor();
  await wait(500);
  await shot('plano');

  log('missão: executando');
  await api('POST', `/api/missions/${mission.id}/approve`, {});
  await go('Escritório');
  let captured = false;
  for (let i = 0; i < 600; i += 1) {
    const states = await api('GET', '/api/agents-state');
    const busy = states.find((state) => ['executing'].includes(state.activity) && state.detail && state.detail !== 'Escrevendo');
    if (busy && !captured) {
      await wait(700);
      await shot('escritorio');
      await go('Tarefas');
      await wait(1500);
      const cards = await page.locator('section[aria-label] button.rise').evaluateAll((items) => items.map((item) => ({
        text: item.innerText.split('\n')[0],
        opacity: getComputedStyle(item).opacity,
        height: item.getBoundingClientRect().height,
      })));
      log(`cartões na tela: ${JSON.stringify(cards)}`);
      await shot('tarefas');
      await go('Escritório');
      captured = true;
    }
    const current = await status();
    if (['completed', 'failed', 'paused', 'cancelled'].includes(current.status)) {
      log(`missão: ${current.status} ${current.pauseReason ?? ''}`);
      break;
    }
    await wait(800);
  }
  if ((await status()).status === 'paused') await api('POST', `/api/missions/${mission.id}/cancel`).catch(() => undefined);

  await go('Tarefas');
  await wait(800);
  await page.getByText('Relatório final', { exact: true }).first().scrollIntoViewIfNeeded().catch(() => undefined);
  await wait(400);
  await shot('relatorio');

  log('chat');
  await api('POST', '/api/chat/messages', { projectId: project.id, channel: 'team', text: '@Carla em duas frases e com um exemplo curto em código, o que você olhou primeiro na revisão?' });
  await go('Chat');
  for (let i = 0; i < 120; i += 1) {
    const list = await api('GET', `/api/chat/messages?projectId=${project.id}&channel=team`);
    if (list.some((message) => message.role === 'agent' && message.status !== 'streaming')) break;
    await wait(1000);
  }
  await wait(1000);
  await shot('chat');

  await go('Workflows');
  await page.getByText('Modelos prontos').waitFor();
  await wait(1500);
  await shot('workflows');

  await go('Painel');
  await wait(1200);
  await shot('painel');

  await page.getByRole('button', { name: 'Usar tema claro' }).click();
  await go('Escritório');
  await wait(1000);
  await shot('escritorio-claro');
  log('pronto');
} finally {
  await browser.close();
  server.kill();
  await wait(1500);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(0);
