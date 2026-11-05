// Funções puras sobre planos de missão, separadas para serem testadas sem processos.
import type { Agent, Task, Verdict } from '@xinoia/shared';
import { hasPermissionOf, PlanTaskInput, ROLES } from '@xinoia/shared';
import { newId } from '../ids.ts';

export function extractJsonPlan(text: string): { summary?: unknown; tasks: unknown[] } | null {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  const candidates = fences.reverse();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as { tasks?: unknown };
      if (parsed && Array.isArray(parsed.tasks)) return parsed as { summary?: unknown; tasks: unknown[] };
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

/** Devolve as tarefas presas em dependência circular, ou null se não houver. */
export function findCycle(items: Array<{ id: string; dependsOn: string[] }>): string[] | null {
  const remaining = new Map(items.map((item) => [item.id, item.dependsOn]));
  let progressed = true;
  while (progressed && remaining.size) {
    progressed = false;
    for (const [id, deps] of remaining) {
      if (deps.every((dep) => !remaining.has(dep))) {
        remaining.delete(id);
        progressed = true;
      }
    }
  }
  return remaining.size ? [...remaining.keys()] : null;
}

/**
 * Valida o plano e o transforma em tarefas com IDs definitivos. `approved` é o plano
 * que estava na tela: o que ela não edita continua igual em cada tarefa, casada pelo
 * ID, e o tipo escolhido pelo usuário vale.
 */
export function buildTasks(missionId: string, rawTasks: unknown[], agents: Agent[], approved?: Task[]): Task[] {
  if (!rawTasks.length) throw new Error('O plano não tem tarefas.');
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const byName = new Map(agents.map((agent) => [agent.name.toLowerCase(), agent]));

  const parsed = rawTasks.map((raw, index) => {
    const result = PlanTaskInput.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new Error(`Tarefa ${index + 1} inválida: ${issue?.path.join('.')} ${issue?.message}`);
    }
    return { ...result.data, key: result.data.id ?? `t${index + 1}` };
  });

  const keys = new Set<string>();
  for (const task of parsed) {
    if (keys.has(task.key)) throw new Error(`Tarefa repetida: ${task.key}`);
    keys.add(task.key);
  }
  const cycle = findCycle(parsed.map((task) => ({
    id: task.key,
    dependsOn: task.dependsOn.filter((dep) => keys.has(dep) && dep !== task.key),
  })));
  if (cycle) throw new Error(`As tarefas dependem umas das outras em círculo: ${cycle.join(', ')}`);

  const ids = new Map(parsed.map((task) => [task.key, newId('task')]));
  const previous = new Map(approved?.map((task) => [task.id, task]));
  return parsed.map((task, position) => {
    const agent = byId.get(task.assignee) ?? byName.get(task.assignee.toLowerCase());
    if (!agent) throw new Error(`A tarefa "${task.title}" foi atribuída a quem não está na equipe: ${task.assignee}`);
    const kept = previous.get(task.key);
    return {
      id: ids.get(task.key)!,
      missionId,
      position,
      title: task.title,
      description: task.description,
      assigneeId: agent.id,
      assigneeName: agent.name,
      // No plano do coordenador, tarefa de quem revisa sempre devolve veredito, mesmo que ele esqueça.
      type: (approved && task.type) || (ROLES[agent.role].reviews ? 'review' : task.type ?? 'work'),
      priority: task.priority,
      dependsOn: task.dependsOn.filter((dep) => keys.has(dep) && dep !== task.key).map((dep) => ids.get(dep)!),
      status: 'pending',
      round: 0,
      isFix: false,
      attempts: 0,
      verdict: null,
      result: null,
      handoff: null,
      filesChanged: [],
      errorKind: null,
      errorText: null,
      startedAt: null,
      endedAt: null,
      runIf: kept?.runIf ?? 'always',
      maxAttempts: kept?.maxAttempts ?? null,
      mergeFrom: null,
      approvedAt: null,
      fallbackAgentId: kept?.fallbackAgentId ?? null,
      handovers: [],
    };
  });
}

export function parsePlan(missionId: string, text: string, agents: Agent[]): { summary: string | null; tasks: Task[] } {
  const parsed = extractJsonPlan(text);
  if (!parsed) throw new Error('A resposta não trouxe um bloco JSON com "tasks".');
  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null,
    tasks: buildTasks(missionId, parsed.tasks, agents),
  };
}

/** Sequência definida pelo usuário: cada agente recebe o que o anterior entregou. */
export function pipelineTasks(missionId: string, agents: Agent[]): Task[] {
  return buildTasks(missionId, agents.map((agent, index) => ({
    id: `t${index + 1}`,
    title: `Etapa de ${ROLES[agent.role].label.toLowerCase()}`,
    description: 'Faça a sua parte do objetivo da missão, de acordo com o seu papel.',
    assignee: agent.id,
    dependsOn: index ? [`t${index}`] : [],
  })), agents);
}

export function extractHandoff(text: string): string {
  const tagged = text.match(/<handoff>([\s\S]*?)<\/handoff>/i);
  return (tagged?.[1] ?? text).trim().slice(-4000);
}

export function extractVerdict(text: string): Verdict | null {
  const matches = [...text.matchAll(/<verdict>\s*(APROVADO|REPROVADO)\s*<\/verdict>/gi)];
  return (matches.at(-1)?.[1]?.toUpperCase() as Verdict | undefined) ?? null;
}

