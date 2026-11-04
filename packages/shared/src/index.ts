import { z } from 'zod';

export const PRODUCT_NAME = 'XinoIA';

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------

export const PermissionLevel = z.enum(['read', 'edit', 'full']);
export type PermissionLevel = z.infer<typeof PermissionLevel>;

// ---------------------------------------------------------------------------
// Papéis
// ---------------------------------------------------------------------------

export const RoleId = z.enum([
  'coordinator',
  'architect',
  'developer',
  'frontend',
  'backend',
  'unreal',
  'reviewer',
  'tester',
  'designer',
  'docs',
  'custom',
]);
export type RoleId = z.infer<typeof RoleId>;

export interface RoleDefinition {
  label: string;
  title: string;
  prompt: string;
  /** A tarefa deste papel devolve um veredito, que pode mandar o trabalho de volta. */
  reviews: boolean;
}

export const ROLES: Record<RoleId, RoleDefinition> = {
  coordinator: {
    label: 'Coordenação',
    title: 'Coordenador(a) técnico(a)',
    reviews: false,
    prompt: 'Você entende o objetivo, divide o trabalho, escolhe quem faz cada parte e consolida as entregas.',
  },
  architect: {
    label: 'Arquitetura',
    title: 'Arquiteto(a) de software',
    reviews: false,
    prompt: 'Você define a estrutura da solução e registra decisões técnicas com clareza. Prefere o desenho mais simples que resolva o problema.',
  },
  developer: {
    label: 'Desenvolvimento',
    title: 'Desenvolvedor(a)',
    reviews: false,
    prompt: 'Você implementa as funcionalidades seguindo o padrão já usado no projeto e confere se o código roda antes de entregar.',
  },
  frontend: {
    label: 'Frontend',
    title: 'Desenvolvedor(a) frontend',
    reviews: false,
    prompt: 'Você cuida de interface, acessibilidade e responsividade, com atenção aos estados de carregamento, vazio e erro.',
  },
  backend: {
    label: 'Backend',
    title: 'Desenvolvedor(a) backend',
    reviews: false,
    prompt: 'Você cuida de APIs, dados e regras de negócio, com atenção a validação, segurança e tratamento de erros.',
  },
  unreal: {
    label: 'Unreal Engine',
    title: 'Desenvolvedor(a) Unreal Engine',
    reviews: false,
    prompt: 'Você trabalha com C++, Blueprints e as ferramentas do editor Unreal. Use as skills e o MCP do Unreal quando estiverem disponíveis. Se o editor estiver fechado, avise em vez de presumir que as ferramentas funcionaram, e confirme cada alteração com uma consulta.',
  },
  reviewer: {
    label: 'Revisão de código',
    title: 'Revisor(a) de código e segurança',
    reviews: true,
    prompt: 'Você revisa o trabalho procurando bugs reais, riscos de segurança e desvios do pedido. Aponte arquivo e linha, e não reprove por questão de gosto.',
  },
  tester: {
    label: 'Testes',
    title: 'Engenheiro(a) de testes',
    reviews: true,
    prompt: 'Você valida o comportamento rodando o projeto e os testes, escreve os testes que faltam e relata exatamente o que falhou e como reproduzir.',
  },
  designer: {
    label: 'Design',
    title: 'Designer de produto',
    reviews: false,
    prompt: 'Você define fluxos, textos e aparência, com especificações claras o bastante para quem vai implementar.',
  },
  docs: {
    label: 'Documentação',
    title: 'Redator(a) técnico(a)',
    reviews: false,
    prompt: 'Você escreve documentação objetiva, com exemplos que funcionam de verdade.',
  },
  custom: {
    label: 'Personalizado',
    title: 'Especialista',
    reviews: false,
    prompt: '',
  },
};

// ---------------------------------------------------------------------------
// Entradas validadas da API
// ---------------------------------------------------------------------------

const name = z.string().trim().min(1).max(80);
/** Modelo e esforço viram argumento de linha de comando, por isso o formato restrito. */
const cliToken = z.string().trim().regex(/^[\w.:\-[\]/]+$/, 'Valor com caracteres não permitidos.').max(120);

export const CreateProfileInput = z.object({
  provider: z.string().min(1),
  label: name,
  /** Usa o login já existente no computador em vez de criar uma pasta isolada. */
  useSystemDefault: z.boolean().default(false),
});
export type CreateProfileInput = z.input<typeof CreateProfileInput>;

