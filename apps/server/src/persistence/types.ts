import type {
  Agent,
  AgentEvent,
  AuthStatus,
  ChatMessage,
  CustomProvider,
  MemoryItem,
  Mission,
  MissionEventData,
  Profile,
  ProfileTotals,
  ProfileUsage,
  Project,
  ProjectInfo,
  Run,
  RunStatus,
  StoredMissionEvent,
  StoredRunEvent,
  Task,
  Toolkit,
  Workflow,
} from '@xinoia/shared';

// Os serviços conhecem só estas interfaces, nunca SQL. São assíncronas mesmo com
// o SQLite sendo síncrono, para que um banco em rede possa implementá-las depois.

export interface SettingsRepository {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export interface ProfileRepository {
  list(): Promise<Profile[]>;
  get(id: string): Promise<Profile | null>;
  insert(profile: Profile): Promise<void>;
  updateLabel(id: string, label: string): Promise<void>;
  updateAuth(id: string, auth: AuthStatus): Promise<void>;
  updateUsage(id: string, usage: ProfileUsage): Promise<void>;
  updateTotals(id: string, totals: ProfileTotals): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AgentRepository {
  list(): Promise<Agent[]>;
  get(id: string): Promise<Agent | null>;
  insert(agent: Agent): Promise<void>;
  update(agent: Agent): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ProjectRepository {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  findByPath(path: string): Promise<Project | null>;
  insert(project: Project): Promise<void>;
  updateInfo(id: string, info: ProjectInfo): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ToolkitRepository {
  list(): Promise<Toolkit[]>;
  get(id: string): Promise<Toolkit | null>;
  insert(toolkit: Toolkit): Promise<void>;
  update(toolkit: Toolkit): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CustomProviderRepository {
  list(): Promise<CustomProvider[]>;
  insert(provider: CustomProvider): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface SessionKey {
  agentId: string;
  projectId: string;
  profileId: string | null;
}

/** Sessão do CLI para continuar uma conversa. A conta entra na chave porque a sessão é dela. */
export interface ProviderSessionRepository {
  get(key: SessionKey): Promise<string | null>;
  set(key: SessionKey, sessionId: string): Promise<void>;
  clear(key: SessionKey): Promise<void>;
}

export interface RunFilter {
  projectId?: string;
  agentId?: string;
  status?: RunStatus;
  limit?: number;
}

export interface RunRepository {
  insert(run: Run): Promise<void>;
  update(run: Run): Promise<void>;
  get(id: string): Promise<Run | null>;
  list(filter?: RunFilter): Promise<Run[]>;
  /** Marca como interrompidas as execuções cujo processo não existe mais. Devolve quantas. */
  markUnfinishedAsInterrupted(now: number): Promise<number>;
}

export interface RunEventRepository {
  append(runId: string, ts: number, event: AgentEvent): Promise<StoredRunEvent>;
  listForRun(runId: string, afterId?: number): Promise<StoredRunEvent[]>;
  listAfter(afterId: number, limit?: number): Promise<StoredRunEvent[]>;
  /** Eventos mais recentes de um projeto, em ordem, para refazer o terminal. */
  listForProject(projectId: string, limit?: number): Promise<StoredRunEvent[]>;
  lastId(): Promise<number>;
}

export interface MissionRepository {
  insert(mission: Mission): Promise<void>;
  update(mission: Mission): Promise<void>;
  get(id: string): Promise<Mission | null>;
  list(filter?: { projectId?: string; limit?: number }): Promise<Mission[]>;
  /** Missões que estavam em andamento, para retomar depois de fechar o app. */
  listUnfinished(): Promise<Mission[]>;
}

export interface TaskRepository {
  /** Substitui o plano inteiro de uma missão, de forma atômica. */
  replaceForMission(missionId: string, tasks: Task[]): Promise<void>;
  insert(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  get(id: string): Promise<Task | null>;
  listForMission(missionId: string): Promise<Task[]>;
}

export interface MissionEventRepository {
  append(missionId: string, taskId: string | null, ts: number, data: MissionEventData): Promise<StoredMissionEvent>;
  listForMission(missionId: string, afterId?: number): Promise<StoredMissionEvent[]>;
}

export interface MessageRepository {
  insert(message: ChatMessage): Promise<void>;
  update(message: ChatMessage): Promise<void>;
  get(id: string): Promise<ChatMessage | null>;
  list(projectId: string, channel: string, limit?: number): Promise<ChatMessage[]>;
  search(projectId: string, query: string, limit?: number): Promise<ChatMessage[]>;
  clearChannel(projectId: string, channel: string): Promise<void>;
  /** Mensagens que estavam em andamento quando o app fechou. */
  markStreamingAsInterrupted(): Promise<void>;
}

export interface MetricsRepository {
  counts(projectId?: string): Promise<{
    runs: Record<string, number>;
    tasks: Record<string, number>;
    missions: Record<string, number>;
    tokens: { input: number; output: number; runsWithData: number };
    averageRunMs: number | null;
  }>;
}

export interface WorkflowRepository {
  list(): Promise<Workflow[]>;
  get(id: string): Promise<Workflow | null>;
  insert(workflow: Workflow): Promise<void>;
  update(workflow: Workflow): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface MemoryRepository {
  list(projectId: string, limit?: number): Promise<MemoryItem[]>;
  insert(item: MemoryItem): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface Persistence {
  workflows: WorkflowRepository;
  memory: MemoryRepository;
  messages: MessageRepository;
  metrics: MetricsRepository;
  missions: MissionRepository;
  tasks: TaskRepository;
  missionEvents: MissionEventRepository;
  settings: SettingsRepository;
  profiles: ProfileRepository;
  agents: AgentRepository;
  projects: ProjectRepository;
  toolkits: ToolkitRepository;
  customProviders: CustomProviderRepository;
  sessions: ProviderSessionRepository;
  runs: RunRepository;
  runEvents: RunEventRepository;
  /** Gera uma cópia consistente dos dados e devolve onde ela ficou. */
  backup(reason: string): Promise<string>;
  /** Versão do esquema de dados em uso. */
  schemaVersion(): Promise<number>;
  close(): Promise<void>;
}
