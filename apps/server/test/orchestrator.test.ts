import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Agent, ServerMessage, Task } from '@xinoia/shared';
import {
  addFixRound,
  buildTasks,
  extractHandoff,
  extractJsonPlan,
  extractVerdict,
  findCycle,
  findFixerId,
  readyTasks,
} from '../src/services/planning.ts';
import { createHarness, removeDir, tempDir, type Harness } from './support/harness.ts';

const agent = (id: string, role: Agent['role'] = 'developer', name = id): Agent => ({
  id,
  name,
  role,
  roleTitle: null,
  instructions: null,
  provider: 'fake',
  profileId: 'p',
  model: null,
  effort: null,
  permission: 'edit',
  color: '#000000',
  toolkitIds: [],
  createdAt: 0,
});

test('Plano: extrai JSON de cercas de código e de texto solto', () => {
  assert.equal(extractJsonPlan('oi\n```json\n{"tasks":[1]}\n```')?.tasks.length, 1);
  assert.equal(extractJsonPlan('plano: {"tasks":[1,2]} fim')?.tasks.length, 2);
  // Vale o último bloco válido, porque o agente pode citar exemplos antes.
  assert.equal(extractJsonPlan('```json\n{"tasks":[1]}\n```\n```json\n{"tasks":[1,2,3]}\n```')?.tasks.length, 3);
  assert.equal(extractJsonPlan('sem json'), null);
  assert.equal(extractJsonPlan('{"outra":1}'), null);
});

test('Plano: detecta dependência circular', () => {
  assert.deepEqual(findCycle([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])?.sort(), ['a', 'b']);
  assert.equal(findCycle([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }]), null);
});

test('Plano: valida responsável, tarefas e dependências', () => {
  const team = [agent('a1', 'developer', 'Ana'), agent('a2', 'reviewer', 'Bia')];
  const tasks = buildTasks('m', [
    { id: 'x', title: 'Fazer', assignee: 'ana' },
    { id: 'y', title: 'Olhar', assignee: 'a2', dependsOn: ['x', 'inexistente', 'y'] },
  ], team);
  assert.equal(tasks[0]?.assigneeName, 'Ana');
  assert.deepEqual(tasks[1]?.dependsOn, [tasks[0]?.id]);
  assert.equal(tasks[1]?.type, 'review', 'tarefa de revisor sempre devolve veredito');
  assert.throws(() => buildTasks('m', [], team), /não tem tarefas/);
  assert.throws(() => buildTasks('m', [{ title: 'x', assignee: 'ninguem' }], team), /quem não está na equipe/);
  assert.throws(() => buildTasks('m', [{ assignee: 'a1' }], team), /inválida/);
  assert.throws(() => buildTasks('m', [{ id: 'a', title: 'x', assignee: 'a1' }, { id: 'a', title: 'y', assignee: 'a1' }], team), /repetida/);
  assert.throws(() => buildTasks('m', [
    { id: 'a', title: 'x', assignee: 'a1', dependsOn: ['b'] },
    { id: 'b', title: 'y', assignee: 'a1', dependsOn: ['a'] },
  ], team), /círculo/);
});

test('Plano: prontas respeitam dependência e prioridade', () => {
  const team = [agent('a1')];
  const tasks = buildTasks('m', [
    { id: 'a', title: 'a', assignee: 'a1', priority: 3 },
    { id: 'b', title: 'b', assignee: 'a1', priority: 1 },
    { id: 'c', title: 'c', assignee: 'a1', dependsOn: ['a'] },
  ], team);
  assert.deepEqual(readyTasks(tasks).map((t) => t.title), ['b', 'a']);
  tasks[0]!.status = 'skipped';
  assert.ok(readyTasks(tasks).some((t) => t.title === 'c'));
});

test('Veredito e handoff: leitura e casos sem marcação', () => {
  assert.equal(extractVerdict('x <verdict> aprovado </verdict>'), 'APROVADO');
  assert.equal(extractVerdict('<verdict>APROVADO</verdict> depois <verdict>REPROVADO</verdict>'), 'REPROVADO');
  assert.equal(extractVerdict('parece bom'), null);
  assert.equal(extractHandoff('longo\n<handoff> resumo </handoff>'), 'resumo');
  assert.equal(extractHandoff('sem marcação'), 'sem marcação');
});