export const UpdateProfileInput = z.object({ label: name });

export const CreateAgentInput = z.object({
  name,
  role: RoleId.default('developer'),
  roleTitle: z.string().trim().max(80).nullish(),
  instructions: z.string().max(8000).nullish(),
  provider: z.string().min(1),
  profileId: z.string().nullish(),
  model: cliToken.nullish().or(z.literal('')),
  effort: cliToken.nullish().or(z.literal('')),
  permission: PermissionLevel.default('edit'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#5B8DEF'),
  toolkitIds: z.array(z.string()).default([]),
});
export type CreateAgentInput = z.input<typeof CreateAgentInput>;

export const UpdateAgentInput = CreateAgentInput.partial();

export const CreateProjectInput = z.object({
  name: name.optional(),
  path: z.string().trim().min(1),
  /** Cria a pasta se ela ainda não existir. */
  create: z.boolean().default(false),
});
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

export const CreateRunInput = z.object({
  agentId: z.string().min(1),
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(500_000),
  /** Continua a conversa anterior deste agente neste projeto. */
  resume: z.boolean().default(false),
  permission: PermissionLevel.optional(),
});
export type CreateRunInput = z.input<typeof CreateRunInput>;

const commandPath = z.string().trim().regex(/^[\w .:\\/\-()]+$/, 'Comando com caracteres não permitidos.').max(400);
const commandArgs = z.string().trim().regex(/^[\w .:=\\/\-]*$/, 'Argumentos com caracteres não permitidos.').max(800);

export const CreateCustomProviderInput = z.object({
  name,
  command: commandPath,
  args: commandArgs.default(''),
  homeEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).nullish().or(z.literal('')),
  loginCommand: commandArgs.nullish().or(z.literal('')),
});
export type CreateCustomProviderInput = z.input<typeof CreateCustomProviderInput>;

