// Testes com os CLIs de verdade e o login do usuário: `npm run test:real`.
// Gastam um pouco da cota da assinatura e ficam fora de `npm test` e do CI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { Agent, Profile, Project } from '@xinoia/shared';
import { createConfig } from '../../src/config.ts';
import { createContext, type AppContext } from '../../src/context.ts';
import { claudeAdapter } from '../../src/providers/claude.ts';
import { codexAdapter } from '../../src/providers/codex.ts';
import { buildEnv, capture } from '../../src/process/spawn.ts';

const ACCENTED = 'código-ação';

let ctx: AppContext;
let dataDir: string;
let projectDir: string;
let project: Project;
let claudeProfile: Profile;
let codexProfile: Profile;
let claude: Agent;
let codex: Agent;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia-real-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xinoia real projeto '));
  ctx = await createContext(createConfig({ dataDir }));
  await ctx.detection.refresh();
  project = await ctx.projects.create({ path: projectDir });
  claudeProfile = await ctx.profiles.check((await ctx.profiles.create({ provider: 'claude', label: 'Padrão', useSystemDefault: true })).id);
  codexProfile = await ctx.profiles.check((await ctx.profiles.create({ provider: 'codex', label: 'Padrão', useSystemDefault: true })).id);
  claude = await ctx.agents.create({ name: 'Ana', provider: 'claude', profileId: claudeProfile.id, model: 'haiku', permission: 'edit' });
  codex = await ctx.agents.create({ name: 'Bruno', provider: 'codex', profileId: codexProfile.id, effort: 'low', permission: 'edit' });
});

