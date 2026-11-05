import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { Agent, GoalQueue, Task, WorkflowNode } from '@xinoia/shared';
import { reserveProblem } from '@xinoia/shared';
import { addFixRound, buildTasks, pickFallback } from '../src/services/planning.ts';
import { workflowToTasks } from '../src/services/workflows.ts';
import { createHarness, fakeAdapter, otherAdapter, type Harness } from './support/harness.ts';

const agent = (id: string, provider: string, role: Agent['role'], permission: Agent['permission'], toolkitIds: string[] = []): Agent => ({
  id,
  name: id,
  role,
  roleTitle: null,
  instructions: null,
  provider,
  profileId: 'p',
  model: null,
  effort: null,
  permission,
  color: '#000000',
  toolkitIds,
  createdAt: 0,
});

const testing = (team: Agent[], assignee: string): Task[] => buildTasks('m', [{ title: 'Testar', assignee, type: 'review' }], team);

test('Reserva: recusa o mesmo provedor e quem tem menos permissão, e aceita o resto', () => {
  const anny = agent('Anny', 'codex', 'tester', 'full');
  assert.match(reserveProblem(anny, agent('Outra', 'codex', 'tester', 'full')) ?? '', /mesmo provedor/);
  assert.match(reserveProblem(anny, agent('Laryssa', 'claude', 'reviewer', 'read')) ?? '', /menos permissão/);
  assert.equal(reserveProblem(anny, agent('Xino', 'claude', 'coordinator', 'full')), null);
  assert.equal(reserveProblem(agent('Dev', 'codex', 'developer', 'edit'), agent('Xino', 'claude', 'coordinator', 'full')), null);
});

test('Reserva: um workflow salvo antes de existir a opção não ganha reserva', () => {
  const team = [agent('Ana', 'fake', 'developer', 'edit')];
  const old = { id: 'a', title: 'A', description: '', role: 'developer', type: 'work', runIf: 'always', maxAttempts: 2, x: 0, y: 0 } as WorkflowNode;
  assert.equal(workflowToTasks({ nodes: [old], edges: [] }, 'm', team)[0]?.fallbackAgentId, null);
  assert.equal(workflowToTasks({ nodes: [{ ...old, fallbackAgentId: 'x' }], edges: [] }, 'm', team)[0]?.fallbackAgentId, 'x');
});

test('Reserva: a rodada de correção mantém a reserva do trabalho e da revisão', () => {
  const dev = agent('Dev', 'codex', 'developer', 'edit');
  const rev = agent('Rev', 'codex', 'reviewer', 'read');
  const tasks = buildTasks('m', [
    { id: 'a', title: 'Fazer', assignee: 'Dev' },
    { id: 'b', title: 'Olhar', assignee: 'Rev', dependsOn: ['a'] },
  ], [dev, rev]);
  tasks[0]!.fallbackAgentId = 'reserva-do-trabalho';
  tasks[1]!.fallbackAgentId = 'reserva-da-revisao';
  const { fix, recheck } = addFixRound(tasks, tasks[1]!, dev);
  assert.equal(fix.fallbackAgentId, 'reserva-do-trabalho');
  assert.equal(recheck.fallbackAgentId, 'reserva-da-revisao');
});

test('Troca automática: uma tarefa de quem pode tudo não cai em quem só lê, mesmo sendo da mesma função', () => {
  const anny = agent('Anny', 'codex', 'tester', 'full');
  const laryssa = agent('Laryssa', 'claude', 'reviewer', 'read');
  const xino = agent('Xino', 'claude', 'coordinator', 'full');
  const team = [anny, laryssa, xino];
  assert.equal(pickFallback(testing(team, 'Anny'), testing(team, 'Anny')[0]!, anny, team)?.name, 'Xino');
  const withoutXino = [anny, laryssa];
  assert.equal(pickFallback(testing(withoutXino, 'Anny'), testing(withoutXino, 'Anny')[0]!, anny, withoutXino), null);
});

