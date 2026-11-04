import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import WebSocket from 'ws';
import type { Agent } from '@xinoia/shared';
import { findMentions, isWholeTeamRequest } from '../src/services/chat.ts';
import { resolveInside } from '../src/services/files.ts';
import { createHarness, removeDir, tempDir, type Harness } from './support/harness.ts';

const named = (id: string, name: string) => ({ id, name }) as Agent;

test('Menções: encontra por nome, na ordem, sem pegar parte de palavra', () => {
  const team = [named('1', 'Ana'), named('2', 'Bia')];
  assert.deepEqual(findMentions('@Bia revise e @ana implemente', team).map((a) => a.name), ['Bia', 'Ana']);
  assert.deepEqual(findMentions('@Anabela olhe', team), []);
  assert.deepEqual(findMentions('email ana@teste.com', team), []);
  assert.deepEqual(findMentions('fale com @ANA, por favor', team).map((a) => a.name), ['Ana']);
});

test('Pedido para a equipe inteira é reconhecido', () => {
  assert.equal(isWholeTeamRequest('Equipe, analisem isto'), true);
  assert.equal(isWholeTeamRequest('@todos vejam'), true);
  assert.equal(isWholeTeamRequest('a equipe de vendas pediu'), false);
});

async function agents(h: Harness) {
  const a = await h.setup('Ana');
  const profile = await h.ctx.profiles.create({ provider: 'fake', label: 'B' });
  const b = await h.ctx.agents.create({ name: 'Bia', role: 'reviewer', provider: 'fake', profileId: profile.id });
  return { projectId: a.projectId, anaId: a.agentId, biaId: b.id };
}

test('Chat direto: responde, guarda o histórico e continua a sessão', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: anaId, text: 'oi' });
  await h.ctx.chat.idle();
  await h.ctx.chat.send({ projectId, channel: anaId, text: 'de novo' });
  await h.ctx.chat.idle();

  const messages = await h.ctx.chat.list(projectId, anaId);
  assert.deepEqual(messages.map((m) => [m.role, m.status]), [['user', 'done'], ['agent', 'done'], ['user', 'done'], ['agent', 'done']]);
  assert.equal(messages[1]?.text, 'feito');
  assert.equal(messages[3]?.text, 'feito (continuando)');
  assert.ok(messages[1]?.runId);

  const found = await h.ctx.chat.search(projectId, 'de novo');
  assert.equal(found.length, 1);
  assert.deepEqual(await h.ctx.chat.search(projectId, '%'), [], 'curinga é tratado como texto');
  await h.cleanup();
});

test('Chat da equipe: sem menção fala o coordenador; com menção, quem foi chamado', async () => {
  const h = await createHarness();
  const { projectId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: 'team', text: 'oi' });
  await h.ctx.chat.idle();
  await h.ctx.chat.send({ projectId, channel: 'team', text: '@Bia revise e @Ana implemente' });
  await h.ctx.chat.idle();
  const replies = (await h.ctx.chat.list(projectId, 'team')).filter((m) => m.role === 'agent');
  assert.deepEqual(replies.map((m) => m.agentName), ['Ana', 'Bia', 'Ana']);
  await h.cleanup();
});

test('Chat da equipe: "Equipe," ouve todos, com o coordenador decidindo por último', async () => {
  const h = await createHarness();
  const { projectId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: 'team', text: 'Equipe, decidam a melhor solução' });
  await h.ctx.chat.idle();
  const replies = (await h.ctx.chat.list(projectId, 'team')).filter((m) => m.role === 'agent');
  assert.deepEqual(replies.map((m) => m.agentName), ['Bia', 'Ana']);
  const prompt = fs.readFileSync(path.join(h.projectDir, 'prompt-recebido.txt'), 'utf8');
  assert.match(prompt, /Bia: feito/, 'quem fala por último vê o que os colegas disseram');
  assert.match(prompt, /apresente a decisão da equipe/);
  const runs = await h.ctx.runs.list({ projectId });
  assert.ok(runs.every((run) => run.permission === 'read'), 'análise da equipe não altera nada');
  await h.cleanup();
});

test('Chat: /missão inicia uma missão real, e mensagens orientam a que está ativa', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: 'team', text: '/missão Construir algo' });
  const [mission] = await h.ctx.orchestrator.list(projectId);
  assert.equal(mission?.goal, 'Construir algo');
  await h.ctx.orchestrator.waitForIdle(mission!.id);
  assert.equal(mission?.coordinatorId, anaId);

  await h.ctx.chat.send({ projectId, channel: 'team', text: 'Prefira nomes curtos' });
  await h.ctx.chat.idle();
  assert.deepEqual((await h.ctx.orchestrator.get(mission!.id)).notes, ['Prefira nomes curtos']);
  await h.cleanup();
});