test('Reprovação: correção volta para o autor e o resto passa a depender da nova revisão', () => {
  const team = [agent('dev'), agent('rev', 'reviewer')];
  const tasks: Task[] = buildTasks('m', [
    { id: 'w', title: 'Fazer', assignee: 'dev' },
    { id: 'r', title: 'Revisar', assignee: 'rev', dependsOn: ['w'] },
    { id: 'd', title: 'Depois', assignee: 'dev', dependsOn: ['r'] },
  ], team);
  const [work, review, next] = tasks as [Task, Task, Task];
  assert.equal(findFixerId(tasks, review), 'dev');
  const { fix, recheck, changed } = addFixRound(tasks, review, team[0]!);
  assert.equal(fix.assigneeId, 'dev');
  assert.equal(fix.isFix, true);
  assert.deepEqual(fix.dependsOn, [review.id]);
  assert.equal(recheck.assigneeId, 'rev');
  assert.deepEqual(recheck.dependsOn, [fix.id]);
  assert.deepEqual(next.dependsOn, [recheck.id]);
  assert.deepEqual(changed, [next]);
  assert.ok(work.position < review.position && review.position < fix.position && fix.position < recheck.position && recheck.position < next.position);

  // Títulos não acumulam prefixos a cada rodada.
  recheck.round = 1;
  const second = addFixRound([...tasks, fix, recheck], recheck, team[0]!);
  assert.equal(second.fix.title, 'Corrigir: Revisar');
  assert.equal(second.recheck.title, 'Revisar de novo: Revisar');
  assert.ok(second.fix.position < next.position);
});

async function team(h: Harness) {
  const dev = await h.setup('Ana');
  const reviewerProfile = await h.ctx.profiles.create({ provider: 'fake', label: 'Revisão' });
  const reviewer = await h.ctx.agents.create({ name: 'Bia', role: 'reviewer', provider: 'fake', profileId: reviewerProfile.id });
  return { projectId: dev.projectId, devId: dev.agentId, reviewerId: reviewer.id };
}

const statuses = (tasks: Task[]) => tasks.map((task) => `${task.title}:${task.status}`);

test('Missão: plano, aprovação, trabalho, revisão, handoff e relatório', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const messages: ServerMessage[] = [];
  h.ctx.hub.subscribe((message) => messages.push(message));

  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'Criar algo', coordinatorId: devId });
  let state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'awaiting_approval', state.pauseReason ?? '');
  assert.equal(state.planSummary, 'Plano de teste');
  let tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(tasks.length, 3);
  assert.ok(tasks.every((task) => task.status === 'pending'), 'nada roda antes da aprovação');
  assert.ok(!fs.existsSync(path.join(h.projectDir, 'entrega.txt')));

  await h.ctx.orchestrator.approve(mission.id);
  state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.deepEqual(statuses(tasks), ['Implementar:done', 'Revisar:done', 'Documentar:done']);
  assert.equal(tasks[1]?.verdict, 'APROVADO');
  assert.ok(tasks.every((task) => task.startedAt && task.endedAt && task.attempts === 1));

  // Quem vem depois recebe o que o anterior entregou, sem ninguém copiar nada.
  const context = fs.readFileSync(path.join(h.projectDir, 'contexto.txt'), 'utf8');
  assert.match(context, /Entregas que você recebeu dos colegas[\s\S]*Sem pendências\./);

  const events = await h.ctx.orchestrator.events(mission.id);
  const handoffs = events.flatMap((event) => (event.data.type === 'handoff' ? [event.data] : []));
  assert.ok(handoffs.some((item) => item.fromAgentName === 'Ana' && item.toAgentName === 'Bia'));
  assert.ok(handoffs.some((item) => item.fromAgentName === 'Bia' && item.toAgentName === 'Ana'));
  assert.ok(events.some((event) => event.data.type === 'review' && event.data.verdict === 'APROVADO'));

  assert.match(state.report ?? '', /Relatório: tudo entregue/);
  assert.match(state.report ?? '', /Tarefas concluídas: 3 de 3/);
  assert.ok(state.startedAt && state.endedAt);

  // Cada execução fica ligada à sua tarefa, com os logs dela.
  const runs = await h.ctx.runs.list({ projectId });
  assert.ok(runs.filter((run) => run.taskId).length === 3);
  assert.ok(runs.every((run) => run.missionId === mission.id));

  assert.ok(messages.some((message) => message.kind === 'mission_updated'));
  assert.ok(messages.some((message) => message.kind === 'task_updated'));
  await h.cleanup();
});