test('Troca automática: prefere a mesma função, e depois o mesmo tipo de trabalho', () => {
  const current = agent('Atual', 'codex', 'developer', 'edit');
  const docs = agent('Docs', 'claude', 'docs', 'edit');
  const tester = agent('Tester', 'claude', 'tester', 'edit');
  const backend = agent('Back', 'claude', 'developer', 'edit');
  const team = [current, tester, docs, backend];
  const tasks = buildTasks('m', [{ title: 'Fazer', assignee: 'Atual' }], team);
  assert.equal(pickFallback(tasks, tasks[0]!, current, team)?.name, 'Back');
  assert.equal(pickFallback(tasks, tasks[0]!, current, [current, tester, docs])?.name, 'Docs');
});

test('Troca automática: exige as mesmas ferramentas e aceita permissão maior', () => {
  const current = agent('Atual', 'codex', 'unreal', 'edit', ['unreal-mcp']);
  const semFerramenta = agent('Sem', 'claude', 'unreal', 'full');
  const comFerramenta = agent('Com', 'claude', 'developer', 'full', ['unreal-mcp', 'outra']);
  const team = [current, semFerramenta, comFerramenta];
  const tasks = buildTasks('m', [{ title: 'Fazer', assignee: 'Atual' }], team);
  assert.equal(pickFallback(tasks, tasks[0]!, current, team)?.name, 'Com');
  assert.equal(pickFallback(tasks, tasks[0]!, current, [current, semFerramenta]), null);
});

test('Troca automática: ninguém dá veredito sobre o próprio trabalho, direto ou indireto', () => {
  const dev = agent('Dev', 'claude', 'developer', 'full');
  const tester = agent('Tester', 'codex', 'tester', 'full');
  const team = [dev, tester];
  const tasks = buildTasks('m', [
    { id: 'a', title: 'Fazer', assignee: 'Dev' },
    { id: 'b', title: 'Compilar', assignee: 'Dev', dependsOn: ['a'] },
    { id: 'c', title: 'Testar', assignee: 'Tester', type: 'review', dependsOn: ['b'] },
  ], team);
  assert.equal(pickFallback(tasks, tasks[2]!, tester, team), null, 'quem fez não revisa');
  assert.equal(pickFallback(tasks, tasks[0]!, dev, team), null, 'quem vai revisar não assume o trabalho');
});

test('Troca automática: um provedor que já atingiu o limite nesta tarefa não volta, nem em outra conta', () => {
  const a = agent('A', 'codex', 'developer', 'edit');
  const outraContaDeA = agent('A2', 'codex', 'developer', 'edit');
  const b = agent('B', 'claude', 'developer', 'edit');
  const team = [a, outraContaDeA, b];
  const [task] = buildTasks('m', [{ title: 'Fazer', assignee: 'B' }], team);
  task!.handovers = [{ fromAgentName: 'A', fromProvider: 'codex', toAgentName: 'B', toProvider: 'claude', at: 1 }];
  assert.equal(pickFallback([task!], task!, b, team), null);
});

type ReserveName = 'Xino' | 'Laryssa' | 'Outra' | null;

/** A equipe do caso real: quem testa pode tudo, quem revisa só lê, e o coordenador pode tudo. */
async function queueWithTeam(h: Harness, reserveName: ReserveName, onFailure: 'stop' | 'skip' = 'stop') {
  const project = await h.ctx.projects.create({ path: h.projectDir, name: 'teste' });
  const fake = await h.ctx.profiles.create({ provider: 'fake', label: 'Conta 1' });
  const fake2 = await h.ctx.profiles.create({ provider: 'fake', label: 'Conta 3' });
  const outro = await h.ctx.profiles.create({ provider: 'outro', label: 'Conta 2' });
  const anny = await h.ctx.agents.create({ name: 'Anny', provider: 'fake', profileId: fake.id, role: 'tester', permission: 'full' });
  const team = {
    Laryssa: await h.ctx.agents.create({ name: 'Laryssa', provider: 'outro', profileId: outro.id, role: 'reviewer', permission: 'read' }),
    Xino: await h.ctx.agents.create({ name: 'Xino', provider: 'outro', profileId: outro.id, role: 'coordinator', permission: 'full' }),
    Outra: await h.ctx.agents.create({ name: 'Outra', provider: 'fake', profileId: fake2.id, role: 'developer', permission: 'full' }),
  };
  const workflow = await h.ctx.workflows.create({
    name: 'Testar',
    nodes: [{
      id: 'testar',
      title: 'Testar',
      role: 'tester',
      type: 'review',
      description: 'compile e teste',
      agentId: anny.id,
      fallbackAgentId: reserveName ? team[reserveName].id : null,
      maxAttempts: 1,
    }],
    edges: [],
  });
  await h.ctx.queues.save(project.id, { workflowId: workflow.id, onFailure });
  return { projectId: project.id, workflowId: workflow.id, reserveId: reserveName ? team[reserveName].id : null };
}