test('Chat da equipe: quem é chamado sabe o que fez na última missão', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'Algo', coordinatorId: anaId, settings: { autoApprove: true } });
  await h.ctx.orchestrator.waitForIdle(mission.id);
  await h.ctx.chat.send({ projectId, channel: 'team', text: '@Bia o que você olhou?' });
  await h.ctx.chat.idle();
  const prompt = fs.readFileSync(path.join(h.projectDir, 'prompt-recebido.txt'), 'utf8');
  assert.match(prompt, /Missão mais recente da equipe \(completed\)/);
  assert.match(prompt, /Revisar \(Bia\): done, APROVADO/);
  assert.match(prompt, /Sem pendências/);
  await h.cleanup();
});

test('Chat: interromper a resposta encerra o processo e marca a mensagem', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: anaId, text: 'DORMIR' });
  let streaming;
  for (let i = 0; i < 200; i += 1) {
    streaming = (await h.ctx.chat.list(projectId, anaId)).find((m) => m.role === 'agent' && m.runId);
    if (streaming) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  await h.ctx.chat.cancel(streaming!.id);
  await h.ctx.chat.idle();
  const [, reply] = await h.ctx.chat.list(projectId, anaId);
  assert.equal(reply?.status, 'cancelled');
  await h.cleanup();
});

test('Chat: erro do agente vira mensagem clara', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  await h.ctx.chat.send({ projectId, channel: anaId, text: 'SEM_LOGIN' });
  await h.ctx.chat.idle();
  const [, reply] = await h.ctx.chat.list(projectId, anaId);
  assert.equal(reply?.status, 'error');
  assert.match(reply?.error ?? '', /precisa de login/);
  await h.cleanup();
});

test('Chat: resposta sem perfil vira mensagem clara', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  await h.ctx.agents.update(anaId, { profileId: null });
  await h.ctx.chat.send({ projectId, channel: anaId, text: 'oi' });
  await h.ctx.chat.idle();
  const [, reply] = await h.ctx.chat.list(projectId, anaId);
  assert.match(reply?.error ?? '', /não tem perfil/);
  await h.cleanup();
});

test('Anexos: ficam no projeto, com nome seguro, fora do Git, e chegam ao agente', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  execFileSync('git', ['init', '-q'], { cwd: h.projectDir });
  const attachment = await h.ctx.chat.upload(projectId, {
    name: '../../fora & perigoso.txt',
    content: Buffer.from('conteúdo').toString('base64'),
  });
  assert.match(attachment.path, /^\.xinoia\/attachments\//);
  assert.ok(!attachment.path.includes('..'));
  assert.equal(fs.readFileSync(path.join(h.projectDir, attachment.path), 'utf8'), 'conteúdo');
  assert.match(fs.readFileSync(path.join(h.projectDir, '.git', 'info', 'exclude'), 'utf8'), /\.xinoia\//);

  await h.ctx.chat.send({ projectId, channel: anaId, text: 'leia', attachments: [attachment] });
  await h.ctx.chat.idle();
  assert.match(fs.readFileSync(path.join(h.projectDir, 'prompt-recebido.txt'), 'utf8'), /\.xinoia\/attachments/);
  await h.cleanup();
});

test('Arquivos: não permitem sair da pasta do projeto, nem por atalho', async () => {
  const h = await createHarness();
  const { projectId } = await agents(h);
  const project = await h.ctx.projects.get(projectId);
  const call = (method: 'GET' | 'PUT', url: string, payload?: object) =>
    h.app.inject({ method, url, payload, headers: { host: '127.0.0.1', ...h.auth } });

  fs.writeFileSync(path.join(h.projectDir, 'a.txt'), 'olá');
  fs.mkdirSync(path.join(h.projectDir, 'pasta'));
  assert.deepEqual((await call('GET', `/api/projects/${projectId}/files`)).json().filter((f: { name: string }) => f.name === 'pasta' || f.name === 'a.txt').map((f: { name: string }) => f.name), ['pasta', 'a.txt']);
  assert.equal((await call('GET', `/api/projects/${projectId}/file?path=a.txt`)).json().content, 'olá');
  assert.equal((await call('PUT', `/api/projects/${projectId}/file`, { path: 'nova/b.txt', content: 'x' })).statusCode, 204);
  assert.equal(fs.readFileSync(path.join(h.projectDir, 'nova', 'b.txt'), 'utf8'), 'x');

  for (const evil of ['../fora.txt', '..\\fora.txt', 'pasta/../../fora.txt', path.resolve(h.projectDir, '..', 'fora.txt')]) {
    assert.equal((await call('GET', `/api/projects/${projectId}/file?path=${encodeURIComponent(evil)}`)).statusCode, 400, evil);
    assert.equal((await call('PUT', `/api/projects/${projectId}/file`, { path: evil, content: 'x' })).statusCode, 400, evil);
  }

  const outside = tempDir('xinoia-fora-');
  fs.writeFileSync(path.join(outside, 'segredo.txt'), 'segredo');
  fs.symlinkSync(outside, path.join(h.projectDir, 'atalho'), 'junction');
  assert.throws(() => resolveInside(project, 'atalho/segredo.txt'), /fora da pasta/);
  fs.rmSync(path.join(h.projectDir, 'atalho'), { recursive: false, force: true });
  removeDir(outside);

  fs.writeFileSync(path.join(h.projectDir, 'bin.dat'), Buffer.from([0, 1, 2, 0]));
  assert.equal((await call('GET', `/api/projects/${projectId}/file?path=bin.dat`)).json().reason, 'Arquivo binário.');
  await h.cleanup();
});

test('Painel: mostra números reais e não inventa consumo', async () => {
  const h = await createHarness();
  const { projectId, anaId } = await agents(h);
  let metrics = await h.ctx.metrics.read(projectId);
  assert.deepEqual(metrics.tokens, { input: 0, output: 0, runsWithData: 0 });
  assert.equal(metrics.averageRunMs, null);

  await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId: anaId, projectId, prompt: 'oi' })).id);
  await h.ctx.runs.waitFor((await h.ctx.runs.create({ agentId: anaId, projectId, prompt: 'QUEBRAR' })).id);
  metrics = await h.ctx.metrics.read(projectId);
  assert.equal(metrics.runs.completed, 1);
  assert.equal(metrics.runs.failed, 1);
  assert.deepEqual(metrics.tokens, { input: 10, output: 5, runsWithData: 1 });
  assert.ok(metrics.averageRunMs !== null);
  assert.ok(metrics.system.memoryTotal > 0);
  const timeline = await h.ctx.metrics.timeline(projectId);
  assert.equal(timeline.length, 2);
  await h.cleanup();
});

