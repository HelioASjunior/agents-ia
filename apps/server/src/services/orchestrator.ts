import type {
  Agent,
  CreateMissionInput as CreateMissionInputType,
  Mission,
  MissionEventData,
  MissionStatus,
  Run,
  StoredMissionEvent,
  Task,
} from '@xinoia/shared';
import { ApproveMissionInput, CreateMissionInput, MissionSettings, ROLES } from '@xinoia/shared';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { redact } from '../security/redact.ts';
import type { EventHub } from '../ws/hub.ts';
import { factualSummary, planCorrectionPrompt, planningPrompt, reportPrompt, taskPrompt } from './mission-prompts.ts';
import {
  addFixRound,
  buildTasks,
  extractHandoff,
  extractVerdict,
  findFixerId,
  parsePlan,
  pipelineTasks,
  readyTasks,
} from './planning.ts';
import type { RunService } from './runs.ts';

const ACTIVE: MissionStatus[] = ['planning', 'awaiting_approval', 'running', 'paused', 'reporting'];

export class Orchestrator {
  private readonly db: Persistence;
  private readonly runs: RunService;
  private readonly hub: EventHub;
  /** Execuções em andamento por missão: tarefa (ou planejamento) e a execução dela. */
  private readonly inFlight = new Map<string, Map<string, string>>();
  /** Decisões de uma missão acontecem uma por vez, para não haver disputa de estado. */
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly idleWaiters = new Map<string, Array<() => void>>();

  constructor(db: Persistence, runs: RunService, hub: EventHub) {
    this.db = db;
    this.runs = runs;
    this.hub = hub;
  }

