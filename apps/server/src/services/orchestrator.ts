import type {
  Agent,
  CreateMissionInput as CreateMissionInputType,
  Mission,
  MissionEventData,
  MissionStatus,
  Run,
  StoredMissionEvent,
  Task,
  Workflow,
} from '@xinoia/shared';
import { ApproveMissionInput, CreateMissionInput, MissionSettings, reserveProblem } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { redact } from '../security/redact.ts';
import type { EventHub } from '../ws/hub.ts';
import * as gitOps from './git.ts';
import { extractDecisions, type MemoryService } from './memory.ts';
import { factualSummary, planCorrectionPrompt, planningPrompt, reportPrompt, taskPrompt } from './mission-prompts.ts';
import {
  addFixRound,
  buildTasks,
  extractHandoff,
  extractVerdict,
  findFixerId,
  parsePlan,
  pickFallback,
  pipelineTasks,
  blockingRejections, readyTasks,
} from './planning.ts';
import type { SettingsService } from './policy.ts';
import type { RunService } from './runs.ts';
import { workflowToTasks } from './workflows.ts';

const ACTIVE: MissionStatus[] = ['planning', 'awaiting_approval', 'running', 'paused', 'reporting'];

/** Por que uma missão pausou: uma falha do trabalho, um problema da conta ou só a vez da pessoa. */
export type PauseKind = 'failure' | 'account' | 'waiting';

export class Orchestrator {
  private readonly config: AppConfig;
  private readonly db: Persistence;
  private readonly runs: RunService;
  private readonly hub: EventHub;
  private readonly memory: MemoryService;
  private readonly settings: SettingsService;
  /** Execuções em andamento por missão: tarefa (ou planejamento) e a execução dela. */
  private readonly inFlight = new Map<string, Map<string, string>>();
  /** Decisões de uma missão acontecem uma por vez, para não haver disputa de estado. */
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly idleWaiters = new Map<string, Array<() => void>>();
  /** Pasta e ramo de cada tarefa isolada em andamento. */
  private readonly workspaces = new Map<string, { dir: string; branch: string }>();
  /** Avisado quando uma missão termina, ou pausa por um problema. */
  onMissionStopped: ((mission: Mission, pause: PauseKind) => void) | null = null;