test('Terminal real por PTY: entrada, saída, histórico ao conectar e encerramento', async () => {
  const h = await createHarness();
  const { projectId } = await agents(h);
  const address = await h.app.listen({ host: '127.0.0.1', port: 0 });
  const info = await h.ctx.terminals.create({ kind: 'shell', projectId });
  const socket = new WebSocket(`${address.replace('http', 'ws')}/ws/terminal/${info.id}?token=${h.token}`);
  let output = '';
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as { type: string; data?: string };
    if (message.type === 'data') output += message.data;
  });
  await new Promise((resolve) => socket.once('open', resolve));
  socket.send(JSON.stringify({ type: 'resize', cols: 120, rows: 30 }));
  socket.send(JSON.stringify({ type: 'input', data: 'echo marca-do-pty\r' }));
  for (let i = 0; i < 300 && !/marca-do-pty[\s\S]*marca-do-pty/.test(output); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.match(output, /marca-do-pty[\s\S]*marca-do-pty/, 'comando foi executado de verdade');
  assert.deepEqual(h.ctx.terminals.list().map((t) => t.id), [info.id]);
  assert.ok(h.ctx.terminals.get(info.id).scrollback().includes('marca-do-pty'));
  h.ctx.terminals.kill(info.id);
  for (let i = 0; i < 100 && h.ctx.terminals.list().length; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(h.ctx.terminals.list(), [], 'o terminal foi encerrado');
  socket.close();
  await h.cleanup();
});

test('Interface: arquivos são públicos, sem expor o token, e não saem da pasta', async () => {
  const web = tempDir('xinoia-web-');
  fs.writeFileSync(path.join(web, 'index.html'), '<title>XinoIA</title>');
  fs.mkdirSync(path.join(web, 'assets'));
  fs.writeFileSync(path.join(web, 'assets', 'a.js'), 'x');
  const dataDir = tempDir();
  const { createApp } = await import('../src/app.ts');
  const { createConfig } = await import('../src/config.ts');
  const { app, token } = await createApp({ config: createConfig({ dataDir }), logToFile: false, token: 't0ken-secreto', webDir: web });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: '127.0.0.1' } });

  const home = await get('/');
  assert.equal(home.statusCode, 200);
  assert.ok(!home.body.includes(token));
  assert.match(String(home.headers['content-security-policy']), /script-src 'self'/);
  assert.equal((await get('/assets/a.js')).statusCode, 200);
  assert.equal((await get('/alguma/rota')).body, '<title>XinoIA</title>');
  assert.equal((await get('/assets/falta.js')).statusCode, 404);
  assert.notEqual((await get('/%2e%2e/%2e%2e/package.json')).body.includes('"name"'), true);
  assert.equal((await get('/api/agents')).statusCode, 401, 'a API continua protegida');
  await app.close();
  removeDir(web);
  removeDir(dataDir);
});
