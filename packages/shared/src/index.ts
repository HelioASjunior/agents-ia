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
  /** Conta paga por uso. Fica cifrada pelo sistema e nunca volta para a interface. */
  apiKey: z.string().trim().min(8).max(1000).regex(/^\S+$/, 'A chave não pode ter espaços.').optional(),
});
export type CreateProfileInput = z.input<typeof CreateProfileInput>;

export const UpdateProfileInput = z.object({ label: name });

export const SetApiKeyInput = z.object({ apiKey: z.string().trim().min(8).max(1000).regex(/^\S+$/, 'A chave não pode ter espaços.') });

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
  /** login: o do próprio CLI, normalmente por assinatura. api_key: chave guardada cifrada. */
  credential: 'login' | 'api_key';
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

export interface ModelOption {
  id: string;
  label: string;
  /** Níveis de esforço que este modelo aceita. */
  efforts: string[];
}

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
  /** O CLI aceita chave de API por variável de ambiente. */
  supportsApiKey: boolean;
  apiKeyUrl: string | null;
  installCommand: string | null;
  installUrl: string | null;
  models: string[];
  /** Modelos para escolher. Quando o CLI informa um catálogo, é o dele. */
  modelOptions: ModelOption[];
  efforts: string[];
  note: string | null;
}

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type ErrorKind = 'limit' | 'auth' | 'missing' | 'session' | 'timeout' | 'blocked' | 'unknown';

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
   * Nunca para outra conta do mesmo provedor, o que seria contornar o limite, nem para
   * quem tem menos permissão ou menos ferramentas do que o responsável.
   */
  fallbackToOtherProvider: z.boolean().default(false),
});
export type MissionSettings = z.infer<typeof MissionSettings>;

