import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { GoalQueue } from '@xinoia/shared';
import { createHarness, removeDir, tempDir, type Harness } from './support/harness.ts';

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

async function queueFor(h: Harness, settings: { onFailure?: 'stop' | 'skip'; tokenLimit?: number | null } = {}) {
  const { projectId } = await h.setup('Ana');
  const workflow = await h.ctx.workflows.create({
    name: 'Um passo',
    nodes: [{ id: 'fazer', title: 'Fazer', role: 'developer', description: 'faça', maxAttempts: 1 }],
    edges: [],
  });
  await h.ctx.queues.save(projectId, { workflowId: workflow.id, ...settings });
  return { projectId, workflowId: workflow.id };
}

/** Espera a fila parar de iniciar objetivos, ou o objetivo atual esperar por alguém. */
async function settled(h: Harness, projectId: string): Promise<GoalQueue> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const queue = (await h.ctx.queues.get(projectId))!;
    const current = queue.items.find((item) => item.status === 'running');
    if (!current && !queue.running) return queue;
    if (current?.missionId) {
      const mission = await h.db().missions.get(current.missionId);
      if (mission && ['paused', 'awaiting_approval'].includes(mission.status)) {
        // A fila reage à missão logo depois: só vale se ela continuar esperando.
        await new Promise((resolve) => setTimeout(resolve, 150));
        const again = (await h.ctx.queues.get(projectId))!;
        if (again.items.find((item) => item.status === 'running')?.missionId === current.missionId) return again;
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('A fila não assentou a tempo.');
}

const statuses = (queue: GoalQueue) => queue.items.map((item) => `${item.goal}:${item.status}`);

test('Fila: inicia cada objetivo em ordem, sozinha, e soma o consumo informado', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h);
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo', 'terceiro'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['primeiro:done', 'segundo:done', 'terceiro:done']);
  assert.equal(queue.running, false);
  assert.equal(queue.stopReason, null);
  const missions = await h.ctx.orchestrator.list(projectId);
  assert.equal(missions.length, 3, 'cada objetivo teve uma missão, sem repetir');
  assert.deepEqual(missions.map((mission) => mission.goal).sort(), ['primeiro', 'segundo', 'terceiro']);
  assert.ok(missions.every((mission) => mission.settings.concurrency === 1));
  // Uma tarefa e o relatório: duas execuções do CLI falso, 10 de entrada e 5 de saída em cada.
  assert.equal(queue.items[0]?.inputTokens, 20);
  assert.equal(queue.items[0]?.outputTokens, 10);
  assert.equal(queue.items[0]?.runsWithoutUsage, 0);
  await h.cleanup();
});

test('Fila: falha com a política de parar não inicia o próximo, e a missão espera a pessoa', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h, { onFailure: 'stop' });
  await h.ctx.queues.addItems(projectId, { goals: ['FALHAR_SEMPRE', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['FALHAR_SEMPRE:running', 'depois:pending']);
  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(mission.status, 'paused');

  // Cancelar a missão é uma decisão da pessoa: a fila para e diz por quê.
  await h.ctx.orchestrator.cancel(mission.id);
  const stopped = await settled(h, projectId);
  assert.deepEqual(statuses(stopped), ['FALHAR_SEMPRE:failed', 'depois:pending']);
  assert.equal(stopped.items[0]?.reason, 'A missão foi cancelada.');
  assert.match(stopped.stopReason ?? '', /cancelado/);
  assert.equal((await h.ctx.orchestrator.list(projectId)).length, 1);
  await h.cleanup();
});

test('Fila: quando a pessoa resolve a missão parada, a fila continua sozinha', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h, { onFailure: 'stop' });
  await h.ctx.queues.addItems(projectId, { goals: ['FALHAR_SEMPRE', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);
  const missionId = queue.items[0]!.missionId!;

  const [task] = await h.ctx.orchestrator.tasks(missionId);
  await h.ctx.orchestrator.skipTask(missionId, task!.id);
  const after = await settled(h, projectId);
  assert.deepEqual(statuses(after), ['FALHAR_SEMPRE:done', 'depois:done']);
  await h.cleanup();
});

test('Fila: a política de pular registra a falha e segue para o próximo', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h, { onFailure: 'skip' });
  await h.ctx.queues.addItems(projectId, { goals: ['FALHAR_SEMPRE', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['FALHAR_SEMPRE:failed', 'depois:done']);
  assert.match(queue.items[0]?.reason ?? '', /falhou depois de 1 tentativas/);
  assert.equal(queue.stopReason, null);
  const failed = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(failed.status, 'cancelled');
  await h.cleanup();
});

