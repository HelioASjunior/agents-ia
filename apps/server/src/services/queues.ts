import type { GoalQueue, Mission, QueueItem } from '@xinoia/shared';
import { AddQueueItemsInput, ReorderQueueInput, SaveQueueInput, UpdateQueueItemInput } from '@xinoia/shared';
import { conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { redact } from '../security/redact.ts';
import type { EventHub } from '../ws/hub.ts';
import * as gitOps from './git.ts';
import { KeyedQueue } from './keyed-queue.ts';
import type { Orchestrator, PauseKind } from './orchestrator.ts';
import type { WorkflowService } from './workflows.ts';

const TERMINAL: Mission['status'][] = ['completed', 'failed', 'cancelled'];
const FINISHED: QueueItem['status'][] = ['done', 'failed'];

/** O consumo precisa somar todas as execuções da missão, então o limite fica bem acima do real. */
const MAX_RUNS_PER_MISSION = 10_000;

const tokensOf = (queue: GoalQueue): number => queue.items.reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);

const branchFor = (goal: string): string => {
  const slug = goal.split('\n')[0]!.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  return `xinoia/falhou/${slug || 'objetivo'}`;
};

/** A nova tentativa precisa saber o que a anterior deixou, já que começa de outra branch. */
const goalOf = (item: QueueItem): string => (item.savedBranches.length
  ? `${item.goal}\n\nUma tentativa anterior deste objetivo falhou, e o que ela fez está fora da branch atual, em: ${item.savedBranches.join(', ')}. Confira com o Git antes de refazer, e aproveite o que servir.`
  : item.goal);

/**
 * Executa um workflow para cada objetivo, em ordem. Quem decide o trabalho continua
 * sendo o orquestrador, com as regras do modo de execução: a fila só escolhe quando
 * começar o próximo e nunca dispensa uma aprovação que o modo exige.
 */
export class QueueService {
  private readonly db: Persistence;
  private readonly orchestrator: Orchestrator;
  private readonly workflows: WorkflowService;
  private readonly hub: EventHub;
  /** Decisões de uma fila acontecem uma por vez, para nenhum objetivo começar duas vezes. */
  private readonly locks = new KeyedQueue();

  constructor(db: Persistence, orchestrator: Orchestrator, workflows: WorkflowService, hub: EventHub) {
    this.db = db;
    this.orchestrator = orchestrator;
    this.workflows = workflows;
    this.hub = hub;
  }