test('Missão: o planejamento é só leitura, mesmo com agente que pode editar', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await h.ctx.orchestrator.waitForIdle(mission.id);
  const [run] = await h.ctx.runs.list({ projectId });
  assert.equal(run?.permission, 'read');
  assert.match(run?.command ?? '', /dontAsk/);
  await h.cleanup();
});

test('Missão: reprovação volta para correção, e nada segue antes de aprovar', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'REPROVAR_UMA_VEZ',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.deepEqual(statuses(tasks), [
    'Implementar:done',
    'Revisar:done',
    'Corrigir: Revisar:done',
    'Revisar de novo: Revisar:done',
    'Documentar:done',
  ]);
  assert.equal(tasks[1]?.verdict, 'REPROVADO');
  assert.equal(tasks[2]?.assigneeName, 'Ana');
  assert.equal(tasks[3]?.verdict, 'APROVADO');

  const context = fs.readFileSync(path.join(h.projectDir, 'contexto.txt'), 'utf8');
  assert.match(context, /Faltou tratar lista vazia/, 'quem corrige recebe o motivo da reprovação');
  const events = await h.ctx.orchestrator.events(mission.id);
  assert.ok(events.some((event) => event.data.type === 'fix_requested' && event.data.round === 1));
  await h.cleanup();
});

test('Missão: reprovações além do limite pausam e pedem decisão; pular conclui', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'REPROVAR_SEMPRE',
    coordinatorId: devId,
    settings: { autoApprove: true, maxReviewRounds: 1 },
  });
  let state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'paused');
  assert.match(state.pauseReason ?? '', /reprovada 2 vezes/);
  let tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(tasks.find((task) => task.title === 'Documentar')?.status, 'pending', 'não seguiu sem aprovação');

  // A última revisão foi reprovada. O usuário decide seguir mesmo assim: pula a etapa.
  const blocked = tasks.find((task) => task.title === 'Documentar')!;
  await h.ctx.orchestrator.skipTask(mission.id, blocked.id);
  state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed');
  tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(tasks.find((task) => task.title === 'Documentar')?.status, 'skipped');
  await h.cleanup();
});

test('Missão: revisão sem veredito não passa como aprovada', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'SEM_VEREDITO',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'paused');
  assert.match(state.pauseReason ?? '', /sem um veredito/);
  await h.cleanup();
});

test('Missão: erro passageiro é tentado de novo sozinho', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x ORDEM_DEV=FALHAR_UMA_VEZ',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const [first] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(first?.attempts, 2);
  const events = await h.ctx.orchestrator.events(mission.id);
  assert.ok(events.some((event) => event.data.type === 'retry'));
  await h.cleanup();
});

test('Missão: falha permanente pausa; tentar de novo e reatribuir funcionam', async () => {
  const h = await createHarness();
  const { projectId, devId, reviewerId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x ORDEM_DEV=FALHAR_SEMPRE',
    coordinatorId: devId,
    settings: { autoApprove: true, maxAttempts: 2 },
  });
  let state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'paused');
  assert.match(state.pauseReason ?? '', /falhou depois de 2 tentativas/);
  let [first] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(first?.status, 'failed');
  assert.match(first?.errorText ?? '', /erro permanente/);

  await h.ctx.orchestrator.reassignTask(mission.id, first!.id, reviewerId);
  [first] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(first?.assigneeName, 'Bia');
  assert.equal(first?.status, 'pending');
  await h.cleanup();
});

test('Missão: limite de conta pausa sem insistir e nunca troca de conta sozinha', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x ORDEM_DEV=LIMITE',
    coordinatorId: devId,
    settings: { autoApprove: true, fallbackToOtherProvider: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'paused');
  assert.match(state.pauseReason ?? '', /limite de uso/);
  const [first] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(first?.attempts, 1, 'não insistiu');
  assert.equal(first?.assigneeName, 'Ana', 'todos são do mesmo provedor, então não houve troca');
  await h.cleanup();
});

test('Missão: tarefas independentes rodam em paralelo de verdade', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'PLANO_PARALELO',
    coordinatorId: devId,
    settings: { autoApprove: true, concurrency: 2 },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  // As duas partes usam o encontro do CLI de teste: só terminam vendo a outra rodar.
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.ok(tasks.every((task) => task.status === 'done'));
  const [a, b, join] = tasks as [Task, Task, Task];
  assert.ok(join.startedAt! >= Math.max(a.endedAt!, b.endedAt!), 'a junção espera as duas');
  await h.cleanup();
});

