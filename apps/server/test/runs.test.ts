import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import WebSocket from 'ws';
import type { AgentEvent, ServerMessage } from '@xinoia/shared';
import { createHarness, removeDir, tempDir } from './support/harness.ts';

const texts = (events: Array<{ event: AgentEvent }>) =>
  events.flatMap(({ event }) => (event.type === 'text' ? [event.text] : [])).join('');

test('Execução completa: processo real, eventos em ordem, arquivo alterado e totais', async () => {
  const h = await createHarness();
  const { projectId, agentId, profileId } = await h.setup();

  const run = await h.ctx.runs.create({ agentId, projectId, prompt: 'ESCREVER=novo.txt' });
  assert.equal(run.status, 'queued');
  const done = await h.ctx.runs.waitFor(run.id);

  assert.equal(done.status, 'completed', done.errorText ?? '');
  assert.equal(done.finalText, 'feito');
  assert.equal(done.exitCode, 0);
  assert.equal(done.model, 'modelo-teste');
  assert.deepEqual(done.usage, { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(done.filesChanged, ['novo.txt']);
  assert.ok(done.startedAt && done.endedAt && done.endedAt >= done.startedAt);
  assert.ok(fs.existsSync(path.join(h.projectDir, 'novo.txt')));

  const events = await h.ctx.runs.events(run.id);
  const types = events.map((e) => e.event.type);
  assert.deepEqual(types, ['session', 'tool_start', 'tool_end', 'text', 'final']);
  assert.deepEqual(events.map((e) => e.id), [...events.map((e) => e.id)].sort((a, b) => a - b));

  const profile = await h.db().profiles.get(profileId);
  assert.deepEqual(profile?.totals, { runs: 1, inputTokens: 10, outputTokens: 5 });
  assert.ok(done.logPath && fs.readFileSync(done.logPath, 'utf8').includes('stream_event'));
  await h.cleanup();
});

test('O prompt chega por stdin com o papel do agente, sem virar argumento', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const secretCommand = 'texto & calc | "aspas" %PATH% VER_ARGS';
  await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: secretCommand })).id);

  const received = fs.readFileSync(path.join(h.projectDir, 'prompt-recebido.txt'), 'utf8');
  assert.ok(received.includes(secretCommand));
  assert.match(received, /Você é Ana/);
  const args = JSON.parse(fs.readFileSync(path.join(h.projectDir, 'args.json'), 'utf8')) as string[];
  assert.ok(!args.some((arg) => arg.includes('calc')));
  await h.cleanup();
});

test('O processo não recebe chaves de API nem a pasta padrão, só a do perfil', async () => {
  const h = await createHarness();
  const { projectId, agentId, profileId } = await h.setup();
  process.env.ANTHROPIC_API_KEY = 'nao-pode-chegar';
  process.env.CLAUDECODE = '1';
  try {
    await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'VER_AMBIENTE' })).id);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDECODE;
  }
  const env = JSON.parse(fs.readFileSync(path.join(h.projectDir, 'ambiente.json'), 'utf8')) as Record<string, string>;
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, path.join(h.config.profilesDir, profileId));
  await h.cleanup();
});

test('Perfis diferentes usam pastas diferentes', async () => {
  const h = await createHarness();
  const a = await h.setup('Ana');
  const b = await h.setup('Bia');
  assert.notEqual(a.profileId, b.profileId);
  assert.ok(fs.existsSync(path.join(h.config.profilesDir, a.profileId)));
  assert.ok(fs.existsSync(path.join(h.config.profilesDir, b.profileId)));
  // A pasta do perfil fica nos dados do usuário, não no projeto.
  assert.ok(!path.join(h.config.profilesDir, a.profileId).startsWith(h.projectDir));
  await h.ctx.profiles.remove(a.profileId);
  assert.ok(!fs.existsSync(path.join(h.config.profilesDir, a.profileId)));
  assert.ok(fs.existsSync(path.join(h.config.profilesDir, b.profileId)));
  await h.cleanup();
});

test('Continuar sessão usa a sessão anterior; sessão perdida recomeça sozinha', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const first = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'oi' })).id);
  const second = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'de novo', resume: true })).id);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.finalText, 'feito (continuando)');
  assert.match(second.command ?? '', /--resume/);

  const recovered = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'SESSAO_PERDIDA', resume: true })).id);
  assert.equal(recovered.status, 'completed', recovered.errorText ?? '');
  const warnings = (await h.ctx.runs.events(recovered.id)).filter((e) => e.event.type === 'warning');
  assert.equal(warnings.length, 1);
  await h.cleanup();
});

