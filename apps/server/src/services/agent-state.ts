import type { AgentActivity, AgentEvent, AgentLiveState, Run, ServerMessage, Task } from '@xinoia/shared';
import type { EventHub } from '../ws/hub.ts';

const FINISHED_MS = 8000;
const ERROR_MS = 20_000;

/**
 * Deriva o que cada agente está fazendo a partir dos eventos das execuções. É daqui
 * que vêm os estados do escritório, então nenhum deles é uma animação inventada.
 */
export class AgentStateService {
  private readonly states = new Map<string, AgentLiveState>();
  private readonly runAgents = new Map<string, Run>();
  private readonly reviewTasks = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly hub: EventHub;
  private readonly unsubscribe: () => void;

  constructor(hub: EventHub) {
    this.hub = hub;
    this.unsubscribe = hub.subscribe((message) => this.onMessage(message));
  }

  snapshot(): AgentLiveState[] {
    return [...this.states.values()];
  }

  close(): void {
    this.unsubscribe();
    for (const timer of this.timers.values()) clearTimeout(timer);
  }

  private set(agentId: string, activity: AgentActivity, detail: string | null, run: Run | null, expireMs?: number): void {
    clearTimeout(this.timers.get(agentId));
    const previous = this.states.get(agentId);
    const state: AgentLiveState = {
      agentId,
      activity,
      detail,
      runId: run?.id ?? null,
      taskId: run?.taskId ?? null,
      missionId: run?.missionId ?? null,
      since: previous?.activity === activity ? previous.since : Date.now(),
    };
    this.states.set(agentId, state);
    this.hub.publish({ kind: 'agent_state', data: state });
    if (expireMs) {
      const timer = setTimeout(() => this.set(agentId, 'available', null, null), expireMs);
      timer.unref();
      this.timers.set(agentId, timer);
    }
  }

  private working(run: Run): AgentActivity {
    return run.taskId && this.reviewTasks.has(run.taskId) ? 'reviewing' : 'executing';
  }

  private onMessage(message: ServerMessage): void {
    switch (message.kind) {
      case 'task_updated':
        this.onTask(message.data);
        break;
      case 'run_updated':
        this.onRun(message.data);
        break;
      case 'run_event': {
        const run = this.runAgents.get(message.data.runId);
        if (run?.agentId) this.onEvent(run, message.data.event);
        break;
      }
      default:
        break;
    }
  }

  private onTask(task: Task): void {
    if (task.type === 'review') this.reviewTasks.add(task.id);
  }

  private onRun(run: Run): void {
    if (!run.agentId) return;
    switch (run.status) {
      case 'queued':
        this.runAgents.set(run.id, run);
        // Quem está ocupado continua mostrando o trabalho atual, não a fila seguinte.
        if (!this.isBusy(run.agentId)) this.set(run.agentId, 'waiting', 'Na fila', run);
        break;
      case 'running':
        this.runAgents.set(run.id, run);
        if (this.states.get(run.agentId)?.runId !== run.id) this.set(run.agentId, 'thinking', 'Começando', run);
        break;
      case 'completed':
        this.runAgents.delete(run.id);
        this.set(run.agentId, 'finished', null, run, FINISHED_MS);
        break;
      case 'failed':
        this.runAgents.delete(run.id);
        this.set(run.agentId, 'error', run.errorText?.split('\n')[0]?.slice(0, 200) ?? 'Falhou', run, ERROR_MS);
        break;
      default:
        this.runAgents.delete(run.id);
        this.set(run.agentId, 'available', null, null);
        break;
    }
  }

  private isBusy(agentId: string): boolean {
    const state = this.states.get(agentId);
    return state?.activity === 'thinking' || state?.activity === 'executing' || state?.activity === 'reviewing';
  }

  private onEvent(run: Run, event: AgentEvent): void {
    const agentId = run.agentId!;
    switch (event.type) {
      case 'thinking':
        this.set(agentId, 'thinking', 'Pensando', run);
        break;
      case 'text':
        this.set(agentId, this.working(run), 'Escrevendo', run);
        break;
      case 'tool_start':
        this.set(agentId, this.working(run), event.summary, run);
        break;
      case 'tool_end':
        this.set(agentId, 'thinking', 'Analisando o resultado', run);
        break;
      default:
        break;
    }
  }
}