test('Missão: plano com erro de formato ganha uma segunda chance', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const fixed = await h.ctx.orchestrator.start({ projectId, goal: 'PLANO_RUIM', coordinatorId: devId });
  assert.equal((await h.ctx.orchestrator.waitForIdle(fixed.id)).status, 'awaiting_approval');
  await h.ctx.orchestrator.cancel(fixed.id);

  const broken = await h.ctx.orchestrator.start({ projectId, goal: 'PLANO_SEMPRE_RUIM', coordinatorId: devId });
  const state = await h.ctx.orchestrator.waitForIdle(broken.id);
  assert.equal(state.status, 'failed');
  assert.match(state.pauseReason ?? '', /formato inválido/);
  await h.cleanup();
});

test('Missão: falha do coordenador termina com o motivo', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'PLANO_FALHA', coordinatorId: devId });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'failed');
  assert.match(state.pauseReason ?? '', /falha no planejamento/);
  await h.cleanup();
});

test('Missão: relatório do coordenador falhar não invalida a missão', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'RELATORIO_FALHA',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed');
  assert.match(state.report ?? '', /Tarefas concluídas: 3 de 3/);
  await h.cleanup();
});

test('Missão: o usuário pode editar o plano antes de aprovar', async () => {
  const h = await createHarness();
  const { projectId, devId, reviewerId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await h.ctx.orchestrator.waitForIdle(mission.id);

  await assert.rejects(h.ctx.orchestrator.approve(mission.id, { tasks: [{ title: 'x', assignee: 'ninguem' }] }), /quem não está na equipe/);
  await h.ctx.orchestrator.approve(mission.id, {
    tasks: [
      { id: 'a', title: 'Só isto', assignee: devId },
      { id: 'b', title: 'E revisar', assignee: reviewerId, dependsOn: ['a'] },
    ],
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed');
  assert.deepEqual(statuses(await h.ctx.orchestrator.tasks(mission.id)), ['Só isto:done', 'E revisar:done']);
  await h.cleanup();
});

test('Missão: refazer o plano com orientação do usuário', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await h.ctx.orchestrator.waitForIdle(mission.id);
  await h.ctx.orchestrator.replan(mission.id, 'Use outra abordagem');
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'awaiting_approval');
  const [latest] = await h.ctx.runs.list({ projectId });
  assert.match(latest?.prompt ?? '', /Use outra abordagem/);
  await h.cleanup();
});

test('Missão em modo sequência: a ordem é a escolhida pelo usuário', async () => {
  const h = await createHarness();
  const { projectId, devId, reviewerId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x',
    mode: 'pipeline',
    agentIds: [devId, reviewerId],
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.deepEqual(tasks.map((task) => task.assigneeName), ['Ana', 'Bia']);
  assert.equal(tasks[1]?.type, 'review');
  await h.cleanup();
});

test('Missão: pausar deixa terminar o que está rodando e retomar continua', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x ORDEM_DEV=ESPERAR_POUCO',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  for (let i = 0; i < 200; i += 1) {
    if ((await h.ctx.orchestrator.get(mission.id)).status === 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await h.ctx.orchestrator.pause(mission.id);
  let state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'paused');
  const tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.ok(tasks.some((task) => task.status === 'pending'), 'não começou o resto');

  await h.ctx.orchestrator.resume(mission.id);
  state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  await h.cleanup();
});

test('Missão: cancelar encerra o processo e as tarefas pendentes', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x ORDEM_DEV=DORMIR',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  for (let i = 0; i < 400; i += 1) {
    const tasks = await h.ctx.orchestrator.tasks(mission.id);
    if (tasks.some((task) => task.status === 'running')) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const started = Date.now();
  await h.ctx.orchestrator.cancel(mission.id);
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'cancelled');
  assert.ok(Date.now() - started < 15_000, 'não esperou o agente terminar');
  const tasks = await h.ctx.orchestrator.tasks(mission.id);
  assert.ok(tasks.every((task) => task.status === 'cancelled'), statuses(tasks).join(', '));
  await assert.rejects(h.ctx.orchestrator.cancel(mission.id), /já terminou/);
  await h.cleanup();
});

test('Missão: uma orientação durante a execução chega às próximas tarefas', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await h.ctx.orchestrator.waitForIdle(mission.id);
  await h.ctx.orchestrator.addNote(mission.id, 'Use nomes em português');
  await h.ctx.orchestrator.approve(mission.id);
  await h.ctx.orchestrator.waitForIdle(mission.id);
  const context = fs.readFileSync(path.join(h.projectDir, 'contexto.txt'), 'utf8');
  assert.match(context, /Orientações do usuário[\s\S]*Use nomes em português/);
  await h.cleanup();
});