async function settled(h: Harness, projectId: string): Promise<GoalQueue> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const queue = (await h.ctx.queues.get(projectId))!;
    const current = queue.items.find((item) => item.status === 'running');
    if (!current && !queue.running) return queue;
    const mission = current?.missionId ? await h.db().missions.get(current.missionId) : null;
    if (mission?.status === 'paused') {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return (await h.ctx.queues.get(projectId))!;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('A fila não assentou a tempo.');
}

const twoProviders = () => createHarness({ providers: [fakeAdapter(), otherAdapter()] });

test('Fila: a reserva da etapa assume, e a troca fica registrada na tarefa e no relatório', async () => {
  const h = await twoProviders();
  const { projectId, workflowId, reserveId } = await queueWithTeam(h, 'Xino');
  assert.equal((await h.ctx.workflows.get(workflowId)).nodes[0]?.fallbackAgentId, reserveId, 'a reserva fica salva no workflow');
  await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(queue.items.map((item) => item.status), ['done', 'done']);
  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  const [task] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(task?.assigneeName, 'Xino');
  assert.equal(task?.type, 'review', 'continua exigindo veredito');
  assert.equal(task?.verdict, 'APROVADO');
  assert.deepEqual(task?.handovers.map(({ fromAgentName, fromProvider, toAgentName, toProvider }) => ({ fromAgentName, fromProvider, toAgentName, toProvider })), [
    { fromAgentName: 'Anny', fromProvider: 'fake', toAgentName: 'Xino', toProvider: 'outro' },
  ]);
  assert.match(mission.report ?? '', /Testar: de Anny \(fake\) para Xino \(outro\)/);
  const events = await h.ctx.orchestrator.events(mission.id);
  assert.ok(events.some((event) => event.data.type === 'reassigned' && event.data.toAgentName === 'Xino' && /reserva/.test(event.data.reason)));
  // O objetivo seguinte começa de novo com a Anny: a troca vale para aquela tarefa.
  const [next] = await h.ctx.orchestrator.tasks(queue.items[1]!.missionId!);
  assert.equal(next?.assigneeName, 'Anny');
  await h.cleanup();
});

test('Reserva: quem assume fica sabendo que o trabalho pode ter parado no meio', async () => {
  const h = await twoProviders();
  const { projectId } = await queueWithTeam(h, 'Xino');
  await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake'] });
  await h.ctx.queues.start(projectId);
  await settled(h, projectId);
  const prompt = fs.readFileSync(path.join(h.projectDir, 'prompt-recebido.txt'), 'utf8');
  assert.match(prompt, /Esta tarefa era de Anny, cuja conta atingiu o limite de uso/);
  await h.cleanup();
});

test('Fila: sem reserva configurada, nada muda: pausa e espera, mesmo com agentes disponíveis', async () => {
  const h = await twoProviders();
  const { projectId } = await queueWithTeam(h, null, 'skip');
  await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake', 'depois'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  assert.deepEqual(queue.items.map((item) => item.status), ['running', 'pending'], 'limite nunca é pulado');
  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(mission.status, 'paused');
  assert.equal(mission.pauseReason, 'Anny atingiu o limite de uso da conta. Espere renovar ou reatribua a tarefa a outro agente.');
  const [task] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(task?.assigneeName, 'Anny');
  assert.deepEqual(task?.handovers, []);
  await h.cleanup();
});

