import type { Agent, Mission, Task, Workflow, WorkflowNode } from '@xinoia/shared';
import { RunWorkflowInput, ROLES, SaveWorkflowInput } from '@xinoia/shared';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import type { Orchestrator } from './orchestrator.ts';
import { findCycle } from './planning.ts';

const node = (
  id: string,
  title: string,
  role: WorkflowNode['role'],
  column: number,
  row: number,
  description: string,
  extra: Partial<WorkflowNode> = {},
): WorkflowNode => ({
  id,
  title,
  description,
  role,
  type: ROLES[role].reviews ? 'review' : 'work',
  runIf: 'always',
  maxAttempts: 2,
  x: column * 280,
  y: row * 150,
  agentId: null,
  ...extra,
});

const line = (...ids: string[]) => ids.slice(1).map((target, index) => ({ source: ids[index]!, target }));

/** Modelos prontos. Não ficam no banco: atualizam junto com o programa. */
export const BUILTIN_WORKFLOWS: Workflow[] = [
  {
    id: 'builtin-software',
    name: 'Desenvolvimento de software',
    description: 'Planejamento, arquitetura, desenvolvimento, testes, revisão e entrega.',
    nodes: [
      node('planejamento', 'Planejamento', 'coordinator', 0, 0, 'Examine o projeto e detalhe o que precisa ser feito, em que ordem, e o que fica de fora.'),
      node('arquitetura', 'Arquitetura', 'architect', 1, 0, 'Defina a estrutura da solução e as decisões técnicas, sem implementar ainda.'),
      node('desenvolvimento', 'Desenvolvimento', 'developer', 2, 0, 'Implemente a solução seguindo a arquitetura definida.'),
      node('testes', 'Testes', 'tester', 2, 1, 'Rode o projeto e os testes, escreva os que faltam e relate o que falhou.'),
      node('revisao', 'Revisão', 'reviewer', 1, 1, 'Revise o código procurando bugs, riscos de segurança e desvios do pedido.'),
      node('entrega', 'Entrega', 'docs', 0, 1, 'Atualize a documentação e descreva como usar o que foi entregue.'),
    ],
    edges: line('planejamento', 'arquitetura', 'desenvolvimento', 'testes', 'revisao', 'entrega'),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-review',
    name: 'Revisão de código',
    description: 'Dois olhares independentes sobre as alterações atuais, com um parecer no fim.',
    nodes: [
      node('qualidade', 'Revisão de qualidade', 'reviewer', 0, 0, 'Revise as alterações atuais procurando bugs reais e problemas de manutenção.'),
      node('seguranca', 'Revisão de segurança', 'reviewer', 0, 1, 'Revise as alterações atuais procurando vulnerabilidades e dados expostos.'),
      node('parecer', 'Parecer final', 'coordinator', 1, 0.5, 'Junte as revisões em um parecer único, em ordem de gravidade. Não altere arquivos.'),
    ],
    edges: [{ source: 'qualidade', target: 'parecer' }, { source: 'seguranca', target: 'parecer' }],
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-bugfix',
    name: 'Correção de bug',
    description: 'Reproduzir, corrigir e confirmar que o problema não volta.',
    nodes: [
      node('reproduzir', 'Reproduzir', 'tester', 0, 0, 'Reproduza o problema descrito no objetivo e explique a causa. Escreva um teste que falhe por causa dele.'),
      node('corrigir', 'Corrigir', 'developer', 1, 0, 'Corrija a causa do problema, sem mudanças não relacionadas.'),
      node('confirmar', 'Confirmar', 'tester', 2, 0, 'Rode os testes e confirme que o problema acabou e que nada mais quebrou.'),
    ],
    edges: line('reproduzir', 'corrigir', 'confirmar'),
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'builtin-analysis',
    name: 'Análise de projeto',
    description: 'Um diagnóstico do projeto, sem alterar nada.',
    nodes: [
      node('estrutura', 'Estrutura', 'architect', 0, 0, 'Descreva a arquitetura, as tecnologias e como as partes se conectam. Não altere arquivos.'),
      node('riscos', 'Riscos', 'reviewer', 0, 1, 'Aponte riscos de segurança, dívidas técnicas e falhas de teste. Não altere arquivos.', { type: 'work' }),
      node('recomendacoes', 'Recomendações', 'coordinator', 1, 0.5, 'Junte as análises em uma lista priorizada do que fazer. Não altere arquivos.'),
    ],
    edges: [{ source: 'estrutura', target: 'recomendacoes' }, { source: 'riscos', target: 'recomendacoes' }],
    builtin: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

function validateGraph(nodes: WorkflowNode[], edges: Array<{ source: string; target: string }>): void {
  const ids = new Set<string>();
  for (const item of nodes) {
    if (ids.has(item.id)) throw badRequest(`Etapa repetida: ${item.id}`);
    ids.add(item.id);
  }
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw badRequest('Uma ligação aponta para uma etapa que não existe.');
  }
  const cycle = findCycle(nodes.map((item) => ({ id: item.id, dependsOn: edges.filter((edge) => edge.target === item.id).map((edge) => edge.source) })));
  if (cycle) throw badRequest(`O fluxo tem um ciclo entre: ${cycle.join(', ')}`, 'workflow_cycle');
}

/** Quem executa cada etapa: o agente escolhido, ou alguém da equipe com aquela função. */
export function assignAgent(item: WorkflowNode, team: Agent[]): Agent {
  if (item.agentId) {
    const chosen = team.find((agent) => agent.id === item.agentId);
    if (chosen) return chosen;
  }
  const exact = team.find((agent) => agent.role === item.role);
  if (exact) return exact;
  const similar: Partial<Record<WorkflowNode['role'], WorkflowNode['role'][]>> = {
    coordinator: ['architect', 'developer'],
    architect: ['coordinator', 'developer', 'backend'],
    frontend: ['developer'],
    backend: ['developer'],
    developer: ['backend', 'frontend', 'unreal'],
    unreal: ['developer'],
    tester: ['reviewer', 'developer'],
    reviewer: ['tester', 'architect'],
    designer: ['frontend', 'developer'],
    docs: ['coordinator', 'developer'],
  };
  for (const role of similar[item.role] ?? []) {
    const found = team.find((agent) => agent.role === role);
    if (found) return found;
  }
  if (team[0]) return team[0];
  throw badRequest('A equipe está vazia. Crie ao menos um agente.', 'no_agents');
}

export function workflowToTasks(workflow: Pick<Workflow, 'nodes' | 'edges'>, missionId: string, team: Agent[]): Task[] {
  const ids = new Map(workflow.nodes.map((item) => [item.id, newId('task')]));
  // Ordem estável para a tela: quem depende vem depois de quem é dependência.
  const ordered: WorkflowNode[] = [];
  const placed = new Set<string>();
  let remaining = [...workflow.nodes];
  while (remaining.length) {
    const ready = remaining.filter((item) => workflow.edges.filter((edge) => edge.target === item.id).every((edge) => placed.has(edge.source)));
    if (!ready.length) throw badRequest('O fluxo tem um ciclo.', 'workflow_cycle');
    for (const item of ready) {
      ordered.push(item);
      placed.add(item.id);
    }
    remaining = remaining.filter((item) => !placed.has(item.id));
  }
  return ordered.map((item, position) => {
    const agent = assignAgent(item, team);
    return {
      id: ids.get(item.id)!,
      missionId,
      position,
      title: item.title,
      description: item.description,
      assigneeId: agent.id,
      assigneeName: agent.name,
      type: item.type,
      priority: 2,
      dependsOn: workflow.edges.filter((edge) => edge.target === item.id).map((edge) => ids.get(edge.source)!),
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
      runIf: item.runIf,
      maxAttempts: item.maxAttempts,
      mergeFrom: null,
      approvedAt: null,
    };
  });
}

export class WorkflowService {
  private readonly db: Persistence;
  private readonly orchestrator: Orchestrator;

  constructor(db: Persistence, orchestrator: Orchestrator) {
    this.db = db;
    this.orchestrator = orchestrator;
  }

  async list(): Promise<Workflow[]> {
    return [...BUILTIN_WORKFLOWS, ...(await this.db.workflows.list())];
  }

  async get(id: string): Promise<Workflow> {
    const workflow = BUILTIN_WORKFLOWS.find((item) => item.id === id) ?? (await this.db.workflows.get(id));
    if (!workflow) throw notFound('Workflow');
    return workflow;
  }

  async create(input: unknown): Promise<Workflow> {
    const data = SaveWorkflowInput.parse(input);
    validateGraph(data.nodes, data.edges);
    const now = Date.now();
    const workflow: Workflow = { id: newId('flow'), ...data, builtin: false, createdAt: now, updatedAt: now };
    await this.db.workflows.insert(workflow);
    return workflow;
  }

  async update(id: string, input: unknown): Promise<Workflow> {
    if (BUILTIN_WORKFLOWS.some((item) => item.id === id)) throw conflict('Este é um modelo pronto. Salve uma cópia para alterar.', 'builtin_workflow');
    const current = await this.db.workflows.get(id);
    if (!current) throw notFound('Workflow');
    const data = SaveWorkflowInput.parse(input);
    validateGraph(data.nodes, data.edges);
    const workflow: Workflow = { ...current, ...data, updatedAt: Date.now() };
    await this.db.workflows.update(workflow);
    return workflow;
  }

  async remove(id: string): Promise<void> {
    if (BUILTIN_WORKFLOWS.some((item) => item.id === id)) throw conflict('Modelos prontos não podem ser apagados.', 'builtin_workflow');
    await this.db.workflows.delete(id);
  }

  async run(id: string, input: unknown): Promise<Mission> {
    const data = RunWorkflowInput.parse(input);
    const workflow = await this.get(id);
    validateGraph(workflow.nodes, workflow.edges);
    return this.orchestrator.startFromWorkflow(workflow, data.projectId, data.goal, data.settings);
  }
}