  constructor(config: AppConfig, db: Persistence, runs: RunService, hub: EventHub, memory: MemoryService, settings: SettingsService) {
    this.config = config;
    this.db = db;
    this.runs = runs;
    this.hub = hub;
    this.memory = memory;
    this.settings = settings;
    runs.onDangerous = (event) => {
      if (event.run.missionId) {
        void this.onDangerousCommand(event.run.missionId, event.run, event.command, event.reason, event.blocked);
      }
    };
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

  private async projectPath(mission: Mission): Promise<string> {
    const project = await this.db.projects.get(mission.projectId);
    if (!project) throw notFound('Projeto');
    return project.path;
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

  private async setStatus(mission: Mission, status: MissionStatus, reason: string | null = null, pause: PauseKind = 'failure'): Promise<void> {
    mission.status = status;
    mission.pauseReason = status === 'paused' || status === 'failed' ? reason : null;
    if (['completed', 'failed', 'cancelled'].includes(status)) mission.endedAt = Date.now();
    await this.saveMission(mission);
    await this.log(mission, null, { type: 'mission_status', status, reason });
    this.notifyIfIdle(mission.id, status);
    if (['completed', 'failed', 'cancelled'].includes(status) || (status === 'paused' && pause !== 'waiting')) {
      this.onMissionStopped?.({ ...mission }, pause);
    }
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

  private async assertNoActive(projectId: string): Promise<void> {
    const current = await this.db.missions.list({ projectId, limit: 20 });
    if (current.some((mission) => ACTIVE.includes(mission.status))) {
      throw conflict('Este projeto já tem uma missão em andamento. Conclua ou cancele antes de começar outra.', 'mission_active');
    }
  }

  private newMission(fields: Pick<Mission, 'projectId' | 'goal' | 'mode' | 'coordinatorId' | 'agentIds' | 'settings'> & { workflowId?: string | null }): Mission {
    return {
      id: newId('mission'),
      status: 'planning',
      planSummary: null,
      pauseReason: null,
      report: null,
      notes: [],
      isolation: 'none',
      baseBranch: null,
      integrationBranch: null,
      mergeStatus: 'none',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      ...fields,
      workflowId: fields.workflowId ?? null,
    };
  }

  /**
   * Tarefas em paralelo não podem escrever na mesma pasta sem risco de uma apagar a
   * outra. Com Git, cada uma ganha um worktree; sem Git, a missão roda uma por vez.
   */
  private async prepareIsolation(mission: Mission, projectPath: string): Promise<void> {
    if (mission.settings.concurrency <= 1) return;
    if (await gitOps.isGitRepo(projectPath) && await gitOps.hasCommits(projectPath)) {
      const isolation = await gitOps.startIsolation(projectPath, this.config.dataDir, mission.id);
      mission.isolation = 'worktree';
      mission.baseBranch = isolation.baseBranch;
      mission.integrationBranch = isolation.integrationBranch;
      await this.db.missions.update(mission);
      return;
    }
    mission.settings.concurrency = 1;
    await this.db.missions.update(mission);
    await this.log(mission, null, {
      type: 'note',
      text: 'Tarefas em paralelo exigem um repositório Git com ao menos um commit. Esta missão vai rodar uma tarefa por vez, para ninguém sobrescrever o trabalho de outro agente.',
    });
  }

  private enforceMode(mission: Mission): void {
    // Nos modos com supervisão, o plano sempre passa pelo usuário.
    if (this.settings.get().executionMode !== 'autonomous') mission.settings.autoApprove = false;
  }

  async start(input: CreateMissionInputType): Promise<Mission> {
    const data = CreateMissionInput.parse(input);
    const project = await this.db.projects.get(data.projectId);
    if (!project) throw notFound('Projeto');
    await this.assertNoActive(project.id);

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

    const mission = this.newMission({
      projectId: project.id,
      goal: redact(data.goal),
      mode: data.mode,
      coordinatorId: coordinator.id,
      agentIds: agents.map((agent) => agent.id),
      settings: MissionSettings.parse(data.settings),
    });
    if (data.mode === 'auto') this.enforceMode(mission);
    await this.db.missions.insert(mission);
    this.hub.publish({ kind: 'mission_updated', data: { ...mission } });
    await this.log(mission, null, { type: 'mission_status', status: 'planning' });
    await this.prepareIsolation(mission, project.path);

    if (mission.mode === 'pipeline') {
      this.enforceMode(mission);
      await this.serialize(mission.id, () => this.acceptPlan(mission, null, pipelineTasks(mission.id, agents)));
    } else {
      void this.serialize(mission.id, () => this.plan(mission, agents)).catch((error) => this.crash(mission.id, error));
    }
    return mission;
  }

  async startFromWorkflow(workflow: Workflow, projectId: string, goal: string, settings: Partial<MissionSettings>, id: string = newId('mission')): Promise<Mission> {
    const project = await this.db.projects.get(projectId);
    if (!project) throw notFound('Projeto');
    await this.assertNoActive(project.id);
    const team = await this.db.agents.list();
    if (!team.length) throw badRequest('A equipe está vazia. Crie ao menos um agente.', 'no_agents');

    const tasks = workflowToTasks(workflow, id, team);
    const coordinator = team.find((agent) => agent.role === 'coordinator') ?? team.find((agent) => agent.id === tasks[0]?.assigneeId) ?? team[0]!;
    const mission: Mission = {
      ...this.newMission({
        projectId,
        goal: redact(goal),
        mode: 'workflow',
        coordinatorId: coordinator.id,
        agentIds: team.map((agent) => agent.id),
        settings: MissionSettings.parse(settings),
        workflowId: workflow.builtin ? null : workflow.id,
      }),
      id,
      planSummary: `Workflow: ${workflow.name}`,
    };
    this.enforceMode(mission);
    await this.db.missions.insert(mission);
    this.hub.publish({ kind: 'mission_updated', data: { ...mission } });
    await this.log(mission, null, { type: 'mission_status', status: 'planning' });
    await this.prepareIsolation(mission, project.path);
    await this.serialize(mission.id, () => this.acceptPlan(mission, mission.planSummary, tasks));
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

    const memory = await this.memory.promptBlock(mission.projectId);
    let run = await execute(planningPrompt(mission, agents, feedback, memory), false);
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
    this.hub.publish({ kind: 'tasks_replaced', missionId: mission.id, data: tasks });
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
        const current = await this.db.tasks.listForMission(mission.id);
        const tasks = buildTasks(mission.id, data.tasks, await this.missionAgents(mission), current);
        await this.db.tasks.replaceForMission(mission.id, tasks);
        this.hub.publish({ kind: 'tasks_replaced', missionId: mission.id, data: tasks });
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

  /** Etapas com condição: se a revisão anterior não bate, a etapa é pulada. */
  private async applyConditions(mission: Mission, tasks: Task[]): Promise<boolean> {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    let changed = false;
    for (const task of readyTasks(tasks)) {
      if (task.runIf === 'always') continue;
      const reviews = task.dependsOn.map((id) => byId.get(id)).filter((dep): dep is Task => dep?.type === 'review');
      const expected = task.runIf === 'approved' ? 'APROVADO' : 'REPROVADO';
      if (reviews.length && reviews.every((review) => review.verdict !== expected)) {
        task.status = 'skipped';
        task.endedAt = Date.now();
        await this.saveTask(task);
        await this.log(mission, task.id, {
          type: 'task_skipped_by_condition',
          title: task.title,
          condition: task.runIf === 'approved' ? 'só se aprovado' : 'só se reprovado',
        });
        changed = true;
      }
    }
    return changed;
  }

  private async advance(missionId: string): Promise<void> {
    const mission = await this.requireMission(missionId);
    if (mission.status !== 'running') {
      this.notifyIfIdle(missionId, mission.status);
      return;
    }
    let tasks = await this.db.tasks.listForMission(missionId);
    while (await this.applyConditions(mission, tasks)) {
      tasks = await this.db.tasks.listForMission(missionId);
    }
    const flight = this.flight(missionId);
    const busyAgents = new Set(tasks.filter((task) => flight.has(task.id)).map((task) => task.assigneeId));
    const supervised = this.settings.get().executionMode === 'supervised';

    for (const task of readyTasks(tasks)) {
      if (flight.size >= mission.settings.concurrency) break;
      if (task.assigneeId && busyAgents.has(task.assigneeId)) continue;
      if (supervised && !task.approvedAt) {
        // No modo supervisionado, cada tarefa espera liberação, sem interromper as outras.
        if (!flight.size) {
          await this.setStatus(mission, 'paused', `Aprove para continuar: "${task.title}", por ${task.assigneeName}. Retome a missão quando quiser liberar esta tarefa.`, 'waiting');
        }
        return;
      }
      busyAgents.add(task.assigneeId);
      await this.launch(mission, task, tasks);
      if (mission.status !== 'running') return;
    }

    if (flight.size) return;
    const open = tasks.filter((task) => !['done', 'skipped'].includes(task.status));
    if (!open.length) {
      await this.finish(mission, tasks);
      return;
    }
    const latest = await this.db.tasks.listForMission(missionId);
    if (!readyTasks(latest).length && !latest.some((task) => task.status === 'running')) {
      const [rejection] = blockingRejections(latest);
      await this.setStatus(mission, 'paused', rejection
        ? `"${rejection.title}" foi reprovada, e o que vem depois depende dela. Abra a tarefa e escolha Tentar de novo ou Pular.`
        : 'Há tarefas bloqueadas por outras que não terminaram. Tente de novo ou pule a tarefa com problema.');
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
      let cwd: string | undefined;
      if (mission.isolation === 'worktree' && mission.integrationBranch) {
        const projectPath = await this.projectPath(mission);
        const workspace = await gitOps.createTaskWorktree(projectPath, this.config.dataDir, mission.id, task.id, mission.integrationBranch);
        this.workspaces.set(task.id, workspace);
        cwd = workspace.dir;
        if (task.mergeFrom) await gitOps.startConflictingMerge(workspace.dir, task.mergeFrom);
      }
      const memory = await this.memory.promptBlock(mission.projectId);
      run = await this.runs.create(
        { agentId: task.assigneeId, projectId: mission.projectId, prompt: taskPrompt(mission, task, tasks, memory) },
        { missionId: mission.id, taskId: task.id, cwd },
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

    const integrated = run.status === 'completed' ? await this.integrate(mission, task) : true;
    if (run.status !== 'completed') await this.dropWorkspace(mission, task);

    if (!integrated) {
      // O conflito virou uma nova tarefa. Esta acabou, mas o que depende dela espera.
    } else if (run.status === 'completed') {
      await this.onTaskCompleted(mission, task, run);
    } else if (run.status === 'cancelled') {
      // Em uma pausa a tarefa volta para a fila; em um cancelamento, fica cancelada.
      const current = await this.requireMission(missionId);
      task.status = current.status === 'cancelled' ? 'cancelled' : 'pending';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: task.status, agentName: task.assigneeName, runId: run.id });
    } else {
      await this.onTaskFailed(mission, task, run);
    }
    const latest = await this.requireMission(missionId);
    if (latest.status === 'running') await this.advance(missionId);
    else this.notifyIfIdle(missionId, latest.status);
  }

  private async dropWorkspace(mission: Mission, task: Task): Promise<void> {
    const workspace = this.workspaces.get(task.id);
    if (!workspace) return;
    this.workspaces.delete(task.id);
    await gitOps.removeTaskWorktree(await this.projectPath(mission), workspace.dir, workspace.branch).catch(() => undefined);
  }

  /** Leva o trabalho isolado para o ramo da missão. Devolve false em caso de conflito. */
  private async integrate(mission: Mission, task: Task): Promise<boolean> {
    const workspace = this.workspaces.get(task.id);
    if (!workspace || !mission.integrationBranch) return true;
    const projectPath = await this.projectPath(mission);
    const committed = await gitOps.commitAll(workspace.dir, `${task.assigneeName}: ${task.title}`);
    if (committed) {
      const changed = await gitOps.changedFilesBetween(projectPath, mission.integrationBranch, workspace.branch);
      task.filesChanged = [...new Set([...task.filesChanged, ...changed])];
    }
    if (!committed) {
      await this.dropWorkspace(mission, task);
      return true;
    }
    const integration = gitOps.integrationPath(this.config.dataDir, mission.id);
    const result = await gitOps.merge(integration, workspace.branch, `Integra: ${task.title}`);
    if (result.ok) {
      await this.dropWorkspace(mission, task);
      return true;
    }

    // Duas tarefas mexeram no mesmo ponto. Ninguém é sobrescrito: quem fez a última
    // resolve o conflito, em uma pasta nova, com as marcações no arquivo.
    this.workspaces.delete(task.id);
    await gitOps.git(projectPath, ['worktree', 'remove', '--force', workspace.dir]).catch(() => undefined);
    const tasks = await this.db.tasks.listForMission(mission.id);
    const following = tasks.map((item) => item.position).filter((position) => position > task.position);
    const resolver: Task = {
      ...task,
      id: newId('task'),
      position: task.position + ((following.length ? Math.min(...following) : task.position + 1) - task.position) / 2,
      title: `Resolver conflito: ${task.title}`,
      description: `Integrar o trabalho de "${task.title}" com o que outros agentes já entregaram. Arquivos em conflito: ${result.conflicts.join(', ')}.`,
      status: 'pending',
      dependsOn: [],
      attempts: 0,
      isFix: true,
      type: 'work',
      verdict: null,
      result: null,
      errorKind: null,
      errorText: null,
      startedAt: null,
      endedAt: null,
      runIf: 'always',
      maxAttempts: null,
      mergeFrom: workspace.branch,
      approvedAt: Date.now(),
      handovers: [],
    };
    await this.db.tasks.insert(resolver);
    this.hub.publish({ kind: 'task_updated', data: resolver });
    for (const other of tasks) {
      if (other.dependsOn.includes(task.id)) {
        other.dependsOn = [...other.dependsOn, resolver.id];
        await this.saveTask(other);
      }
    }
    await this.log(mission, resolver.id, { type: 'conflict', title: task.title, files: result.conflicts, toAgentName: task.assigneeName });
    return this.finishConflictedTask(task);
  }

  private async finishConflictedTask(task: Task): Promise<boolean> {
    task.status = 'done';
    task.result = task.result ?? 'Trabalho concluído, com conflito a resolver.';
    await this.saveTask(task);
    return false;
  }

  private async onDangerousCommand(missionId: string, run: Run, command: string, reason: string, blocked: boolean): Promise<void> {
    const mission = await this.db.missions.get(missionId);
    if (mission) {
      await this.log(mission, run.taskId, { type: 'dangerous_command', agentName: run.agentName, command, reason, blocked });
    }
  }

  private async onTaskCompleted(mission: Mission, task: Task, run: Run): Promise<void> {
    const text = run.finalText ?? '';
    task.result = text;
    task.handoff = extractHandoff(text);
    for (const decision of extractDecisions(text)) {
      await this.memory.add(mission.projectId, 'decision', decision, task.assigneeName, mission.id);
    }

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
    // Um fluxo que já trata a reprovação com uma etapa própria segue o desenho dele.
    if (tasks.some((task) => task.dependsOn.includes(review.id) && task.runIf === 'rejected')) return;
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

    // Limite, login, ferramenta ausente ou bloqueio não se resolvem tentando de novo.
    if (run.errorKind === 'limit' || run.errorKind === 'auth' || run.errorKind === 'missing' || run.errorKind === 'blocked') {
      const replacement = run.errorKind === 'limit' ? await this.replacementFor(mission, task) : { agent: null, problem: null };
      if (replacement.agent) {
        await this.handOver(mission, task, replacement.agent);
        return;
      }
      task.status = 'failed';
      await this.saveTask(task);
      await this.log(mission, task.id, { type: 'task_status', title: task.title, status: 'failed', agentName: task.assigneeName, runId: run.id, error: run.errorText });
      const reason = {
        limit: `${task.assigneeName} atingiu o limite de uso da conta.${replacement.problem ? ` ${replacement.problem}` : ''} Espere renovar ou reatribua a tarefa a outro agente.`,
        auth: `A conta de ${task.assigneeName} precisa de login. Faça o login oficial e tente de novo.`,
        missing: `A ferramenta de ${task.assigneeName} não está instalada neste computador.`,
        blocked: `${run.errorText ?? 'Um comando foi bloqueado.'} Decida se a tarefa deve tentar de novo ou ser pulada.`,
      }[run.errorKind];
      await this.setStatus(mission, 'paused', reason, run.errorKind === 'blocked' ? 'failure' : 'account');
      return;
    }

    if (task.attempts < (task.maxAttempts ?? mission.settings.maxAttempts)) {
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

  /** Quem assume a tarefa no limite de uso e, se ninguém puder, o porquê para a pessoa ler. */
  private async replacementFor(mission: Mission, task: Task): Promise<{ agent: Agent | null; problem: string | null }> {
    const current = task.assigneeId ? await this.db.agents.get(task.assigneeId) : null;
    if (!current) return { agent: null, problem: null };
    // A reserva vale uma vez: se ela também atingir o limite, a tarefa não volta para o primeiro.
    if (task.fallbackAgentId && !task.handovers.length) {
      const reserve = await this.db.agents.get(task.fallbackAgentId);
      if (!reserve) return { agent: null, problem: 'A reserva escolhida para esta etapa não existe mais.' };
      const problem = reserveProblem(current, reserve);
      return problem ? { agent: null, problem } : { agent: reserve, problem: null };
    }
    if (!mission.settings.fallbackToOtherProvider) return { agent: null, problem: null };
    const agent = pickFallback(await this.db.tasks.listForMission(mission.id), task, current, await this.missionAgents(mission));
    return agent
      ? { agent, problem: null }
      : { agent: null, problem: 'Ninguém de outro provedor pode assumir: é preciso ter permissão igual ou maior e as mesmas ferramentas, sem revisar o próprio trabalho.' };
  }

  private async handOver(mission: Mission, task: Task, next: Agent): Promise<void> {
    const current = task.assigneeId ? await this.db.agents.get(task.assigneeId) : null;
    await this.log(mission, task.id, {
      type: 'reassigned',
      title: task.title,
      fromAgentName: task.assigneeName,
      toAgentName: next.name,
      reason: task.fallbackAgentId === next.id ? 'limite de uso da conta, reserva escolhida no workflow' : 'limite de uso da conta',
    });
    task.handovers = [...task.handovers, {
      fromAgentName: task.assigneeName,
      fromProvider: current?.provider ?? '',
      toAgentName: next.name,
      toProvider: next.provider,
      at: Date.now(),
    }];
    task.assigneeId = next.id;
    task.assigneeName = next.name;
    task.attempts = 0;
    task.status = 'pending';
    await this.saveTask(task);
  }

  private async finish(mission: Mission, tasks: Task[]): Promise<void> {
    await this.setStatus(mission, 'reporting');
    const facts = factualSummary(tasks);
    let narrative: string | null = null;
    if (mission.coordinatorId && (await this.db.agents.get(mission.coordinatorId))) {
      try {
        const run = await this.runs.create(
          { agentId: mission.coordinatorId, projectId: mission.projectId, prompt: reportPrompt(mission, tasks), permission: 'read' },
          {
            missionId: mission.id,
            ...(mission.isolation === 'worktree' ? { cwd: gitOps.integrationPath(this.config.dataDir, mission.id) } : {}),
          },
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
    if (mission.isolation === 'worktree') {
      const projectPath = await this.projectPath(mission);
      const changed = await gitOps.changedFilesBetween(projectPath, mission.baseBranch!, mission.integrationBranch!);
      if (changed.length) {
        mission.mergeStatus = 'pending';
      } else {
        await gitOps.finishIsolation(projectPath, this.config.dataDir, mission.id, mission.integrationBranch!);
      }
    }
    await this.setStatus(mission, 'completed');
  }

  // -------------------------------------------------------------------------
  // Revisão antes do merge
  // -------------------------------------------------------------------------

  async reviewChanges(id: string): Promise<{ files: string[]; diff: string }> {
    const mission = await this.requireMission(id);
    if (!mission.integrationBranch || !mission.baseBranch) return { files: [], diff: '' };
    const projectPath = await this.projectPath(mission);
    return {
      files: await gitOps.changedFilesBetween(projectPath, mission.baseBranch, mission.integrationBranch),
      diff: await gitOps.diffBetween(projectPath, mission.baseBranch, mission.integrationBranch),
    };
  }

  /** Só aqui o trabalho isolado chega à pasta e ao ramo do usuário. */
  async mergeResult(id: string): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.mergeStatus !== 'pending') throw conflict('Não há resultado aguardando integração.');
      const projectPath = await this.projectPath(mission);
      const status = await gitOps.status(projectPath);
      const blocking = status.changes.filter((change) => change.status !== '?');
      if (blocking.length) {
        throw conflict(`Há alterações sem commit em ${blocking.length} arquivo(s) do projeto. Faça commit ou guarde essas alterações antes de integrar.`, 'dirty_tree');
      }
      if (status.branch !== mission.baseBranch && mission.baseBranch) {
        throw conflict(`O projeto está no ramo ${status.branch}, e a missão começou em ${mission.baseBranch}. Volte para ele antes de integrar.`, 'wrong_branch');
      }
      const files = await gitOps.changedFilesBetween(projectPath, mission.baseBranch!, mission.integrationBranch!);
      const result = await gitOps.merge(projectPath, mission.integrationBranch!, `XinoIA: ${mission.goal.split('\n')[0]?.slice(0, 60)}`);
      if (!result.ok) {
        throw conflict(`A integração tem conflitos em: ${result.conflicts.join(', ')}. O projeto não foi alterado. O ramo ${mission.integrationBranch} continua disponível para você resolver.`, 'merge_conflict');
      }
      await gitOps.finishIsolation(projectPath, this.config.dataDir, mission.id, mission.integrationBranch!);
      mission.mergeStatus = 'merged';
      await this.saveMission(mission);
      await this.log(mission, null, { type: 'merged', into: mission.baseBranch!, files: files.length });
      return mission;
    });
  }

  async discardResult(id: string): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.mergeStatus !== 'pending') throw conflict('Não há resultado aguardando integração.');
      await gitOps.finishIsolation(await this.projectPath(mission), this.config.dataDir, mission.id, mission.integrationBranch!);
      mission.mergeStatus = 'discarded';
      await this.saveMission(mission);
      return mission;
    });
  }

  // -------------------------------------------------------------------------
  // Comandos do usuário
  // -------------------------------------------------------------------------

  /** Para de iniciar tarefas. O que já está rodando termina normalmente. */
  async pause(id: string, reason = 'Pausada pelo usuário.'): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.status !== 'running') throw conflict('A missão não está em execução.');
      await this.setStatus(mission, 'paused', reason, 'waiting');
      return mission;
    });
  }

  async resume(id: string): Promise<Mission> {
    return this.serialize(id, async () => {
      const mission = await this.requireMission(id);
      if (mission.status !== 'paused') throw conflict('A missão não está pausada.');
      if (this.settings.get().executionMode === 'supervised') {
        // Retomar libera a próxima tarefa que está esperando aprovação.
        const [next] = readyTasks(await this.db.tasks.listForMission(id)).filter((task) => !task.approvedAt);
        if (next) {
          next.approvedAt = Date.now();
          await this.saveTask(next);
        }
      }
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
      if (latest.integrationBranch) {
        await gitOps.finishIsolation(await this.projectPath(latest), this.config.dataDir, id, latest.integrationBranch).catch(() => undefined);
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
      task.approvedAt = Date.now();
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

  /** A missão mais recente do projeto, ativa ou não, com o que cada um entregou. */
  async describeLatest(projectId: string): Promise<{ mission: Mission; tasks: Task[] } | null> {
    const [mission] = await this.db.missions.list({ projectId, limit: 1 });
    return mission ? { mission, tasks: await this.db.tasks.listForMission(mission.id) } : null;
  }

  /** Contexto para quem conversa com a equipe durante a missão. */
  async describeActive(projectId: string): Promise<{ mission: Mission; tasks: Task[] } | null> {
    const missions = await this.db.missions.list({ projectId, limit: 5 });
    const mission = missions.find((item) => ACTIVE.includes(item.status));
    return mission ? { mission, tasks: await this.db.tasks.listForMission(mission.id) } : null;
  }
}