after(async () => {
  await ctx.close();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const run = async (agent: Agent, prompt: string, extra: object = {}) =>
  ctx.runs.waitFor((await ctx.runs.create({ agentId: agent.id, projectId: project.id, prompt, ...extra })).id);

test('Detecta versão e capacidades dos CLIs instalados', () => {
  const list = ctx.detection.list();
  for (const id of ['claude', 'codex']) {
    const provider = list.find((p) => p.id === id);
    assert.equal(provider?.installed, true, id);
    assert.match(provider?.version ?? '', /\d+\.\d+/);
    assert.equal(provider?.capabilities.streamJson, true);
    assert.equal(provider?.capabilities.resume, true);
  }
});

test('Login padrão é reconhecido como assinatura', () => {
  assert.equal(claudeProfile.auth?.loggedIn, true);
  assert.equal(claudeProfile.auth?.subscription, true);
  assert.equal(codexProfile.auth?.loggedIn, true);
  assert.equal(codexProfile.auth?.subscription, true);
});

test('Perfil novo é isolado: não enxerga o login padrão', async () => {
  for (const provider of ['claude', 'codex']) {
    const created = await ctx.profiles.create({ provider, label: `Isolado ${provider}` });
    const checked = await ctx.profiles.check(created.id);
    assert.equal(checked.auth?.loggedIn, false, provider);
    assert.ok(fs.existsSync(path.join(ctx.config.profilesDir, created.id)));
    await ctx.profiles.remove(created.id);
  }
});

test('Claude real: cria arquivo, com acentos e pasta com espaço, e continua a sessão', async () => {
  const done = await run(claude, `Use a ferramenta de escrita para criar o arquivo claude.txt contendo exatamente: ${ACCENTED}. Depois responda só OK.`);
  assert.equal(done.status, 'completed', done.errorText ?? '');
  assert.equal(fs.readFileSync(path.join(projectDir, 'claude.txt'), 'utf8').trim(), ACCENTED);
  assert.deepEqual(done.filesChanged, ['claude.txt']);
  assert.ok(done.sessionId);
  assert.ok((done.usage?.outputTokens ?? 0) > 0);

  const events = await ctx.runs.events(done.id);
  assert.ok(events.some((e) => e.event.type === 'tool_start' && e.event.name === 'Write'));
  assert.ok(events.some((e) => e.event.type === 'tool_end' && e.event.ok));
  assert.ok(!events.some((e) => e.event.type === 'warning' && /credencial de API/.test(e.event.text)), 'usou assinatura');

  const usage = (await ctx.db.profiles.get(claudeProfile.id))?.usage;
  assert.ok(usage?.windows, 'o CLI informou os limites da conta');

  const next = await run(claude, 'Qual foi o nome do arquivo que você criou? Responda só o nome.', { resume: true });
  assert.equal(next.status, 'completed', next.errorText ?? '');
  assert.equal(next.sessionId, done.sessionId);
  assert.match(next.finalText ?? '', /claude\.txt/);
});

test('Claude real: cada nome completo da lista existe, e o apelido aponta para a versão certa', async () => {
  for (const model of claudeAdapter.models.filter((name) => name.startsWith('claude-'))) {
    const agent = await ctx.agents.create({ name: `Modelo ${model}`, provider: 'claude', profileId: claudeProfile.id, model, permission: 'read' });
    const done = await run(agent, 'Responda só OK.');
    assert.equal(done.status, 'completed', `${model}: ${done.errorText ?? ''}`);
    assert.equal(done.model, model);
    await ctx.agents.remove(agent.id);
  }
  const alias = await run(claude, 'Responda só OK.');
  assert.equal(alias.status, 'completed', alias.errorText ?? '');
  assert.ok(claudeAdapter.models.includes(alias.model ?? ''), `o apelido apontou para ${alias.model}, que falta na lista`);
  assert.match(alias.model ?? '', /^claude-haiku-/);
});

test('Claude real: somente leitura não consegue alterar arquivos', async () => {
  const done = await run(claude, 'Crie o arquivo proibido.txt com o texto x. Se não conseguir, responda NAO.', { permission: 'read' });
  assert.equal(done.status, 'completed', done.errorText ?? '');
  assert.ok(!fs.existsSync(path.join(projectDir, 'proibido.txt')));
});

test('Claude real: cancelar encerra o processo', async () => {
  const created = await ctx.runs.create({
    agentId: claude.id,
    projectId: project.id,
    prompt: 'Escreva um texto longo sobre a história da computação, com pelo menos 2000 palavras.',
  });
  for (let i = 0; i < 400; i += 1) {
    if ((await ctx.runs.events(created.id)).some((e) => e.event.type === 'session')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await ctx.runs.cancel(created.id);
  const done = await ctx.runs.waitFor(created.id);
  assert.equal(done.status, 'cancelled');
});

test('Claude real: carrega plugin e servidor MCP do Unreal', async () => {
  const kit = await ctx.toolkits.addUnreal();
  await ctx.agents.update(claude.id, { toolkitIds: [kit.id] });
  // Sem editor aberto, o MCP não conecta, mas a skill precisa estar carregada.
  const done = await run(claude, 'Responda só OK.');
  await ctx.agents.update(claude.id, { toolkitIds: [] });
  assert.equal(done.status, 'completed', done.errorText ?? '');
  assert.match(done.command ?? '', /--mcp-config/);
  const log = fs.readFileSync(done.logPath!, 'utf8');
  const init = log.split('\n').map((line) => (line ? JSON.parse(line) as { line?: string } : {}))
    .find((entry) => entry.line?.includes('"subtype":"init"'));
  const parsed = JSON.parse(init!.line!) as { mcp_servers: Array<{ name: string }>; skills: string[] };
  assert.ok(parsed.mcp_servers.some((server) => server.name === 'unreal-mcp'), 'servidor MCP configurado');
  assert.ok(parsed.skills.some((skill) => skill.includes('unreal-mcp')), 'skill do Unreal carregada');
});

test('Claude real: regra de negação vale mesmo com permissão total', async () => {
  await ctx.settings.update({ executionMode: 'autonomous' });
  const guarded = await ctx.agents.create({ name: 'Guarda', provider: 'claude', profileId: claudeProfile.id, model: 'haiku', permission: 'full' });
  const dir = path.join(projectDir, 'nao-apagar');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const done = await run(guarded, 'Use a ferramenta Bash para rodar exatamente: rm -rf nao-apagar . Se for negado, responda NEGADO e não tente outra forma.');
  await ctx.settings.update({ executionMode: 'semi' });
  assert.ok(fs.existsSync(path.join(dir, 'a.txt')), 'a pasta continua lá');
  assert.match(done.command ?? '', /--settings/);
  assert.match(done.command ?? '', /--dangerously-skip-permissions/);
});

test('Codex real: executa comando, cria arquivo e continua a sessão', async () => {
  const done = await run(codex, `Crie o arquivo codex.txt contendo exatamente: ${ACCENTED}. Depois responda só OK.`);
  assert.equal(done.status, 'completed', done.errorText ?? '');
  assert.equal(fs.readFileSync(path.join(projectDir, 'codex.txt'), 'utf8').trim(), ACCENTED);
  assert.ok(done.sessionId);
  assert.ok(done.usage);

  const next = await run(codex, 'Qual o nome do arquivo que você criou? Responda só o nome.', { resume: true });
  assert.equal(next.status, 'completed', next.errorText ?? '');
  assert.equal(next.sessionId, done.sessionId);
  assert.match(next.finalText ?? '', /codex\.txt/);
});

test('Codex real: somente leitura não consegue alterar arquivos', async () => {
  const done = await run(codex, 'Crie o arquivo proibido2.txt com o texto x. Se não conseguir, responda NAO.', { permission: 'read' });
  assert.ok(!fs.existsSync(path.join(projectDir, 'proibido2.txt')));
  assert.notEqual(done.status, 'running');
});

test('Codex real: aceita o MCP do Unreal por configuração', async () => {
  const args = ['mcp', 'list', '-c', 'mcp_servers.unreal-mcp.url=http://127.0.0.1:8000/mcp'];
  const result = await capture({
    command: codexAdapter.command,
    args,
    cwd: os.homedir(),
    env: buildEnv(codexAdapter, null),
  });
  assert.match(`${result.stdout}${result.stderr}`, /unreal-mcp/);
});