  private serialize<T>(missionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(missionId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.chains.set(missionId, next.catch(() => undefined));
    return next;
  }

  private flight(missionId: string): Map<string, string> {
    let map = this.inFlight.get(missionId);
    if (!map) {
      map = new Map();
      this.inFlight.set(missionId, map);
    }
    return map;
  }

  private async requireMission(id: string): Promise<Mission> {
    const mission = await this.db.missions.get(id);
    if (!mission) throw notFound('Missão');
    return mission;
  }

  private async requireTask(missionId: string, taskId: string): Promise<Task> {
    const task = await this.db.tasks.get(taskId);
    if (!task || task.missionId !== missionId) throw notFound('Tarefa');
    return task;
  }

  private async saveMission(mission: Mission): Promise<void> {
    await this.db.missions.update(mission);
    this.hub.publish({ kind: 'mission_updated', data: { ...mission } });
  }

  private async saveTask(task: Task): Promise<void> {
    await this.db.tasks.update(task);
    this.hub.publish({ kind: 'task_updated', data: { ...task } });
  }

  private async log(mission: Mission, taskId: string | null, data: MissionEventData): Promise<void> {
    const stored = await this.db.missionEvents.append(mission.id, taskId, Date.now(), data);
    this.hub.publish({ kind: 'mission_event', data: stored });
  }

  private async setStatus(mission: Mission, status: MissionStatus, reason: string | null = null): Promise<void> {
    mission.status = status;
    mission.pauseReason = status === 'paused' || status === 'failed' ? reason : null;
    if (['completed', 'failed', 'cancelled'].includes(status)) mission.endedAt = Date.now();
    await this.saveMission(mission);
    await this.log(mission, null, { type: 'mission_status', status, reason });
    this.notifyIfIdle(mission.id, status);
  }

  private notifyIfIdle(missionId: string, status: MissionStatus): void {
    if (status === 'planning' || status === 'running' || status === 'reporting') return;
    if (this.flight(missionId).size) return;
    for (const resolve of this.idleWaiters.get(missionId) ?? []) resolve();
    this.idleWaiters.delete(missionId);
  }

  list(projectId?: string): Promise<Mission[]> {
    return this.db.missions.list({ projectId });
  }

  get(id: string): Promise<Mission> {
    return this.requireMission(id);
  }

  tasks(id: string): Promise<Task[]> {
    return this.db.tasks.listForMission(id);
  }

  events(id: string, afterId?: number): Promise<StoredMissionEvent[]> {
    return this.db.missionEvents.listForMission(id, afterId);
  }

  private async missionAgents(mission: Mission): Promise<Agent[]> {
    const all = await this.db.agents.list();
    if (!mission.agentIds.length) return all;
    return mission.agentIds.flatMap((id) => all.filter((agent) => agent.id === id));
  }

  // -------------------------------------------------------------------------
  // Criação e planejamento
  // -------------------------------------------------------------------------

  async start(input: CreateMissionInputType): Promise<Mission> {
    const data = CreateMissionInput.parse(input);
    const project = await this.db.projects.get(data.projectId);
    if (!project) throw notFound('Projeto');

    const current = await this.db.missions.list({ projectId: project.id, limit: 20 });
    if (current.some((mission) => ACTIVE.includes(mission.status))) {
      throw conflict('Este projeto já tem uma missão em andamento. Conclua ou cancele antes de começar outra.', 'mission_active');
    }

    const team = await this.db.agents.list();
    const agents = data.agentIds.length
      ? data.agentIds.map((id) => {
          const agent = team.find((member) => member.id === id);
          if (!agent) throw badRequest('Um dos agentes escolhidos não existe.');
          return agent;
        })
      : team;
    if (!agents.length) throw badRequest('A equipe está vazia. Crie ao menos um agente.', 'no_agents');

    const coordinator = data.coordinatorId
      ? team.find((agent) => agent.id === data.coordinatorId)
      : agents.find((agent) => agent.role === 'coordinator')
        ?? agents.find((agent) => agent.role === 'architect')
        ?? agents[0];
    if (!coordinator) throw badRequest('O coordenador escolhido não existe.');

    const mission: Mission = {
      id: newId('mission'),
      projectId: project.id,
      goal: redact(data.goal),
      status: 'planning',
      mode: data.mode,
      coordinatorId: coordinator.id,
      agentIds: agents.map((agent) => agent.id),
      settings: MissionSettings.parse(data.settings),
      planSummary: null,
      pauseReason: null,
      report: null,
      notes: [],
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
    };
    await this.db.missions.insert(mission);
    this.hub.publish({ kind: 'mission_updated', data: { ...mission } });
    await this.log(mission, null, { type: 'mission_status', status: 'planning' });

    if (mission.mode === 'pipeline') {
      await this.serialize(mission.id, () => this.acceptPlan(mission, null, pipelineTasks(mission.id, agents)));
    } else {
      void this.serialize(mission.id, () => this.plan(mission, agents)).catch((error) => this.crash(mission.id, error));
    }
    return mission;
  }

  private async crash(missionId: string, error: unknown): Promise<void> {
    const mission = await this.db.missions.get(missionId);
    if (!mission) return;
    await this.setStatus(mission, 'failed', error instanceof Error ? error.message : String(error));
  }

  private async plan(mission: Mission, agents: Agent[], feedback?: string): Promise<void> {
    if (!mission.coordinatorId) throw new Error('A missão ficou sem coordenador.');
    const flight = this.flight(mission.id);
    const execute = async (prompt: string, resume: boolean): Promise<Run> => {
      const run = await this.runs.create(
        { agentId: mission.coordinatorId!, projectId: mission.projectId, prompt, resume, permission: 'read' },
        { missionId: mission.id },
      );
      flight.set('plano', run.id);
      const done = await this.runs.waitFor(run.id);
      flight.delete('plano');
      return done;
    };

    let run = await execute(planningPrompt(mission, agents, feedback), false);
    if ((await this.requireMission(mission.id)).status === 'cancelled') return;
    if (run.status !== 'completed') {
      await this.setStatus(mission, 'failed', `O coordenador não conseguiu planejar: ${run.errorText ?? run.status}`);
      return;
    }

    let plan: ReturnType<typeof parsePlan>;
    try {
      plan = parsePlan(mission.id, run.finalText ?? '', agents);
    } catch (error) {
      // Uma chance de corrigir, porque costuma ser só um erro de formato.
      run = await execute(planCorrectionPrompt(error instanceof Error ? error.message : String(error)), true);
      try {
        plan = parsePlan(mission.id, run.finalText ?? '', agents);
      } catch (second) {
        await this.setStatus(mission, 'failed', `O plano veio em formato inválido: ${second instanceof Error ? second.message : String(second)}`);
        return;
      }
    }
    await this.acceptPlan(mission, plan.summary, plan.tasks);
  }

  private async acceptPlan(mission: Mission, summary: string | null, tasks: Task[]): Promise<void> {
    await this.db.tasks.replaceForMission(mission.id, tasks);
    for (const task of tasks) this.hub.publish({ kind: 'task_updated', data: task });
    mission.planSummary = summary;
    await this.log(mission, null, { type: 'plan_ready', summary, taskCount: tasks.length });
    if (mission.settings.autoApprove) {
      await this.beginRunning(mission);
    } else {
      await this.setStatus(mission, 'awaiting_approval');
    }
  }

  async approve(id: string, input: unknown = {}): Promise<Mission> {
    const data = ApproveMissionInput.parse(input ?? {});
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.status !== 'awaiting_approval') throw conflict('A missão não está aguardando aprovação.');
      if (data.tasks) {
        const tasks = buildTasks(mission.id, data.tasks, await this.missionAgents(mission));
        await this.db.tasks.replaceForMission(mission.id, tasks);
        for (const task of tasks) this.hub.publish({ kind: 'task_updated', data: task });
      }
      await this.beginRunning(mission);
      return mission;
    });
  }

  async replan(id: string, feedback: string): Promise<Mission> {
    const mission = await this.requireMission(id);
    if (mission.status !== 'awaiting_approval') throw conflict('A missão não está aguardando aprovação.');
    await this.setStatus(mission, 'planning');
    const agents = await this.missionAgents(mission);
    void this.serialize(id, () => this.plan(mission, agents, feedback)).catch((error) => this.crash(id, error));
    return mission;
  }

  private async beginRunning(mission: Mission): Promise<void> {
    mission.startedAt ??= Date.now();
    await this.setStatus(mission, 'running');
    await this.advance(mission.id);
  }

  // -------------------------------------------------------------------------
  // Execução
  // -------------------------------------------------------------------------

  private async advance(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (mission.status !== 'running') {
      this.notifyIfIdle(missionId, mission.status);
      return;
    }
    const tasks = await this.db.tasks.listForMission(missionId);
    const flight = this.flight(missionId);
    const busyAgents = new Set(
      tasks.filter((task) => flight.has(task.id)).map((task) => task.assigneeId),
    );

    for (const task of readyTasks(tasks)) {
      if (flight.size >= mission.settings.concurrency) break;
      if (task.assigneeId && busyAgents.has(task.assigneeId)) continue;
      busyAgents.add(task.assigneeId);
      await this.launch(mission, task, tasks);
    }

    if (flight.size) return;
    const open = tasks.filter((task) => !['done', 'skipped'].includes(task.status));
    if (!open.length) {
      await this.finish(mission, tasks);
      return;
    }
    // Sem nada rodando e sem nada pronto: uma dependência impede o resto.
    if (!readyTasks(tasks).length) {
      await this.setStatus(mission, 'paused', 'Há tarefas bloqueadas por outras que não terminaram. Tente de novo ou pule a tarefa com problema.');
    }
  }

  private async launch(mission: Mission, task: Task, tasks: Task[]): Promise<void> {
    if (!task.assigneeId) {
      task.status = 'failed';
      task.errorKind = 'unknown';
      task.errorText = `${task.assigneeName} foi removido da equipe.`;
      await this.saveTask(task);
      await this.setStatus(mission, 'paused', `A tarefa "${task.title}" está sem responsável. Reatribua a outro agente.`);
      return;
    }

    // Reservar antes de qualquer espera impede lançar a mesma tarefa duas vezes.
    const flight = this.flight(mission.id);
    flight.set(task.id, '');

    const byId = new Map(tasks.map((item) => [item.id, item]));
    for (const depId of task.dependsOn) {
      const dep = byId.get(depId);
      if (dep && dep.status === 'done' && dep.assigneeId !== task.assigneeId) {
        await this.log(mission, task.id, {
          type: 'handoff',
          fromAgentId: dep.assigneeId,
          fromAgentName: dep.assigneeName,
          toAgentId: task.assigneeId,
          toAgentName: task.assigneeName,
          taskTitle: task.title,
          summary: (dep.handoff ?? '').slice(0, 600),
        });
      }
    }

    task.status = 'running';
    task.attempts += 1;
    task.startedAt = Date.now();
    task.endedAt = null;
    task.errorKind = null;
    task.errorText = null;

    let run: Run;
    try {
      run = await this.runs.create(
        { agentId: task.assigneeId, projectId: mission.projectId, prompt: taskPrompt(mission, task, tasks) },
        { missionId: mission.id, taskId: task.id },
      );
    } catch (error) {
      flight.delete(task.id);
      const message = error instanceof Error ? error.message : String(error);
      task.status = 'failed';
      task.errorKind = 'unknown';
      task.errorText = message;
      task.endedAt = Date.now();
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'failed', agentName: task.assigneeName, error: message });
      await this.setStatus(mission, 'paused', `"${task.title}" não pôde começar: ${message}`);
      return;
    }
    flight.set(task.id, run.id);
    await this.saveTask(task);
    await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'running', agentName: task.assigneeName, runId: run.id });

    void this.runs.waitFor(run.id).then((finished) =>
      this.serialize(mission.id, () => this.onTaskFinished(mission.id, task.id, finished)),
    ).catch((error) => this.crash(mission.id, error));
  }

  private async onTaskFinished(missionId: string, taskId: string, run: Run): Promise<void> {
    this.flight(missionId).delete(taskId);
    const mission = await this.requireMission(missionId);
    const task = await this.requireTask(missionId, taskId);
    task.filesChanged = [...new Set([...task.filesChanged, ...run.filesChanged])];
    task.endedAt = Date.now();

    if (run.status === 'completed') {
      await this.onTaskCompleted(mission, task, run);
    } else if (run.status === 'cancelled') {
      // Em uma pausa a tarefa volta para a fila; em um cancelamento, fica cancelada.
      task.status = mission.status === 'cancelled' ? 'cancelled' : 'pending';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: task.status, agentName: task.assigneeName, runId: run.id });
    } else {
      await this.onTaskFailed(mission, task, run);
    }
    if (mission.status === 'running') await this.advance(missionId);
    else this.notifyIfIdle(missionId, (await this.requireMission(missionId)).status);
  }

  private async onTaskCompleted(mission: Mission, task: Task, run: Run): Promise<void> {
    const text = run.finalText ?? '';
    task.result = text;
    task.handoff = extractHandoff(text);

    if (task.type === 'review') {
      const verdict = extractVerdict(text);
      if (!verdict) {
        // Revisão sem veredito não pode passar como se tivesse sido aprovada.
        await this.onTaskFailed(mission, task, { ...run, errorKind: 'unknown', errorText: 'A revisão terminou sem um veredito claro.' });
        return;
      }
      task.verdict = verdict;
      task.status = 'done';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'review', reviewerName: task.assigneeName, verdict, taskTitle: task.title, summary: task.handoff.slice(0, 600) });
      if (verdict === 'REPROVADO') await this.onRejected(mission, task);
      return;
    }

    task.status = 'done';
    await this.saveTask(task);
    await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'done', agentName: task.assigneeName, runId: run.id });
  }

  private async onRejected(mission: Mission, review: Task): Promise<void> {
    const tasks = await this.db.tasks.listForMission(mission.id);
    if (review.round >= mission.settings.maxReviewRounds) {
      await this.setStatus(mission, 'paused', `"${review.title}" foi reprovada ${review.round + 1} vezes. Veja o motivo, depois tente de novo ou pule a tarefa.`);
      return;
    }
    const fixerId = findFixerId(tasks, review);
    const fixer = fixerId ? await this.db.agents.get(fixerId) : null;
    if (!fixer) {
      await this.setStatus(mission, 'paused', `"${review.title}" foi reprovada, mas ninguém da equipe pode corrigir.`);
      return;
    }
    const { fix, recheck, changed } = addFixRound(tasks, review, fixer);
    await this.db.tasks.insert(fix);
    await this.db.tasks.insert(recheck);
    for (const task of [fix, recheck]) this.hub.publish({ kind: 'task_updated', data: task });
    for (const task of changed) await this.saveTask(task);
    await this.log(mission, fix.id, {
      type: 'fix_requested',
      fromAgentName: review.assigneeName,
      toAgentName: fixer.name,
      round: fix.round,
      summary: (review.handoff ?? '').slice(0, 600),
    });
  }

  private async onTaskFailed(mission: Mission, task: Task, run: Pick<Run, 'errorKind' | 'errorText' | 'id'>): Promise<void> {
    task.errorKind = run.errorKind;
    task.errorText = run.errorText;

    // Limite ou login não se resolvem tentando de novo em seguida.
    if (run.errorKind === 'limit' || run.errorKind === 'auth' || run.errorKind === 'missing') {
      if (run.errorKind === 'limit' && mission.settings.fallbackToOtherProvider && (await this.tryFallback(mission, task))) return;
      task.status = 'failed';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'failed', agentName: task.assigneeName, runId: run.id, error: run.errorText });
      const reason = {
        limit: `${task.assigneeName} atingiu o limite de uso da conta. Espere renovar ou reatribua a tarefa a outro agente.`,
        auth: `A conta de ${task.assigneeName} precisa de login. Faça o login oficial e tente de novo.`,
        missing: `A ferramenta de ${task.assigneeName} não está instalada neste computador.`,
      }[run.errorKind];
      await this.setStatus(mission, 'paused', reason);
      return;
    }

    if (task.attempts < mission.settings.maxAttempts) {
      task.status = 'pending';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'retry', title: task.title, attempt: task.attempts + 1, reason: run.errorText ?? 'falhou' });
      return;
    }

    task.status = 'failed';
    await this.saveTask(task);
    await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'failed', agentName: task.assigneeName, runId: run.id, error: run.errorText });
    await this.setStatus(mission, 'paused', `"${task.title}" falhou depois de ${task.attempts} tentativas: ${run.errorText ?? 'erro desconhecido'}`);
  }

  private async tryFallback(mission: Mission, task: Task): Promise<boolean> {
    const agents = await this.missionAgents(mission);
    const current = agents.find((agent) => agent.id === task.assigneeId);
    if (!current) return false;
    const others = agents.filter((agent) => agent.provider !== current.provider && agent.profileId);
    const next = others.find((agent) => agent.role === current.role)
      ?? others.find((agent) => ROLES[agent.role].reviews === (task.type === 'review'));
    if (!next) return false;
    await this.log(mission, task.id, {
      type: 'reassigned',
      title: task.title,
      fromAgentName: current.name,
      toAgentName: next.name,
      reason: 'limite de uso da conta',
    });
    task.assigneeId = next.id;
    task.assigneeName = next.name;
    task.attempts = 0;
    task.status = 'pending';
    await this.saveTask(task);
    return true;
  }

  private async finish(mission: Mission, tasks: Task[]): Promise<void> {
    await this.setStatus(mission, 'reporting');
    const facts = factualSummary(tasks);
    let narrative: string | null = null;
    if (mission.coordinatorId && (await this.db.agents.get(mission.coordinatorId))) {
      try {
        const run = await this.runs.create(
          { agentId: mission.coordinatorId, projectId: mission.projectId, prompt: reportPrompt(mission, tasks), permission: 'read' },
          { missionId: mission.id },
        );
        const flight = this.flight(mission.id);
        flight.set('relatorio', run.id);
        const done = await this.runs.waitFor(run.id);
        flight.delete('relatorio');
        if (done.status === 'completed') narrative = done.finalText;
      } catch {
        // O relatório é um extra: sem ele, a parte factual continua valendo.
      }
    }
    const latest = await this.requireMission(mission.id);
    if (latest.status === 'cancelled') return;
    mission.report = [narrative, facts].filter(Boolean).join('\n\n---\n\n');
    await this.setStatus(mission, 'completed');
  }

  // -------------------------------------------------------------------------
  // Comandos do usuário
  // -------------------------------------------------------------------------

  /** Para de iniciar tarefas. O que já está rodando termina normalmente. */
  async pause(id: string, reason = 'Pausada pelo usuário.'): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.status !== 'running') throw conflict('A missão não está em execução.');
      await this.setStatus(mission, 'paused', reason);
      return mission;
    });
  }

  async resume(id: string): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.status !== 'paused') throw conflict('A missão não está pausada.');
      await this.setStatus(mission, 'running');
      await this.advance(id);
      return mission;
    });
  }

  async cancel(id: string): Promise<Mission> {
    const mission = await this.requireMission(id);
    if (!ACTIVE.includes(mission.status)) throw conflict('A missão já terminou.');
    mission.status = 'cancelled';
    await this.db.missions.update(mission);
    const runIds = [...this.flight(id).values()].filter(Boolean);
    for (const runId of runIds) await this.runs.cancel(runId).catch(() => undefined);
    return this.serialize(id, async () => {
      const latest = await this.requireMission(id);
      const tasks = await this.db.tasks.listForMission(id);
      for (const task of tasks) {
        if (task.status === 'pending') {
          task.status = 'cancelled';
          await this.saveTask(task);
        }
      }
      await this.setStatus(latest, 'cancelled');
      return latest;
    });
  }

  async retryTask(missionId: string, taskId: string): Promise<Task> {
    return this.serialize(missionId, async () => {
      const mission = await this.requireMission(missionId);
      if (!ACTIVE.includes(mission.status)) throw conflict('A missão já terminou.');
      const task = await this.requireTask(missionId, taskId);
      if (task.status === 'running') throw conflict('A tarefa está em execução.');
      if (task.status === 'done' && task.verdict === 'REPROVADO') {
        // Nova chance para uma revisão que atingiu o limite de correções.
        task.round = 0;
      }
      task.status = 'pending';
      task.verdict = null;
      task.attempts = 0;
      task.errorKind = null;
      task.errorText = null;
      await this.saveTask(task);
      if (mission.status === 'paused') await this.setStatus(mission, 'running');
      await this.advance(missionId);
      return task;
    });
  }

  async skipTask(missionId: string, taskId: string): Promise<Task> {
    return this.serialize(missionId, async () => {
      const mission = await this.requireMission(missionId);
      if (!ACTIVE.includes(mission.status)) throw conflict('A missão já terminou.');
      const task = await this.requireTask(missionId, taskId);
      if (task.status === 'running') throw conflict('A tarefa está em execução.');
      task.status = 'skipped';
      task.endedAt = Date.now();
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'skipped', agentName: task.assigneeName });
      if (mission.status === 'paused') await this.setStatus(mission, 'running');
      await this.advance(missionId);
      return task;
    });
  }

  async reassignTask(missionId: string, taskId: string, agentId: string): Promise<Task> {
    return this.serialize(missionId, async () => {
      const mission = await this.requireMission(missionId);
      const task = await this.requireTask(missionId, taskId);
      if (task.status === 'running' || task.status === 'done') throw conflict('Esta tarefa não pode mais ser reatribuída.');
      const agent = await this.db.agents.get(agentId);
      if (!agent) throw notFound('Agente');
      await this.log(mission, task.id, { type: 'reassigned', title: task.title, fromAgentName: task.assigneeName, toAgentName: agent.name, reason: 'pedido do usuário' });
      task.assigneeId = agent.id;
      task.assigneeName = agent.name;
      if (task.status === 'failed') {
        task.status = 'pending';
        task.attempts = 0;
      }
      await this.saveTask(task);
      return task;
    });
  }

  async addNote(id: string, text: string): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      const clean = redact(text);
      mission.notes.push(clean);
      await this.saveMission(mission);
      await this.log(mission, null, { type: 'note', text: clean });
      return mission;
    });
  }

  /** Espera a missão parar de ter o que fazer. Usado por testes. */
  async waitForIdle(id: string): Promise<Mission> {
    const mission = await this.requireMission(id);
    const settled = !['planning', 'running', 'reporting'].includes(mission.status) && !this.flight(id).size;
    if (!settled) {
      await new Promise<void>((resolve) => {
        const list = this.idleWaiters.get(id) ?? [];
        list.push(resolve);
        this.idleWaiters.set(id, list);
      });
    }
    await (this.chains.get(id) ?? Promise.resolve());
    return this.requireMission(id);
  }

  /** O app fechou no meio: nada é retomado sem o usuário, mas nada se perde. */
  async recover(): Promise<number> {
    const unfinished = await this.db.missions.listUnfinished();
    for (const mission of unfinished) {
      const tasks = await this.db.tasks.listForMission(mission.id);
      for (const task of tasks) {
        if (task.status === 'running') {
          task.status = 'pending';
          task.attempts = Math.max(0, task.attempts - 1);
          await this.db.tasks.update(task);
        }
      }
      if (mission.status === 'planning') {
        await this.setStatus(mission, 'failed', 'O XinoIA foi fechado durante o planejamento. Comece a missão de novo.');
      } else {
        await this.setStatus(mission, 'paused', 'O XinoIA foi fechado durante a missão. Retome quando quiser.');
      }
    }
    return unfinished.length;
  }

  /** Contexto para quem conversa com a equipe durante a missão. */
  async describeActive(projectId: string): Promise<{ mission: Mission; tasks: Task[] } | null> {
    const missions = await this.db.missions.list({ projectId, limit: 5 });
    const mission = missions.find((item) => ACTIVE.includes(item.status));
    return mission ? { mission, tasks: await this.db.tasks.listForMission(mission.id) } : null;
  }
}