test('Cancelar encerra o processo de verdade', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const run = await h.ctx.runs.create({ agentId, projectId, prompt: 'DORMIR' });
  // Espera o agente começar a escrever para cancelar no meio.
  for (let i = 0; i < 200; i += 1) {
    const events = await h.ctx.runs.events(run.id);
    if (texts(events).includes('dormindo')) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const started = Date.now();
  await h.ctx.runs.cancel(run.id);
  const done = await h.ctx.runs.waitFor(run.id);
  assert.equal(done.status, 'cancelled');
  assert.ok(Date.now() - started < 10_000, 'não esperou o fim do processo');
  await assert.rejects(h.ctx.runs.cancel(run.id), /já terminou/);
  await h.cleanup();
});

test('Cancelar uma execução na fila impede que ela comece', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const first = await h.ctx.runs.create({ agentId, projectId, prompt: 'ESPERAR_POUCO' });
  const second = await h.ctx.runs.create({ agentId, projectId, prompt: 'ESCREVER=nao-deveria.txt' });
  await h.ctx.runs.cancel(second.id);
  assert.equal((await h.ctx.runs.waitFor(second.id)).status, 'cancelled');
  assert.equal((await h.ctx.runs.waitFor(first.id)).status, 'completed');
  assert.ok(!fs.existsSync(path.join(h.projectDir, 'nao-deveria.txt')));
  await h.cleanup();
});

test('O mesmo agente faz uma coisa por vez, na ordem pedida', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const runs = await Promise.all(['A', 'B', 'C'].map((name) =>
    h.ctx.runs.create({ agentId, projectId, prompt: `ESPERAR_POUCO NOME=${name}` })));
  await Promise.all(runs.map((run) => h.ctx.runs.waitFor(run.id)));
  const order = fs.readFileSync(path.join(h.projectDir, 'ordem.txt'), 'utf8').trim().split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
  assert.deepEqual(order, ['inicio A', 'fim A', 'inicio B', 'fim B', 'inicio C', 'fim C']);
  await h.cleanup();
});

test('Agentes diferentes rodam em paralelo, menos se dividem uma integração exclusiva', async () => {
  const h = await createHarness();
  const a = await h.setup('Ana');
  const b = await h.setup('Bia');
  const kit = await h.ctx.toolkits.addUnreal();
  await h.ctx.agents.update(a.agentId, { toolkitIds: [kit.id] });
  await h.ctx.agents.update(b.agentId, { toolkitIds: [kit.id] });

  const runs = await Promise.all([
    h.ctx.runs.create({ agentId: a.agentId, projectId: a.projectId, prompt: 'ESPERAR_POUCO NOME=A' }),
    h.ctx.runs.create({ agentId: b.agentId, projectId: b.projectId, prompt: 'ESPERAR_POUCO NOME=B' }),
  ]);
  await Promise.all(runs.map((run) => h.ctx.runs.waitFor(run.id)));
  const exclusive = fs.readFileSync(path.join(h.projectDir, 'ordem.txt'), 'utf8').trim().split('\n').map((l) => l.trim().replace(/\s+/g, ' '));
  assert.equal(exclusive.length, 4);
  assert.equal(exclusive[0]?.split(' ')[1], exclusive[1]?.split(' ')[1], 'um termina antes do outro começar');

  // Sem a integração exclusiva, um só termina depois de ver o outro rodando.
  fs.rmSync(path.join(h.projectDir, 'ordem.txt'));
  await h.ctx.agents.update(a.agentId, { toolkitIds: [] });
  await h.ctx.agents.update(b.agentId, { toolkitIds: [] });
  const parallel = await Promise.all([
    h.ctx.runs.create({ agentId: a.agentId, projectId: a.projectId, prompt: 'ENCONTRO NOME=A' }),
    h.ctx.runs.create({ agentId: b.agentId, projectId: b.projectId, prompt: 'ENCONTRO NOME=B' }),
  ]);
  const finished = await Promise.all(parallel.map((run) => h.ctx.runs.waitFor(run.id)));
  for (const run of finished) assert.equal(run.status, 'completed', run.errorText ?? '');
  await h.cleanup();
});

test('Falhas são classificadas; limite informado pelo CLI fica no perfil', async () => {
  const h = await createHarness();
  const { projectId, agentId, profileId } = await h.setup();

  const limit = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'LIMITE' })).id);
  assert.equal(limit.status, 'failed');
  assert.equal(limit.errorKind, 'limit');
  const usage = (await h.db().profiles.get(profileId))?.usage;
  assert.equal(usage?.status, 'rejected');
  assert.equal(usage?.windows?.five_hour?.utilization, 1);

  const auth = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'SEM_LOGIN' })).id);
  assert.equal(auth.errorKind, 'auth');

  const broken = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'QUEBRAR' })).id);
  assert.equal(broken.status, 'failed');
  assert.equal(broken.exitCode, 3);
  assert.match(broken.errorText ?? '', /algo deu errado/);
  await h.cleanup();
});

