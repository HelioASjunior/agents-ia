// Comprova com os CLIs de verdade que a chave do perfil é a credencial usada. A chave é
// inválida de propósito: o fornecedor recusa e nenhuma cota é gasta. Parte de `npm run test:real`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Project } from '@xinoia/shared';
import { createConfig } from '../../src/config.ts';
import { createContext, type AppContext } from '../../src/context.ts';

const INVALID = 'chave-invalida-do-teste-xinoia-0000';
let ctx: AppContext;
let dataDir: string;
let projectDir: string;
let project: Project;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-real-chave-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-real-chave-projeto-'));
  ctx = await createContext(createConfig({ dataDir }));
  project = await ctx.projects.create({ path: projectDir });
});

after(async () => {
  await ctx.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

for (const [provider, extra] of [['claude', { model: 'haiku' }], ['codex', { effort: 'low' }]] as const) {
  test(`${provider}: com uma chave inválida, recusa a chave em vez de cair na assinatura`, { timeout: 170_000 }, async () => {
    const profile = await ctx.profiles.create({ provider, label: 'Chave', apiKey: INVALID });
    const agent = await ctx.agents.create({ name: `Teste ${provider}`, provider, profileId: profile.id, permission: 'read', ...extra });
    const created = await ctx.runs.create({ agentId: agent.id, projectId: project.id, prompt: 'Responda só: oi' });
    const run = await ctx.runs.waitFor(created.id);

    // Se tivesse usado a assinatura do computador, responderia "oi" e passaria.
    assert.equal(run.status, 'failed', `saiu como ${run.status}: ${run.finalText}`);
    assert.equal(run.errorKind, 'auth', `${run.errorKind}: ${run.errorText}`);
    assert.match(run.errorText ?? '', /recusou a chave de API/);

    const events = await ctx.db.runEvents.listForRun(created.id);
    assert.ok(!JSON.stringify(events).includes(INVALID), 'a chave aparece nos eventos gravados');
    if (run.logPath && fs.existsSync(run.logPath)) assert.ok(!fs.readFileSync(run.logPath, 'utf8').includes(INVALID), 'a chave aparece no log');
  });
}