  private async serialize<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const release = await this.locks.acquire([projectId]);
    try {
      return await work();
    } finally {
      release();
    }
  }

  private async persist(queue: GoalQueue): Promise<GoalQueue> {
    queue.updatedAt = Date.now();
    await this.db.queues.save(queue);
    this.hub.publish({ kind: 'queue_updated', data: structuredClone(queue) });
    return queue;
  }

  private async require(projectId: string): Promise<GoalQueue> {
    const queue = await this.db.queues.getForProject(projectId);
    if (!queue) throw notFound('Fila');
    return queue;
  }

  private requireItem(queue: GoalQueue, itemId: string): QueueItem {
    const item = queue.items.find((entry) => entry.id === itemId);
    if (!item) throw notFound('Objetivo');
    return item;
  }

  private requirePending(queue: GoalQueue, itemId: string): QueueItem {
    const item = this.requireItem(queue, itemId);
    if (item.status !== 'pending') throw conflict('Só um objetivo que ainda não começou pode ser alterado.');
    return item;
  }

  get(projectId: string): Promise<GoalQueue | null> {
    return this.db.queues.getForProject(projectId);
  }

  async save(projectId: string, input: unknown): Promise<GoalQueue> {
    const data = SaveQueueInput.parse(input);
    return this.serialize(projectId, async () => {
      if (!(await this.db.projects.get(projectId))) throw notFound('Projeto');
      await this.workflows.get(data.workflowId);
      const now = Date.now();
      const queue = (await this.db.queues.getForProject(projectId)) ?? {
        id: newId('queue'),
        projectId,
        startBranch: null,
        running: false,
        stopReason: null,
        items: [],
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      return this.persist({ ...queue, ...data });
    });
  }

  async addItems(projectId: string, input: unknown): Promise<GoalQueue> {
    const { goals } = AddQueueItemsInput.parse(input);
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      let position = Math.max(0, ...queue.items.map((item) => item.position));
      for (const goal of goals) {
        position += 1;
        queue.items.push({
          id: newId('goal'),
          position,
          goal: redact(goal),
          status: 'pending',
          missionId: null,
          reason: null,
          savedBranches: [],
          inputTokens: 0,
          outputTokens: 0,
          runsWithoutUsage: 0,
          createdAt: Date.now(),
          startedAt: null,
          endedAt: null,
        });
      }
      return this.persist(queue);
    });
  }

  async updateItem(projectId: string, itemId: string, input: unknown): Promise<GoalQueue> {
    const { goal } = UpdateQueueItemInput.parse(input);
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      this.requirePending(queue, itemId).goal = redact(goal);
      return this.persist(queue);
    });
  }

  async removeItem(projectId: string, itemId: string): Promise<GoalQueue> {
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      if (this.requireItem(queue, itemId).status === 'running') throw conflict('Este objetivo está em andamento. Cancele a missão dele antes de remover.');
      queue.items = queue.items.filter((item) => item.id !== itemId);
      return this.persist(queue);
    });
  }

  /** Muda a ordem do que ainda não começou. O que já começou fica onde está. */
  async reorder(projectId: string, input: unknown): Promise<GoalQueue> {
    const { itemIds } = ReorderQueueInput.parse(input);
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      const pending = queue.items.filter((item) => item.status === 'pending');
      if (itemIds.length !== pending.length || new Set(itemIds).size !== itemIds.length) {
        throw conflict('A lista mudou enquanto você reordenava. Tente de novo.');
      }
      const slots = pending.map((item) => item.position);
      itemIds.forEach((id, index) => {
        this.requirePending(queue, id).position = slots[index]!;
      });
      queue.items.sort((a, b) => a.position - b.position);
      return this.persist(queue);
    });
  }

  /** Um objetivo que falhou volta para a fila no lugar dele, e o consumo já gasto continua contando. */
  async requeue(projectId: string, itemId: string): Promise<GoalQueue> {
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      const item = this.requireItem(queue, itemId);
      if (item.status !== 'failed') throw conflict('Só um objetivo que falhou pode voltar para a fila.');
      item.status = 'pending';
      item.reason = null;
      item.startedAt = null;
      item.endedAt = null;
      return this.persist(queue);
    });
  }

  async clearFinished(projectId: string): Promise<GoalQueue> {
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      queue.items = queue.items.filter((item) => !FINISHED.includes(item.status));
      return this.persist(queue);
    });
  }

  async start(projectId: string): Promise<GoalQueue> {
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      // Com um objetivo em andamento, a pasta pode estar na branch que ele abriu.
      if (!queue.items.some((item) => item.status === 'running')) {
        const project = await this.db.projects.get(projectId);
        queue.startBranch = project ? await gitOps.currentHead(project.path) : null;
      }
      queue.running = true;
      queue.stopReason = null;
      await this.advance(queue);
      return queue;
    });
  }

  /** Não inicia mais nada. O objetivo em andamento termina normalmente. */
  async stop(projectId: string): Promise<GoalQueue> {
    return this.serialize(projectId, async () => {
      const queue = await this.require(projectId);
      queue.running = false;
      queue.stopReason = null;
      return this.persist(queue);
    });
  }

  private halt(queue: GoalQueue, reason: string): Promise<GoalQueue> {
    queue.running = false;
    queue.stopReason = reason;
    return this.persist(queue);
  }

  /** O que impede o próximo objetivo de começar, em palavras para a pessoa. */
  private async blocker(queue: GoalQueue): Promise<string | null> {
    if (queue.tokenLimit !== null) {
      const unknown = queue.items.reduce((sum, item) => sum + item.runsWithoutUsage, 0);
      if (unknown) {
        return `O limite de gasto não pôde ser aplicado: ${unknown} execução(ões) não informaram consumo. Tire o limite para continuar sem ele.`;
      }
      if (tokensOf(queue) >= queue.tokenLimit) {
        return `Limite de gasto atingido: ${tokensOf(queue)} de ${queue.tokenLimit} tokens. Aumente o limite ou limpe os objetivos concluídos para continuar.`;
      }
    }
    const project = await this.db.projects.get(queue.projectId);
    if (!project) throw notFound('Projeto');
    const { isRepo, changes } = await gitOps.status(project.path);
    if (isRepo && changes.length) {
      const names = changes.slice(0, 3).map((change) => change.path).join(', ');
      return `Há ${changes.length} arquivo(s) sem commit no projeto (${names}${changes.length > 3 ? ', ...' : ''}). Faça commit ou guarde essas alterações, e continue a fila.`;
    }
    return null;
  }

  private async advance(queue: GoalQueue): Promise<void> {
    if (!queue.running) {
      await this.persist(queue);
      return;
    }
    if (queue.items.some((item) => item.status === 'running')) {
      await this.persist(queue);
      return;
    }
    const next = queue.items.find((item) => item.status === 'pending');
    if (!next) {
      queue.running = false;
      await this.persist(queue);
      return;
    }

    try {
      const reason = await this.blocker(queue);
      if (reason) {
        await this.halt(queue, reason);
        return;
      }
      // O ID da missão é gravado antes dela existir: se o app fechar agora, a
      // recuperação sabe se este objetivo chegou a começar.
      const missionId = newId('mission');
      next.status = 'running';
      next.missionId = missionId;
      next.reason = null;
      next.startedAt = Date.now();
      next.endedAt = null;
      await this.persist(queue);
      // autoApprove só vale no modo autônomo: o orquestrador desliga nos outros.
      await this.workflows.run(queue.workflowId, {
        projectId: queue.projectId,
        goal: goalOf(next),
        settings: { concurrency: 1, autoApprove: true },
      }, missionId);
    } catch (error) {
      next.status = 'pending';
      next.missionId = null;
      next.startedAt = null;
      await this.halt(queue, error instanceof Error ? error.message : String(error));
    }
  }

  private async settleItem(item: QueueItem, status: 'done' | 'failed', reason: string | null): Promise<void> {
    item.status = status;
    item.reason = reason;
    item.endedAt = Date.now();
    const runs = await this.db.runs.list({ missionId: item.missionId!, limit: MAX_RUNS_PER_MISSION });
    for (const run of runs) {
      if (run.usage) {
        item.inputTokens += run.usage.inputTokens;
        item.outputTokens += run.usage.outputTokens;
      } else {
        item.runsWithoutUsage += 1;
      }
    }
  }

  /** Deixa a pasta pronta para o próximo objetivo, sem apagar nada. Devolve false se a fila precisou parar. */
  private async saveWork(queue: GoalQueue, item: QueueItem): Promise<boolean> {
    const stop = async (reason: string) => {
      await this.halt(queue, `O trabalho deste objetivo não foi guardado, e nada foi apagado: ${reason}`);
      return false;
    };
    const project = await this.db.projects.get(queue.projectId);
    if (!project) throw notFound('Projeto');
    if (!(await gitOps.isGitRepo(project.path))) return stop('este projeto não usa Git.');
    const back = queue.startBranch ?? (await gitOps.currentHead(project.path));
    if (!back) return stop('o projeto ainda não tem nenhum commit.');
    try {
      const saved = await gitOps.saveWorkToBranch(project.path, branchFor(item.goal), back, `XinoIA: trabalho de um objetivo que falhou: ${item.goal.split('\n')[0]!.slice(0, 60)}`);
      if (saved.branch) item.savedBranches.push(saved.branch);
      if (saved.returnError) {
        await this.halt(queue, `O trabalho ficou na branch ${saved.branch}, mas a fila não conseguiu voltar para ${back}: ${saved.returnError} Resolva isso, volte para ${back} e continue a fila.`);
        return false;
      }
      return true;
    } catch (error) {
      return stop(error instanceof Error ? error.message : String(error));
    }
  }

  private async onMissionStopped(mission: Mission, pause: PauseKind): Promise<void> {
    await this.serialize(mission.projectId, async () => {
      const queue = await this.db.queues.getForProject(mission.projectId);
      const item = queue?.items.find((entry) => entry.status === 'running' && entry.missionId === mission.id);
      if (!queue || !item) return;

      if (mission.status === 'paused') {
        // Pular não resolve limite nem login: o próximo objetivo bateria no mesmo problema.
        // Nos outros casos, a missão espera a pessoa na tela dela, e a fila espera a missão.
        if (queue.onFailure === 'stop' || pause === 'account' || !queue.running) return;
        await this.settleItem(item, 'failed', mission.pauseReason);
        await this.persist(queue);
        await this.orchestrator.cancel(mission.id);
        if (queue.onFailure === 'branch' && !(await this.saveWork(queue, item))) return;
        await this.advance(queue);
        return;
      }

      if (mission.status === 'completed') {
        await this.settleItem(item, 'done', null);
      } else if (mission.status === 'cancelled') {
        await this.settleItem(item, 'failed', 'A missão foi cancelada.');
        await this.halt(queue, 'Um objetivo foi cancelado, então a fila parou. Continue quando quiser.');
        return;
      } else {
        await this.settleItem(item, 'failed', mission.pauseReason);
        if (queue.onFailure === 'stop') {
          await this.halt(queue, `Um objetivo falhou: ${mission.pauseReason ?? 'erro desconhecido'}`);
          return;
        }
        if (queue.onFailure === 'branch' && !(await this.saveWork(queue, item))) return;
      }
      await this.advance(queue);
    });
  }

  /**
   * O app fechou no meio: como nas missões, nada novo começa sem o usuário. Uma missão
   * pausada pela recuperação continua sendo a vez dele, e a fila segue quando ela terminar.
   * Só depois disso a fila passa a ouvir as missões, para as pausas da recuperação não contarem.
   */
  async recover(): Promise<void> {
    for (const queue of await this.db.queues.list()) {
      let waiting = false;
      for (const item of queue.items.filter((entry) => entry.status === 'running')) {
        const mission = item.missionId ? await this.db.missions.get(item.missionId) : null;
        if (!mission) {
          item.status = 'pending';
          item.missionId = null;
          item.startedAt = null;
        } else if (!TERMINAL.includes(mission.status)) {
          waiting = true;
        } else if (mission.status === 'completed') {
          await this.settleItem(item, 'done', null);
        } else {
          await this.settleItem(item, 'failed', mission.pauseReason ?? 'A missão foi cancelada.');
        }
      }
      if (queue.running && !waiting) {
        queue.running = false;
        queue.stopReason = 'O XinoIA foi fechado com a fila em andamento. Continue quando quiser.';
      }
      await this.db.queues.save(queue);
    }
    this.orchestrator.onMissionStopped = (mission, pause) => {
      void this.onMissionStopped(mission, pause).catch(async (error) => {
        const queue = await this.db.queues.getForProject(mission.projectId);
        if (queue) await this.halt(queue, error instanceof Error ? error.message : String(error));
      });
    };
  }
}