test('Fila: limite da conta nunca é pulado, porque o próximo objetivo bateria no mesmo problema', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h, { onFailure: 'skip' });
  await h.ctx.queues.addItems(projectId, { goals: ['LIMITE', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['LIMITE:running', 'depois:pending']);
  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(mission.status, 'paused');
  assert.match(mission.pauseReason ?? '', /limite de uso/);
  await h.cleanup();
});

test('Fila: limite de gasto para antes do próximo objetivo e libera ao ser aumentado', async () => {
  const h = await createHarness();
  const { projectId, workflowId } = await queueFor(h, { tokenLimit: 30 });
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['primeiro:done', 'segundo:pending']);
  assert.match(queue.stopReason ?? '', /Limite de gasto atingido: 30 de 30/);

  await h.ctx.queues.save(projectId, { workflowId, tokenLimit: 1000 });
  await h.ctx.queues.start(projectId);
  assert.deepEqual(statuses(await settled(h, projectId)), ['primeiro:done', 'segundo:done']);
  await h.cleanup();
});

test('Fila: sem consumo informado, o limite não é aplicado às cegas e a tela recebe o motivo', async () => {
  const h = await createHarness();
  const { projectId, workflowId } = await queueFor(h, { tokenLimit: 1000 });
  await h.ctx.queues.addItems(projectId, { goals: ['SEM_CONSUMO', 'segundo'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(statuses(queue), ['SEM_CONSUMO:done', 'segundo:pending']);
  assert.ok((queue.items[0]?.runsWithoutUsage ?? 0) > 0);
  assert.equal(queue.items[0]?.inputTokens, 0);
  assert.match(queue.stopReason ?? '', /não pôde ser aplicado/);

  // Sem limite, a mesma fila segue, e o consumo desconhecido continua indicado.
  await h.ctx.queues.save(projectId, { workflowId, tokenLimit: null });
  await h.ctx.queues.start(projectId);
  assert.deepEqual(statuses(await settled(h, projectId)), ['SEM_CONSUMO:done', 'segundo:done']);
  await h.cleanup();
});

test('Fila: não inicia objetivo com o Git sujo, e continua depois do commit', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h);
  sh(h.projectDir, 'init', '-q', '-b', 'main');
  sh(h.projectDir, 'config', 'user.name', 'Teste');
  sh(h.projectDir, 'config', 'user.email', 'teste@example.com');
  fs.writeFileSync(path.join(h.projectDir, 'base.txt'), 'x');
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo'] });

  await h.ctx.queues.start(projectId);
  const dirty = await settled(h, projectId);
  assert.deepEqual(statuses(dirty), ['primeiro:pending', 'segundo:pending']);
  assert.match(dirty.stopReason ?? '', /1 arquivo\(s\) sem commit no projeto \(base\.txt\)/);
  assert.equal((await h.ctx.orchestrator.list(projectId)).length, 0);

  sh(h.projectDir, 'add', '-A');
  sh(h.projectDir, 'commit', '-q', '-m', 'inicial');
  await h.ctx.queues.start(projectId);
  // O CLI falso escreve um arquivo em cada tarefa, então o segundo objetivo encontra o projeto sujo.
  const afterFirst = await settled(h, projectId);
  assert.deepEqual(statuses(afterFirst), ['primeiro:done', 'segundo:pending']);
  assert.match(afterFirst.stopReason ?? '', /contexto\.txt/);

  sh(h.projectDir, 'add', '-A');
  sh(h.projectDir, 'commit', '-q', '-m', 'primeiro');
  await h.ctx.queues.start(projectId);
  assert.deepEqual(statuses(await settled(h, projectId)), ['primeiro:done', 'segundo:done']);
  await h.cleanup();
});

test('Fila: fora do modo autônomo, cada objetivo espera a aprovação do plano', async () => {
  const h = await createHarness();
  await h.ctx.settings.update({ executionMode: 'semi' });
  const { projectId } = await queueFor(h);
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo'] });
  await h.ctx.queues.start(projectId);

  const waiting = await settled(h, projectId);
  assert.deepEqual(statuses(waiting), ['primeiro:running', 'segundo:pending']);
  const first = await h.ctx.orchestrator.get(waiting.items[0]!.missionId!);
  assert.equal(first.status, 'awaiting_approval');
  assert.equal(first.settings.autoApprove, false);

  await h.ctx.orchestrator.approve(first.id);
  await h.ctx.orchestrator.waitForIdle(first.id);
  const next = await settled(h, projectId);
  assert.deepEqual(statuses(next), ['primeiro:done', 'segundo:running']);
  assert.equal((await h.ctx.orchestrator.get(next.items[1]!.missionId!)).status, 'awaiting_approval');
  await h.cleanup();
});

test('Fila: editar, remover, reordenar e recolocar só mexem no que pode mudar', async () => {
  const h = await createHarness();
  const { projectId } = await queueFor(h, { onFailure: 'skip' });
  await h.ctx.queues.addItems(projectId, { goals: ['FALHAR_SEMPRE', 'b', 'c', 'd'] });
  let queue = (await h.ctx.queues.get(projectId))!;
  const [a, b, c, d] = queue.items;

  await h.ctx.queues.updateItem(projectId, b!.id, { goal: 'b editado' });
  await h.ctx.queues.removeItem(projectId, c!.id);
  queue = await h.ctx.queues.reorder(projectId, { itemIds: [d!.id, b!.id, a!.id] });
  assert.deepEqual(queue.items.map((item) => item.goal), ['d', 'b editado', 'FALHAR_SEMPRE']);
  await assert.rejects(h.ctx.queues.reorder(projectId, { itemIds: [d!.id] }), /A lista mudou/);

  await h.ctx.queues.start(projectId);
  queue = await settled(h, projectId);
  assert.deepEqual(statuses(queue), ['d:done', 'b editado:done', 'FALHAR_SEMPRE:failed']);
  await assert.rejects(h.ctx.queues.updateItem(projectId, a!.id, { goal: 'x' }), /ainda não começou/);
  await assert.rejects(h.ctx.queues.reorder(projectId, { itemIds: [a!.id] }), /A lista mudou/);

  // O objetivo volta para a fila, e o que ele já gastou continua contando.
  const spent = queue.items[2]!.inputTokens;
  queue = await h.ctx.queues.requeue(projectId, a!.id);
  assert.equal(queue.items[2]?.status, 'pending');
  assert.equal(queue.items[2]?.inputTokens, spent);
  queue = await h.ctx.queues.clearFinished(projectId);
  assert.deepEqual(statuses(queue), ['FALHAR_SEMPRE:pending']);
  await h.cleanup();
});

test('Fila: parar não inicia mais nada e deixa o objetivo atual terminar', async () => {
  const h = await createHarness();
  await h.ctx.settings.update({ executionMode: 'semi' });
  const { projectId } = await queueFor(h);
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo'] });
  await h.ctx.queues.start(projectId);
  const waiting = await settled(h, projectId);
  const missionId = waiting.items[0]!.missionId!;

  await h.ctx.queues.stop(projectId);
  await h.ctx.orchestrator.approve(missionId);
  await h.ctx.orchestrator.waitForIdle(missionId);
  const queue = await settled(h, projectId);
  assert.deepEqual(statuses(queue), ['primeiro:done', 'segundo:pending']);
  assert.equal(queue.running, false);
  assert.equal((await h.ctx.orchestrator.list(projectId)).length, 1);
  await h.cleanup();
});

test('Fila: outra missão ativa ou workflow apagado param a fila com o motivo', async () => {
  const h = await createHarness();
  await h.ctx.settings.update({ executionMode: 'semi' });
  const { projectId, workflowId } = await queueFor(h);
  await h.ctx.queues.addItems(projectId, { goals: ['primeiro'] });

  const manual = await h.ctx.workflows.run(workflowId, { projectId, goal: 'manual' });
  let queue = await h.ctx.queues.start(projectId);
  assert.equal(queue.running, false);
  assert.match(queue.stopReason ?? '', /já tem uma missão em andamento/);
  assert.deepEqual(statuses(queue), ['primeiro:pending']);
  assert.equal(queue.items[0]?.missionId, null);
  await h.ctx.orchestrator.cancel(manual.id);

  await h.ctx.workflows.remove(workflowId);
  queue = await h.ctx.queues.start(projectId);
  assert.match(queue.stopReason ?? '', /Workflow não encontrado/);
  await h.cleanup();
});

test('Fila: ao reabrir o app nada começa sozinho e nenhum objetivo roda duas vezes', async () => {
  const dataDir = tempDir();
  const first = await createHarness({ dataDir, keep: true });
  await first.ctx.settings.update({ executionMode: 'semi' });
  const { projectId } = await queueFor(first);
  await first.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo', 'terceiro'] });
  await first.ctx.queues.start(projectId);
  const waiting = await settled(first, projectId);
  const missionId = waiting.items[0]!.missionId!;
  await first.app.close();

  // A missão continua esperando a pessoa ao reabrir, e a fila espera por ela sem começar mais nada.
  const second = await createHarness({ dataDir, keep: true });
  assert.equal((await second.ctx.queues.get(projectId))?.running, true);
  assert.equal((await second.ctx.orchestrator.get(missionId)).status, 'awaiting_approval');
  assert.equal((await second.ctx.orchestrator.list(projectId)).length, 1);
  await second.app.close();

  // Um ID gravado cuja missão nunca chegou a existir: o objetivo volta para a fila.
  const third = await createHarness({ dataDir, keep: true });
  const saved = (await third.ctx.queues.get(projectId))!;
  const current = saved.items.find((item) => item.status === 'running')!;
  current.missionId = 'mission_que_nunca_existiu';
  await third.db().queues.save(saved);
  await third.app.close();

  const fourth = await createHarness({ dataDir, keep: true });
  const recovered = (await fourth.ctx.queues.get(projectId))!;
  assert.equal(recovered.running, false);
  assert.match(recovered.stopReason ?? '', /foi fechado com a fila em andamento/);
  assert.equal(recovered.items.find((item) => item.id === current.id)?.status, 'pending');
  assert.equal(recovered.items.find((item) => item.id === current.id)?.missionId, null);
  assert.equal((await fourth.ctx.orchestrator.list(projectId)).length, 1, 'nenhuma missão nova');
  await fourth.app.close();
  removeDir(dataDir);
  for (const harness of [first, second, third, fourth]) removeDir(harness.projectDir);
});

test('Fila: a missão terminada com o app fechado é registrada, sem iniciar a próxima', async () => {
  const dataDir = tempDir();
  const first = await createHarness({ dataDir, keep: true });
  await first.ctx.settings.update({ executionMode: 'semi' });
  const { projectId } = await queueFor(first);
  await first.ctx.queues.addItems(projectId, { goals: ['primeiro', 'segundo'] });
  await first.ctx.queues.start(projectId);
  const waiting = await settled(first, projectId);
  const missionId = waiting.items[0]!.missionId!;
  // O app fecha entre o fim da missão e a reação da fila.
  first.ctx.orchestrator.onMissionStopped = null;
  await first.ctx.orchestrator.approve(missionId);
  await first.ctx.orchestrator.waitForIdle(missionId);
  await first.app.close();

  const second = await createHarness({ dataDir, keep: true });
  const queue = (await second.ctx.queues.get(projectId))!;
  assert.deepEqual(statuses(queue), ['primeiro:done', 'segundo:pending']);
  assert.equal(queue.items[0]?.inputTokens, 20);
  assert.equal(queue.running, false);
  assert.equal((await second.ctx.orchestrator.list(projectId)).length, 1);
  await second.app.close();
  removeDir(dataDir);
  for (const harness of [first, second]) removeDir(harness.projectDir);
});

test('Fila: as rotas exigem o token e devolvem a fila salva', async () => {
  const h = await createHarness();
  const { projectId } = await h.setup('Ana');
  const url = `/api/projects/${projectId}/queue`;
  assert.equal((await h.app.inject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await h.app.inject({ method: 'GET', url, headers: h.auth })).statusCode, 200);

  const [workflow] = await h.ctx.workflows.list();
  const saved = await h.app.inject({ method: 'PUT', url, headers: h.auth, payload: { workflowId: workflow!.id, tokenLimit: 500 } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json<GoalQueue>().tokenLimit, 500);
  const refused = await h.app.inject({ method: 'PUT', url, headers: h.auth, payload: { workflowId: 'nao-existe' } });
  assert.equal(refused.statusCode, 404);

  const added = await h.app.inject({ method: 'POST', url: `${url}/items`, headers: h.auth, payload: { goals: ['Use a chave sk-ant-abcdefghijklmnopqrstuvwxyz123456'] } });
  assert.equal(added.statusCode, 200);
  assert.doesNotMatch(added.json<GoalQueue>().items[0]!.goal, /abcdefghijklmnop/, 'segredo não fica na fila');
  await h.cleanup();
});