export const CreateMissionInput = z.object({
  projectId: z.string().min(1),
  goal: z.string().trim().min(1).max(50_000),
  /** auto: o coordenador monta o plano. pipeline: a sequência é a ordem de agentIds. */
  mode: z.enum(['auto', 'pipeline']).default('auto'),
  workflowId: z.string().nullish(),
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
  type: z.enum(['work', 'review']).optional(),
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
  mode: 'auto' | 'pipeline' | 'workflow';
  coordinatorId: string | null;
  agentIds: string[];
  settings: MissionSettings;
  planSummary: string | null;
  /** Por que parou, em linguagem clara. */
  pauseReason: string | null;
  report: string | null;
  /** Orientações do usuário durante a missão, repassadas às próximas tarefas. */
  notes: string[];
  /** worktree: cada tarefa trabalha em uma cópia isolada, integrada ao final dela. */
  isolation: 'none' | 'worktree';
  baseBranch: string | null;
  integrationBranch: string | null;
  /** O resultado isolado só chega ao projeto depois da revisão do usuário. */
  mergeStatus: 'none' | 'pending' | 'merged' | 'discarded';
  workflowId: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

/** Uma troca de provedor porque a conta do responsável atingiu o limite de uso. */
export interface TaskHandover {
  fromAgentName: string;
  fromProvider: string;
  toAgentName: string;
  toProvider: string;
  at: number;
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
  /** Condição em relação à revisão anterior. Fora dela, a tarefa é pulada. */
  runIf: 'always' | 'approved' | 'rejected';
  /** Limite próprio de tentativas; sem ele, vale o da missão. */
  maxAttempts: number | null;
  /** Ramo com conflito que esta tarefa precisa resolver. */
  mergeFrom: string | null;
  /** Quando o usuário liberou esta tarefa, no modo supervisionado. */
  approvedAt: number | null;
  /** A reserva escolhida na etapa do workflow, se houver. */
  fallbackAgentId: string | null;
  handovers: TaskHandover[];
}

const PERMISSION_RANK: Record<PermissionLevel, number> = { read: 0, edit: 1, full: 2 };

export const hasPermissionOf = (agent: Pick<Agent, 'permission'>, other: Pick<Agent, 'permission'>): boolean =>
  PERMISSION_RANK[agent.permission] >= PERMISSION_RANK[other.permission];

type ReserveFields = Pick<Agent, 'name' | 'provider' | 'permission'>;

/** Por que este agente não pode assumir o trabalho de quem atingiu o limite, ou null se pode. */
export function reserveProblem(current: ReserveFields, reserve: ReserveFields): string | null {
  if (reserve.provider === current.provider) return `${reserve.name} usa o mesmo provedor de ${current.name}, e trocar de conta seria contornar o limite.`;
  if (!hasPermissionOf(reserve, current)) return `${reserve.name} tem menos permissão do que ${current.name}, e pode não conseguir fazer esta etapa.`;
  return null;
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
  | { type: 'note'; text: string }
  | { type: 'conflict'; title: string; files: string[]; toAgentName: string }
  | { type: 'merged'; into: string; files: number }
  | { type: 'dangerous_command'; agentName: string; command: string; reason: string; blocked: boolean }
  | { type: 'task_skipped_by_condition'; title: string; condition: string };

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

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

/** Canal da equipe. Os demais canais são o ID de um agente. */
export const TEAM_CHANNEL = 'team';

export type ChatMessageStatus = 'streaming' | 'done' | 'error' | 'cancelled';

export interface Attachment {
  name: string;
  /** Caminho relativo à pasta do projeto. */
  path: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  channel: string;
  role: 'user' | 'agent' | 'system';
  agentId: string | null;
  agentName: string | null;
  text: string;
  runId: string | null;
  status: ChatMessageStatus;
  error: string | null;
  attachments: Attachment[];
  createdAt: number;
}

export const SendMessageInput = z.object({
  projectId: z.string().min(1),
  channel: z.string().min(1),
  text: z.string().trim().min(1).max(200_000),
  attachments: z.array(z.object({ name: z.string(), path: z.string(), size: z.number() })).default([]),
});
export type SendMessageInput = z.input<typeof SendMessageInput>;

export const UploadAttachmentInput = z.object({
  name: z.string().trim().min(1).max(200),
  /** Conteúdo em base64. */
  content: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Arquivos e terminal
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface FileContent {
  path: string;
  size: number;
  /** null quando o arquivo é binário ou grande demais para abrir. */
  content: string | null;
  reason: string | null;
}

export const SaveFileInput = z.object({ path: z.string().min(1), content: z.string() });

export const CreateTerminalInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shell'), projectId: z.string().min(1) }),
  z.object({ kind: z.literal('login'), profileId: z.string().min(1) }),
  z.object({ kind: z.literal('install'), provider: z.string().min(1) }),
]);
export type CreateTerminalInput = z.input<typeof CreateTerminalInput>;

export interface TerminalInfo {
  id: string;
  kind: 'shell' | 'login' | 'install';
  title: string;
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export interface Metrics {
  agents: { total: number; active: number };
  runs: { total: number; running: number; queued: number; completed: number; failed: number; cancelled: number; interrupted: number };
  tasks: { total: number; running: number; done: number; failed: number; pending: number };
  missions: { total: number; active: number; completed: number; failed: number };
  /** Só soma o que os CLIs informaram. Execuções sem esse dado não entram. */
  tokens: { input: number; output: number; runsWithData: number };
  averageRunMs: number | null;
  system: { platform: string; cpuCount: number; cpuUsage: number | null; memoryTotal: number; memoryFree: number; processMemory: number; uptimeSeconds: number };
}

export interface TimelineItem {
  id: string;
  ts: number;
  kind: 'run' | 'mission';
  title: string;
  detail: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export interface GitChange {
  path: string;
  /** M alterado, A novo, D apagado, R renomeado, ? ainda fora do Git, U em conflito. */
  status: string;
}

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: number;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  hasCommits: boolean;
  changes: GitChange[];
  commits: GitCommit[];
}

export const CloneProjectInput = z.object({
  url: z.string().trim().regex(/^(https?:\/\/|git@|ssh:\/\/)[^\s]+$/, 'Use um endereço https, ssh ou git@.').max(500),
  path: z.string().trim().min(1),
  name: z.string().trim().max(80).optional(),
});

// ---------------------------------------------------------------------------
// Memória do projeto
// ---------------------------------------------------------------------------

export type MemoryKind = 'decision' | 'note';

export interface MemoryItem {
  id: string;
  projectId: string;
  kind: MemoryKind;
  text: string;
  /** Quem registrou: o nome do agente, ou null para o usuário. */
  source: string | null;
  missionId: string | null;
  createdAt: number;
}

export const CreateMemoryInput = z.object({
  kind: z.enum(['decision', 'note']).default('note'),
  text: z.string().trim().min(1).max(4000),
});

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export const WorkflowNode = z.object({
  id: z.string().min(1).max(60),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(8000).default(''),
  /** Quem faz: um agente específico, ou o primeiro da equipe com esta função. */
  agentId: z.string().nullish(),
  /** Quem assume se a conta do responsável atingir o limite. Sem reserva, a missão pausa. */
  fallbackAgentId: z.string().nullish(),
  role: RoleId.default('developer'),
  type: z.enum(['work', 'review']).default('work'),
  /** Condição em relação à revisão da etapa anterior. */
  runIf: z.enum(['always', 'approved', 'rejected']).default('always'),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  x: z.number().default(0),
  y: z.number().default(0),
});
export type WorkflowNode = z.infer<typeof WorkflowNode>;

export const WorkflowEdge = z.object({ source: z.string(), target: z.string() });
export type WorkflowEdge = z.infer<typeof WorkflowEdge>;

export const SaveWorkflowInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).default(''),
  nodes: z.array(WorkflowNode).min(1).max(40),
  edges: z.array(WorkflowEdge).max(200).default([]),
});
export type SaveWorkflowInput = z.input<typeof SaveWorkflowInput>;

export const RunWorkflowInput = z.object({
  projectId: z.string().min(1),
  goal: z.string().trim().min(1).max(50_000),
  settings: MissionSettings.partial().default({}),
});

/** Fila de objetivos: um workflow executado em ordem, um objetivo de cada vez. */
export const SaveQueueInput = z.object({
  workflowId: z.string().min(1),
  /** stop: espera a pessoa. skip: registra a falha e segue para o próximo objetivo. */
  onFailure: z.enum(['stop', 'skip']).default('stop'),
  /** Soma de tokens de entrada e saída. Conferida entre um objetivo e outro. */
  tokenLimit: z.number().int().positive().nullable().default(null),
});

export const AddQueueItemsInput = z.object({
  goals: z.array(z.string().trim().min(1).max(50_000)).min(1).max(200),
});

export const UpdateQueueItemInput = z.object({ goal: z.string().trim().min(1).max(50_000) });
export const ReorderQueueInput = z.object({ itemIds: z.array(z.string().min(1)) });

export type QueueItemStatus = 'pending' | 'running' | 'done' | 'failed';

export interface QueueItem {
  id: string;
  position: number;
  goal: string;
  status: QueueItemStatus;
  /** A missão mais recente deste objetivo. */
  missionId: string | null;
  /** Por que o objetivo falhou. */
  reason: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Execuções que não informaram consumo: os tokens acima não as incluem. */
  runsWithoutUsage: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface GoalQueue {
  id: string;
  projectId: string;
  workflowId: string;
  onFailure: 'stop' | 'skip';
  tokenLimit: number | null;
  /** Ligada: inicia o próximo objetivo quando o atual terminar. */
  running: boolean;
  /** Por que a fila parou sozinha, ou null se ela nunca parou ou terminou tudo. */
  stopReason: string | null;
  items: QueueItem[];
  createdAt: number;
  updatedAt: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Modelo que vem com o XinoIA: pode ser usado e copiado, não alterado. */
  builtin: boolean;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Modos de execução
// ---------------------------------------------------------------------------

export const ExecutionMode = z.enum(['supervised', 'semi', 'autonomous']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const EXECUTION_MODES: Array<{ id: ExecutionMode; label: string; description: string }> = [
  {
    id: 'supervised',
    label: 'Supervisionado',
    description: 'Você aprova o plano e cada tarefa antes de começar. Nenhum agente recebe permissão total, e um comando destrutivo interrompe a execução.',
  },
  {
    id: 'semi',
    label: 'Semiautônomo',
    description: 'Você aprova o plano e as tarefas seguem sozinhas. A permissão total fica limitada, e um comando destrutivo interrompe a execução e pede sua decisão.',
  },
  {
    id: 'autonomous',
    label: 'Autônomo controlado',
    description: 'As tarefas seguem sozinhas com a permissão de cada agente, dentro dos limites de tempo. Comandos destrutivos ficam registrados como aviso.',
  },
];

export const AppSettings = z.object({
  executionMode: ExecutionMode.default('semi'),
  /** Tempo máximo sem nenhuma saída antes de considerar o agente travado. */
  stallMinutes: z.number().int().min(1).max(240).default(30),
  /** Tempo máximo total de uma execução. */
  maxRunMinutes: z.number().int().min(1).max(1440).default(180),
});
export type AppSettings = z.infer<typeof AppSettings>;

/** Mensagens do servidor para a interface pelo WebSocket. */
export type ServerMessage =
  | { kind: 'chat_message'; data: ChatMessage }
  | { kind: 'hello'; lastEventId: number }
  | { kind: 'run_event'; data: StoredRunEvent }
  | { kind: 'run_updated'; data: Run }
  | { kind: 'profile_updated'; data: Profile }
  | { kind: 'mission_updated'; data: Mission }
  | { kind: 'task_updated'; data: Task }
  /** O plano inteiro foi trocado, então as tarefas antigas deixam de existir. */
  | { kind: 'tasks_replaced'; missionId: string; data: Task[] }
  | { kind: 'mission_event'; data: StoredMissionEvent }
  | { kind: 'queue_updated'; data: GoalQueue }
  | { kind: 'agent_state'; data: AgentLiveState };