export const McpServer = z.discriminatedUnion('type', [
  z.object({
    name: z.string().regex(/^[\w-]+$/, 'Use letras, números, - ou _.'),
    type: z.literal('http'),
    url: z.url().regex(/^https?:\/\/[^\s"'%&|<>^]+$/, 'URL não permitida.'),
  }),
  z.object({
    name: z.string().regex(/^[\w-]+$/, 'Use letras, números, - ou _.'),
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
]);
export type McpServer = z.infer<typeof McpServer>;

export const CreateToolkitInput = z.object({
  name,
  description: z.string().max(2000).default(''),
  mcp: McpServer.nullish(),
  exclusive: z.boolean().default(false),
});
export type CreateToolkitInput = z.input<typeof CreateToolkitInput>;

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

export interface AuthStatus {
  loggedIn: boolean;
  /** true: assinatura. false: chave de API. null: o CLI não informou. */
  subscription: boolean | null;
  method: string | null;
  email: string | null;
  plan: string | null;
  checkedAt: number;
  error?: string;
}

export interface UsageWindow {
  utilization: number | null;
  resetsAt: number | null;
  status: string | null;
}

/** Só o que o próprio CLI informou. Sem dados, fica null. */
export interface ProfileUsage {
  status: string | null;
  resetsAt: number | null;
  windows: Record<string, UsageWindow> | null;
  reportedAt: number;
}

export interface ProfileTotals {
  runs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Profile {
  id: string;
  provider: string;
  label: string;
  /** null: usa o login padrão do computador. */
  homeDir: string | null;
  auth: AuthStatus | null;
  usage: ProfileUsage | null;
  totals: ProfileTotals;
  createdAt: number;
}

export interface Agent {
  id: string;
  name: string;
  role: RoleId;
  roleTitle: string | null;
  instructions: string | null;
  provider: string;
  profileId: string | null;
  model: string | null;
  effort: string | null;
  permission: PermissionLevel;
  color: string;
  toolkitIds: string[];
  createdAt: number;
}

export interface ProjectInfo {
  isGit: boolean;
  branch: string | null;
  isUnreal: boolean;
  /** Tecnologias reconhecidas por arquivos presentes na pasta. */
  stack: string[];
}

export interface Project {
  id: string;
  name: string;
  path: string;
  info: ProjectInfo;
  createdAt: number;
}

export interface Skill {
  name: string;
  description: string;
  file: string;
}

export interface Toolkit {
  id: string;
  name: string;
  description: string;
  pluginPath: string | null;
  /** O plugin já está ligado na conta padrão, então não é carregado duas vezes. */
  enabledInDefaultAccount: boolean;
  skills: Skill[];
  mcp: McpServer | null;
  /** Um agente por vez, como em um editor compartilhado. */
  exclusive: boolean;
  preset: string | null;
  createdAt: number;
}

export interface DiscoveredToolkit {
  key: string;
  kind: 'plugin' | 'mcp';
  name: string;
  description: string;
  skills: string[];
  secret: boolean;
  added: boolean;
}

export interface CustomProvider {
  id: string;
  name: string;
  command: string;
  args: string;
  homeEnv: string | null;
  loginCommand: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

export type SupportLevel = 'tested' | 'documented' | 'custom';

export interface ProviderInfo {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  /** Recursos encontrados no `--help` da versão instalada. */
  capabilities: Record<string, boolean>;
  support: SupportLevel;
  /** O CLI permite perfis separados por pasta. */
  isolatesProfiles: boolean;
  canLogin: boolean;
  installCommand: string | null;
  installUrl: string | null;
  models: string[];
  efforts: string[];
  note: string | null;
}

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ErrorKind = 'limit' | 'auth' | 'missing' | 'session' | 'timeout' | 'unknown';

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Run {
  id: string;
  /** null quando o agente foi removido; o histórico continua com o nome dele. */
  agentId: string | null;
  agentName: string;
  profileId: string | null;
  /** Saída bruta do CLI, guardada em arquivo fora do banco. */
  logPath: string | null;
  missionId: string | null;
  taskId: string | null;
  projectId: string;
  provider: string;
  status: RunStatus;
  prompt: string;
  permission: PermissionLevel;
  command: string | null;
  sessionId: string | null;
  model: string | null;
  exitCode: number | null;
  errorKind: ErrorKind | null;
  errorText: string | null;
  finalText: string | null;
  usage: RunUsage | null;
  filesChanged: string[];
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** Formato comum a todos os CLIs depois de passar pelo adaptador. */
export type AgentEvent =
  | { type: 'session'; sessionId: string | null; model?: string | null }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_start'; toolId: string; name: string; summary: string; command?: string; files?: string[]; nested?: boolean }
  | { type: 'tool_end'; toolId: string; ok: boolean; output: string; nested?: boolean }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'limits'; status: string | null; resetsAt: number | null; windows: Record<string, UsageWindow> | null }
  | { type: 'warning'; text: string }
  | { type: 'error'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'raw'; text: string }
  | { type: 'noise'; text: string }
  | { type: 'final'; ok: boolean; text: string; error: string | null; inputTokens?: number; outputTokens?: number };

export interface StoredRunEvent {
  id: number;
  runId: string;
  ts: number;
  event: AgentEvent;
}

// ---------------------------------------------------------------------------
// Missões e tarefas
// ---------------------------------------------------------------------------

export type MissionStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'reporting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
export type TaskType = 'work' | 'review';
export type Verdict = 'APROVADO' | 'REPROVADO';

export const MissionSettings = z.object({
  /** Tarefas ao mesmo tempo. Acima de 1, só tarefas sem dependência entre si. */
  concurrency: z.number().int().min(1).max(8).default(1),
  /** Quantas vezes uma reprovação pode voltar para correção. */
  maxReviewRounds: z.number().int().min(0).max(10).default(2),
  /** Tentativas de uma tarefa que falhou por erro comum. */
  maxAttempts: z.number().int().min(1).max(5).default(2),
  /** Começa sem esperar a aprovação do plano. */
  autoApprove: z.boolean().default(false),
  /**
   * Passa a tarefa para um agente de OUTRO provedor quando um limite é atingido.
   * Nunca para outra conta do mesmo provedor, o que seria contornar o limite.
   */
  fallbackToOtherProvider: z.boolean().default(false),
});
export type MissionSettings = z.infer<typeof MissionSettings>;

export const CreateMissionInput = z.object({
  projectId: z.string().min(1),
  goal: z.string().trim().min(1).max(50_000),
  /** auto: o coordenador monta o plano. pipeline: a sequência é a ordem de agentIds. */
  mode: z.enum(['auto', 'pipeline']).default('auto'),
  coordinatorId: z.string().nullish(),
  agentIds: z.array(z.string()).default([]),
  settings: MissionSettings.partial().default({}),
});
export type CreateMissionInput = z.input<typeof CreateMissionInput>;

export const PlanTaskInput = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  assignee: z.string().min(1),
  type: z.enum(['work', 'review']).default('work'),
  priority: z.number().int().min(1).max(3).default(2),
  dependsOn: z.array(z.string()).default([]),
});
export type PlanTaskInput = z.input<typeof PlanTaskInput>;

export const ApproveMissionInput = z.object({
  /** Plano editado pelo usuário. Sem isso, aprova o plano do coordenador como está. */
  tasks: z.array(PlanTaskInput).min(1).optional(),
});

export const ReplanMissionInput = z.object({ feedback: z.string().trim().min(1).max(20_000) });
export const ReassignTaskInput = z.object({ agentId: z.string().min(1) });
export const MissionNoteInput = z.object({ text: z.string().trim().min(1).max(20_000) });

export interface Mission {
  id: string;
  projectId: string;
  goal: string;
  status: MissionStatus;
  mode: 'auto' | 'pipeline';
  coordinatorId: string | null;
  agentIds: string[];
  settings: MissionSettings;
  planSummary: string | null;
  /** Por que parou, em linguagem clara. */
  pauseReason: string | null;
  report: string | null;
  /** Orientações do usuário durante a missão, repassadas às próximas tarefas. */
  notes: string[];
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface Task {
  id: string;
  missionId: string;
  position: number;
  title: string;
  description: string;
  assigneeId: string | null;
  assigneeName: string;
  type: TaskType;
  priority: number;
  dependsOn: string[];
  status: TaskStatus;
  /** Rodada de correção: 0 no trabalho original. */
  round: number;
  isFix: boolean;
  attempts: number;
  verdict: Verdict | null;
  result: string | null;
  /** O que o agente passou adiante para quem vem depois. */
  handoff: string | null;
  filesChanged: string[];
  errorKind: ErrorKind | null;
  errorText: string | null;
  startedAt: number | null;
  endedAt: number | null;
}

export type MissionEventData =
  | { type: 'mission_status'; status: MissionStatus; reason?: string | null }
  | { type: 'plan_ready'; summary: string | null; taskCount: number }
  | { type: 'task_status'; title: string; status: TaskStatus; agentName: string; runId?: string | null; error?: string | null }
  | { type: 'handoff'; fromAgentId: string | null; fromAgentName: string; toAgentId: string | null; toAgentName: string; taskTitle: string; summary: string }
  | { type: 'review'; reviewerName: string; verdict: Verdict; taskTitle: string; summary: string }
  | { type: 'fix_requested'; fromAgentName: string; toAgentName: string; round: number; summary: string }
  | { type: 'retry'; title: string; attempt: number; reason: string }
  | { type: 'reassigned'; title: string; fromAgentName: string; toAgentName: string; reason: string }
  | { type: 'note'; text: string };

export interface StoredMissionEvent {
  id: number;
  missionId: string;
  taskId: string | null;
  ts: number;
  data: MissionEventData;
}

// ---------------------------------------------------------------------------
// Estado dos agentes, sempre derivado de eventos reais
// ---------------------------------------------------------------------------

export type AgentActivity = 'available' | 'thinking' | 'executing' | 'waiting' | 'reviewing' | 'error' | 'finished';

export interface AgentLiveState {
  agentId: string;
  activity: AgentActivity;
  /** O que está fazendo agora, como `npm test` ou "Editando app.ts". */
  detail: string | null;
  runId: string | null;
  taskId: string | null;
  missionId: string | null;
  since: number;
}

/** Mensagens do servidor para a interface pelo WebSocket. */
export type ServerMessage =
  | { kind: 'hello'; lastEventId: number }
  | { kind: 'run_event'; data: StoredRunEvent }
  | { kind: 'run_updated'; data: Run }
  | { kind: 'profile_updated'; data: Profile }
  | { kind: 'mission_updated'; data: Mission }
  | { kind: 'task_updated'; data: Task }
  | { kind: 'mission_event'; data: StoredMissionEvent }
  | { kind: 'agent_state'; data: AgentLiveState };
