// Grava a tela de escolha da IA como uma pessoa nova a vê: os CLIs apontam para pastas
// vazias, então nenhuma conta de quem roda este script aparece na imagem.
// Uso: node scripts/capture-sua-ia.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-sua-ia-'));
const folder = (name) => {
  const dir = path.join(sandbox, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const PORT = 4320;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'apps/server/src/index.ts'], {
  cwd: root,
  env: {
    ...process.env,
    XINOIA_DATA_DIR: folder('dados'),
    XINOIA_PORT: String(PORT),
    CLAUDE_CONFIG_DIR: folder('claude'),
    CODEX_HOME: folder('codex'),
    GEMINI_CLI_HOME: folder('gemini'),
  },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const url = await new Promise((resolve, reject) => {
  server.stdout.on('data', (data) => {
    const match = /Abra: (\S+)/.exec(String(data));
    if (match) resolve(match[1]);
  });
  server.on('exit', () => reject(new Error('o servidor parou')));
});

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.goto(url);
  await page.getByText('Bem-vindo ao Xino').waitFor();
  await page.getByRole('button', { name: 'Começar' }).click();
  await page.getByText('Escolha a sua IA').waitFor();
  await wait(5000);
  const text = await page.locator('[role=dialog]').innerText();
  if (/plano|@/i.test(text.replace('com a sua assinatura', '').replace('seu plano', ''))) throw new Error(`a tela mostra dados de uma conta: ${text}`);
  await page.screenshot({ path: path.join(root, 'docs', 'assets', 'screens', 'sua-ia.png'), animations: 'disabled' });
  process.stdout.write(`${text.replace(/\n+/g, ' | ')}\n`);
} finally {
  await browser.close();
  server.kill();
  await wait(1500);
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(0);
