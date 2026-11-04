import os from 'node:os';
import type { Metrics, TimelineItem } from '@xinoia/shared';
import type { Persistence } from '../persistence/types.ts';
import type { AgentStateService } from './agent-state.ts';

let lastCpu = os.cpus();

/** Uso de CPU desde a leitura anterior, de 0 a 1. */
function cpuUsage(): number | null {
  const current = os.cpus();
  let idle = 0;
  let total = 0;
  current.forEach((cpu, index) => {
    const before = lastCpu[index];
    if (!before) return;
    for (const key of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      const delta = cpu.times[key] - before.times[key];
      total += delta;
      if (key === 'idle') idle += delta;
    }
  });
  lastCpu = current;
  return total > 0 ? 1 - idle / total : null;
}

export class MetricsService {
  private readonly db: Persistence;
  private readonly agentState: AgentStateService;

  constructor(db: Persistence, agentState: AgentStateService) {
    this.db = db;
    this.agentState = agentState;
  }

  async read(projectId?: string): Promise<Metrics> {
    const counts = await this.db.metrics.counts(projectId);
    const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);
    const agents = await this.db.agents.list();
    const active = this.agentState.snapshot().filter((state) => ['thinking', 'executing', 'reviewing'].includes(state.activity));
    const memory = process.memoryUsage();
    return {
      agents: { total: agents.length, active: active.length },
      runs: {
        total: sum(counts.runs),
        running: counts.runs.running ?? 0,
        queued: counts.runs.queued ?? 0,
        completed: counts.runs.completed ?? 0,
        failed: counts.runs.failed ?? 0,
        cancelled: counts.runs.cancelled ?? 0,
        interrupted: counts.runs.interrupted ?? 0,
      },
      tasks: {
        total: sum(counts.tasks),
        running: counts.tasks.running ?? 0,
        done: counts.tasks.done ?? 0,
        failed: counts.tasks.failed ?? 0,
        pending: counts.tasks.pending ?? 0,
      },
      missions: {
        total: sum(counts.missions),
        active: ['planning', 'awaiting_approval', 'running', 'paused', 'reporting'].reduce((total, key) => total + (counts.missions[key] ?? 0), 0),
        completed: counts.missions.completed ?? 0,
        failed: counts.missions.failed ?? 0,
      },
      tokens: counts.tokens,
      averageRunMs: counts.averageRunMs,
      system: {
        platform: process.platform,
        cpuCount: os.cpus().length,
        cpuUsage: cpuUsage(),
        memoryTotal: os.totalmem(),
        memoryFree: os.freemem(),
        processMemory: memory.rss,
        uptimeSeconds: Math.round(process.uptime()),
      },
    };
  }

  /** Linha do tempo real: execuções e missões, das mais recentes para as mais antigas. */
  async timeline(projectId?: string, limit = 60): Promise<TimelineItem[]> {
    const [runs, missions] = await Promise.all([
      this.db.runs.list({ projectId, limit }),
      this.db.missions.list({ projectId, limit: 20 }),
    ]);
    const items: TimelineItem[] = [
      ...runs.map((run): TimelineItem => ({
        id: run.id,
        ts: run.startedAt ?? run.queuedAt,
        kind: 'run',
        title: run.agentName,
        detail: run.errorText?.split('\n')[0] ?? run.prompt.slice(0, 140),
        status: run.status,
      })),
      ...missions.map((mission): TimelineItem => ({
        id: mission.id,
        ts: mission.createdAt,
        kind: 'mission',
        title: 'Missão',
        detail: mission.goal.slice(0, 140),
        status: mission.status,
      })),
    ];
    return items.sort((a, b) => b.ts - a.ts).slice(0, limit);
  }
}