test('Sem consumo informado, nada é inventado', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const done = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'QUEBRAR' })).id);
  assert.equal(done.usage, null);
  await h.cleanup();
});

test('Segredos impressos pelo agente não chegam ao banco nem ao log', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
  const done = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: `VAZAR_SEGREDO ${secret}` })).id);
  const events = await h.ctx.runs.events(done.id);
  assert.ok(texts(events).includes('sk-ant-***'));
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.ok(!done.prompt.includes(secret));
  assert.ok(!fs.readFileSync(done.logPath!, 'utf8').includes(secret));
  await h.cleanup();
});

test('Erros de configuração têm mensagem clara', async () => {
  const h = await createHarness();
  const { projectId, agentId, profileId } = await h.setup();

  await h.ctx.profiles.remove(profileId);
  await assert.rejects(h.ctx.runs.create({ agentId, projectId, prompt: 'x' }), /não tem perfil conectado/);
  await assert.rejects(h.ctx.runs.create({ agentId: 'nao', projectId, prompt: 'x' }), /Agente não encontrado/);
  await assert.rejects(h.ctx.agents.create({ name: 'x', provider: 'inexistente' }), /Provedor desconhecido/);
  await h.cleanup();
});

test('WebSocket transmite em tempo real e reenvia o que faltou ao reconectar', async () => {
  const h = await createHarness();
  const { projectId, agentId } = await h.setup();
  const address = await h.app.listen({ host: '127.0.0.1', port: 0 });
  const wsUrl = `${address.replace('http', 'ws')}/ws?token=${h.token}`;

  const received: ServerMessage[] = [];
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve) => socket.once('message', resolve));
  socket.on('message', (data) => received.push(JSON.parse(String(data)) as ServerMessage));

  const run = await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId, projectId, prompt: 'ESCREVER=a.txt' })).id);
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.close();

  const live = received.filter((m) => m.kind === 'run_event');
  assert.ok(live.length >= 4, `eventos ao vivo: ${live.length}`);
  const statuses = received.flatMap((m) => (m.kind === 'run_updated' && m.data.id === run.id ? [m.data.status] : []));
  assert.equal(statuses.at(-1), 'completed');
  assert.ok(statuses.includes('running'));

  // Reconecta depois de perder eventos.
  const stored = await h.ctx.runs.events(run.id);
  const replay = await new Promise<ServerMessage[]>((resolve) => {
    const again: ServerMessage[] = [];
    const late = new WebSocket(`${wsUrl}&after=${stored[0]!.id}`);
    late.on('message', (data) => {
      again.push(JSON.parse(String(data)) as ServerMessage);
      if (again.filter((m) => m.kind === 'run_event').length === stored.length - 1) {
        late.close();
        resolve(again);
      }
    });
  });
  const ids = replay.flatMap((m) => (m.kind === 'run_event' ? [m.data.id] : []));
  assert.deepEqual(ids, stored.slice(1).map((e) => e.id));
  await h.cleanup();
});

test('Fechar e reabrir: histórico preservado e execução pendente marcada como interrompida', async () => {
  const dataDir = tempDir();
  const first = await createHarness({ dataDir, keep: true });
  const { projectId, agentId } = await first.setup();
  const done = await first.ctx.runs.waitFor((await first.ctx.runs.create({ agentId, projectId, prompt: 'ESCREVER=a.txt' })).id);
  const before = await first.ctx.runs.events(done.id);

  // Simula queda: uma execução que ficou como "rodando" no banco.
  await first.db().runs.insert({ ...done, id: 'run_queda', status: 'running', endedAt: null });
  await first.app.close();

  const second = await createHarness({ dataDir, keep: true });
  assert.equal(second.ctx.interruptedOnStart, 1);
  assert.equal((await second.ctx.runs.get('run_queda')).status, 'interrupted');
  const after = await second.ctx.runs.get(done.id);
  assert.equal(after.status, 'completed');
  assert.deepEqual(await second.ctx.runs.events(done.id), before);
  assert.equal((await second.ctx.agents.list()).length, 1);
  assert.equal((await second.ctx.projects.list()).length, 1);
  await second.app.close();
  removeDir(dataDir);
  removeDir(first.projectDir);
  removeDir(second.projectDir);
});