export function readyTasks(tasks: Task[]): Task[] {
  const finished = new Set(tasks.filter((t) => t.status === 'done' || t.status === 'skipped').map((t) => t.id));
  const rejected = new Set(rejectedReviews(tasks).map((t) => t.id));
  return tasks
    .filter((t) => t.status === 'pending' && t.dependsOn.every((dep) => finished.has(dep)))
    // Uma reprovação não libera o que vem depois: só a correção, ou uma etapa com condição.
    .filter((t) => t.isFix || t.runIf !== 'always' || !t.dependsOn.some((dep) => rejected.has(dep)))
    .sort((a, b) => a.priority - b.priority || a.position - b.position);
}

/** Revisões reprovadas de que alguma tarefa ainda depende. */
export function blockingRejections(tasks: Task[]): Task[] {
  const rejected = rejectedReviews(tasks);
  return rejected.filter((review) => tasks.some((t) => t.status === 'pending' && !t.isFix && t.runIf === 'always' && t.dependsOn.includes(review.id)));
}

function rejectedReviews(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === 'done' && t.verdict === 'REPROVADO');
}

const stripPrefix = (title: string) => title.replace(/^(Corrigir|Revisar de novo): /, '');

/**
 * Depois de uma reprovação, cria a correção e a nova revisão. O que dependia da
 * revisão reprovada passa a depender da nova, então nada segue sem aprovação.
 */
export function addFixRound(tasks: Task[], review: Task, fixer: Agent): { fix: Task; recheck: Task; changed: Task[] } {
  const round = review.round + 1;
  // As novas tarefas entram entre a revisão e a próxima, sem alcançá-la em rodada nenhuma.
  const following = tasks.map((task) => task.position).filter((position) => position > review.position);
  const gap = (following.length ? Math.min(...following) : review.position + 1) - review.position;
  const base = {
    missionId: review.missionId,
    priority: review.priority,
    status: 'pending' as const,
    round,
    attempts: 0,
    verdict: null,
    result: null,
    handoff: null,
    filesChanged: [],
    errorKind: null,
    errorText: null,
    startedAt: null,
    endedAt: null,
    runIf: 'always' as const,
    maxAttempts: null,
    mergeFrom: null,
    approvedAt: null,
    handovers: [],
  };
  const fix: Task = {
    ...base,
    id: newId('task'),
    position: review.position + gap / 3,
    title: `Corrigir: ${stripPrefix(review.title)}`,
    description: `Corrija os problemas apontados na revisão:\n${review.handoff ?? review.result ?? ''}`,
    assigneeId: fixer.id,
    assigneeName: fixer.name,
    type: 'work',
    dependsOn: [review.id],
    isFix: true,
    // A correção é do mesmo trabalho, então a reserva é a dele.
    fallbackAgentId: ancestors(tasks, review).find((task) => task.type === 'work' && task.assigneeId === fixer.id)?.fallbackAgentId ?? null,
  };
  const recheck: Task = {
    ...base,
    id: newId('task'),
    position: review.position + (gap * 2) / 3,
    title: `Revisar de novo: ${stripPrefix(review.title)}`,
    description: review.description,
    assigneeId: review.assigneeId,
    assigneeName: review.assigneeName,
    type: 'review',
    dependsOn: [fix.id],
    isFix: false,
    fallbackAgentId: review.fallbackAgentId,
  };
  const changed: Task[] = [];
  for (const task of tasks) {
    if (task.dependsOn.includes(review.id)) {
      task.dependsOn = task.dependsOn.map((dep) => (dep === review.id ? recheck.id : dep));
      changed.push(task);
    }
  }
  return { fix, recheck, changed };
}

/** Quem deve corrigir: o autor do último trabalho que a revisão recebeu. */
export function findFixerId(tasks: Task[], review: Task): string | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const queue = [...review.dependsOn];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const task = byId.get(id);
    if (!task) continue;
    if (task.type === 'work' && task.assigneeId) return task.assigneeId;
    queue.push(...task.dependsOn);
  }
  return null;
}

/** As tarefas de que esta depende, direta ou indiretamente. */
function ancestors(tasks: Task[], task: Task): Task[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const seen = new Map<string, Task>();
  const queue = [...task.dependsOn];
  while (queue.length) {
    const id = queue.shift()!;
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.set(id, item);
    queue.push(...item.dependsOn);
  }
  return [...seen.values()];
}

/** Quem fez o trabalho não dá o veredito sobre ele, nem assume um trabalho que vai revisar. */
function wouldReviewOwnWork(tasks: Task[], task: Task, agentId: string): boolean {
  if (task.type === 'review') return ancestors(tasks, task).some((item) => item.type === 'work' && item.assigneeId === agentId);
  return tasks.some((item) => item.type === 'review' && item.assigneeId === agentId && ancestors(tasks, item).some((dep) => dep.id === task.id));
}

/**
 * Escolha automática de quem assume, para a opção da missão: a etapa de um workflow
 * pode ter uma reserva definida pela pessoa, que vem antes disto. Sem alguém que
 * consiga fazer o mesmo trabalho, é melhor pausar: um veredito de quem não pode rodar
 * nada é pior do que esperar a conta renovar.
 */
export function pickFallback(tasks: Task[], task: Task, current: Agent, team: Agent[]): Agent | null {
  // Um provedor que já atingiu o limite nesta tarefa não volta, para ela não ficar indo e vindo.
  const exhausted = new Set([current.provider, ...task.handovers.map((item) => item.fromProvider)]);
  const able = team.filter((agent) => agent.profileId
    && !exhausted.has(agent.provider)
    && hasPermissionOf(agent, current)
    && current.toolkitIds.every((id) => agent.toolkitIds.includes(id))
    && !wouldReviewOwnWork(tasks, task, agent.id));
  return able.find((agent) => agent.role === current.role)
    ?? able.find((agent) => ROLES[agent.role].reviews === (task.type === 'review'))
    ?? able[0]
    ?? null;
}