test('Missão: só uma por projeto ao mesmo tempo', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const mission = await h.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await assert.rejects(h.ctx.orchestrator.start({ projectId, goal: 'y' }), /já tem uma missão/);
  await h.ctx.orchestrator.waitForIdle(mission.id);
  await h.cleanup();
});

test('Fechar e reabrir no meio da missão: nada se perde e dá para retomar', async () => {
  const dataDir = tempDir();
  const first = await createHarness({ dataDir, keep: true });
  const { projectId, devId } = await team(first);
  const mission = await first.ctx.orchestrator.start({ projectId, goal: 'x', coordinatorId: devId });
  await first.ctx.orchestrator.waitForIdle(mission.id);

  // Simula queda com a missão rodando e uma tarefa no meio.
  const running = await first.db().missions.get(mission.id);
  await first.db().missions.update({ ...running!, status: 'running' });
  const [task] = await first.db().tasks.listForMission(mission.id);
  await first.db().tasks.update({ ...task!, status: 'running', attempts: 1 });
  await first.app.close();

  const second = await createHarness({ dataDir, keep: true });
  let state = await second.ctx.orchestrator.get(mission.id);
  assert.equal(state.status, 'paused');
  assert.match(state.pauseReason ?? '', /foi fechado/);
  const tasks = await second.ctx.orchestrator.tasks(mission.id);
  assert.equal(tasks[0]?.status, 'pending');
  assert.equal(tasks[0]?.attempts, 0);

  await second.ctx.orchestrator.resume(mission.id);
  state = await second.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  await second.app.close();
  removeDir(dataDir);
  removeDir(first.projectDir);
  removeDir(second.projectDir);
});

test('Estados dos agentes vêm dos eventos reais das execuções', async () => {
  const h = await createHarness();
  const { projectId, devId, reviewerId } = await team(h);
  const seen = new Map<string, string[]>();
  h.ctx.hub.subscribe((message) => {
    if (message.kind !== 'agent_state') return;
    const list = seen.get(message.data.agentId) ?? [];
    list.push(message.data.activity);
    seen.set(message.data.agentId, list);
  });

  assert.deepEqual(h.ctx.agentState.snapshot(), [], 'sem execução, nenhum estado é inventado');
  const mission = await h.ctx.orchestrator.start({
    projectId,
    goal: 'x',
    coordinatorId: devId,
    settings: { autoApprove: true },
  });
  await h.ctx.orchestrator.waitForIdle(mission.id);

  const dev = seen.get(devId) ?? [];
  assert.ok(dev.includes('thinking'));
  assert.ok(dev.includes('executing') || dev.includes('finished'));
  assert.equal(dev.at(-1), 'finished');
  assert.equal((seen.get(reviewerId) ?? []).at(-1), 'finished');

  const failing = await h.ctx.runs.create({ agentId: devId, projectId, prompt: 'QUEBRAR' });
  await h.ctx.runs.waitFor(failing.id);
  assert.equal(h.ctx.agentState.snapshot().find((state) => state.agentId === devId)?.activity, 'error');
  await h.cleanup();
});

test('API de missões: fluxo pelo HTTP e erros claros', async () => {
  const h = await createHarness();
  const { projectId, devId } = await team(h);
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    h.app.inject({ method, url, payload, headers: { host: '127.0.0.1', ...h.auth } });

  const created = await call('POST', '/api/missions', { projectId, goal: 'x', coordinatorId: devId });
  assert.equal(created.statusCode, 201);
  const { id } = created.json() as { id: string };
  await h.ctx.orchestrator.waitForIdle(id);

  assert.equal((await call('GET', `/api/missions/${id}`)).json().status, 'awaiting_approval');
  assert.equal((await call('GET', `/api/missions/${id}/tasks`)).json().length, 3);
  assert.equal((await call('POST', `/api/missions/${id}/pause`)).statusCode, 409);
  assert.equal((await call('POST', `/api/missions/${id}/approve`, {})).statusCode, 200);
  await h.ctx.orchestrator.waitForIdle(id);
  assert.equal((await call('GET', `/api/missions/${id}`)).json().status, 'completed');
  assert.ok((await call('GET', `/api/missions/${id}/events`)).json().length > 3);
  assert.equal((await call('GET', '/api/missions/nao-existe')).statusCode, 404);
  assert.equal((await call('POST', '/api/missions', { projectId, goal: '' })).statusCode, 400);
  await h.cleanup();
});