for (const [reserve, reason] of [['Laryssa', /Laryssa tem menos permissão do que Anny/], ['Outra', /Outra usa o mesmo provedor de Anny/]] as const) {
  test(`Fila: uma reserva inadequada (${reserve}) não assume: pausa e diz por quê`, async () => {
    const h = await twoProviders();
    const { projectId } = await queueWithTeam(h, reserve);
    await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake', 'depois'] });
    await h.ctx.queues.start(projectId);
    const queue = await settled(h, projectId);

    assert.deepEqual(queue.items.map((item) => item.status), ['running', 'pending']);
    const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
    assert.equal(mission.status, 'paused');
    assert.match(mission.pauseReason ?? '', reason);
    const [task] = await h.ctx.orchestrator.tasks(mission.id);
    assert.equal(task?.assigneeName, 'Anny');
    assert.equal(task?.attempts, 1);
    await h.cleanup();
  });
}

test('Reserva removida da equipe: pausa e diz por quê', async () => {
  const h = await twoProviders();
  const { projectId, reserveId } = await queueWithTeam(h, 'Xino');
  await h.ctx.agents.remove(reserveId!);
  await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);
  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(mission.status, 'paused');
  assert.match(mission.pauseReason ?? '', /reserva escolhida para esta etapa não existe mais/);
  await h.cleanup();
});

test('Fila: com a reserva também no limite, troca uma vez e pausa, sem ficar indo e vindo', async () => {
  const h = await twoProviders();
  const { projectId } = await queueWithTeam(h, 'Xino');
  await h.ctx.queues.addItems(projectId, { goals: ['ESGOTADO_fake ESGOTADO_outro'] });
  await h.ctx.queues.start(projectId);
  const queue = await settled(h, projectId);

  const mission = await h.ctx.orchestrator.get(queue.items[0]!.missionId!);
  assert.equal(mission.status, 'paused');
  assert.match(mission.pauseReason ?? '', /Xino atingiu o limite/);
  const [task] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(task?.assigneeName, 'Xino');
  assert.equal(task?.handovers.length, 1);
  assert.equal(task?.status, 'failed');
  assert.equal((await h.db().runs.list({ missionId: mission.id, limit: 50 })).length, 2);
  await h.cleanup();
});

test('Reserva: "Aprovar e iniciar" não apaga a escolha, como a tela reenvia o plano', async () => {
  const h = await twoProviders();
  const { projectId, workflowId, reserveId } = await queueWithTeam(h, 'Xino');
  await h.ctx.settings.update({ executionMode: 'semi' });
  const mission = await h.ctx.workflows.run(workflowId, { projectId, goal: 'ESGOTADO_fake' });
  assert.equal(mission.status, 'awaiting_approval');
  const [draft] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(draft?.fallbackAgentId, reserveId);
  await h.ctx.orchestrator.approve(mission.id, {
    tasks: [{ id: draft!.id, title: draft!.title, description: draft!.description, assignee: draft!.assigneeId!, type: draft!.type, priority: draft!.priority, dependsOn: [] }],
  });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const [task] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(task?.assigneeName, 'Xino');
  await h.cleanup();
});

test('Opção da missão: sem reserva, a troca automática segue as mesmas proteções', async () => {
  const h = await twoProviders();
  const { projectId, workflowId } = await queueWithTeam(h, null);
  const mission = await h.ctx.workflows.run(workflowId, { projectId, goal: 'ESGOTADO_fake', settings: { autoApprove: true, fallbackToOtherProvider: true } });
  const state = await h.ctx.orchestrator.waitForIdle(mission.id);
  assert.equal(state.status, 'completed', state.pauseReason ?? '');
  const [task] = await h.ctx.orchestrator.tasks(mission.id);
  assert.equal(task?.assigneeName, 'Xino', 'não foi para quem só lê');
  assert.equal(task?.handovers.length, 1);
  await h.cleanup();
});
