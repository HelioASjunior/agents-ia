import fs from 'node:fs';
import type { AppConfig } from './config.ts';
import { createSqlitePersistence } from './persistence/sqlite/index.ts';
import type { Persistence } from './persistence/types.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { AgentStateService } from './services/agent-state.ts';
import { AgentService } from './services/agents.ts';
import { ChatService } from './services/chat.ts';
import { CustomProviderService } from './services/custom-providers.ts';
import { DetectionService } from './services/detection.ts';
import { MemoryService } from './services/memory.ts';
import { MetricsService } from './services/metrics.ts';
import { Orchestrator } from './services/orchestrator.ts';
import { SettingsService } from './services/policy.ts';
import { ProfileService } from './services/profiles.ts';
import { ProjectService } from './services/projects.ts';
import { RunService } from './services/runs.ts';
import { TerminalService } from './services/terminals.ts';
import { ToolkitService } from './services/toolkits.ts';
import { WorkflowService } from './services/workflows.ts';
import { EventHub } from './ws/hub.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppContext {
  config: AppConfig;
  db: Persistence;
  hub: EventHub;
  providers: ProviderRegistry;
  detection: DetectionService;
  profiles: ProfileService;
  agents: AgentService;
  projects: ProjectService;
  toolkits: ToolkitService;
  customProviders: CustomProviderService;
  runs: RunService;
  orchestrator: Orchestrator;
  agentState: AgentStateService;
  chat: ChatService;
  metrics: MetricsService;
  terminals: TerminalService;
  memory: MemoryService;
  workflows: WorkflowService;
  settings: SettingsService;
  /** Dados restaurados de uma cópia de segurança ao abrir, se houve dano. */
  recoveredFrom: string | null;
  /** Execuções que estavam ativas quando o app fechou da última vez. */
  interruptedOnStart: number;
  close(): Promise<void>;
}

export async function createContext(config: AppConfig, registry = new ProviderRegistry()): Promise<AppContext> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });

  const sqlite = createSqlitePersistence(config.databaseFile, config.backupsDir);
  const db: Persistence = sqlite;
  const hub = new EventHub();
  const detection = new DetectionService(config, registry);
  const profiles = new ProfileService(config, db, registry, hub);
  const agents = new AgentService(db, registry);
  const projects = new ProjectService(db);
  const toolkits = new ToolkitService(config, db);
  const customProviders = new CustomProviderService(db, registry);
  const settings = new SettingsService(db);
  await settings.load();
  const runs = new RunService(config, db, registry, hub, profiles, toolkits, settings);
  const agentState = new AgentStateService(hub);
  const memory = new MemoryService(db);
  const orchestrator = new Orchestrator(config, db, runs, hub, memory, settings);
  const workflows = new WorkflowService(db, orchestrator);
  const chat = new ChatService(db, hub, runs, orchestrator, memory);
  const metrics = new MetricsService(db, agentState);
  const terminals = new TerminalService(config, db, registry, profiles);

  const interruptedOnStart = await db.runs.markUnfinishedAsInterrupted(Date.now());
  await db.messages.markStreamingAsInterrupted();
  await orchestrator.recover();
  await customProviders.load();

  const lastBackup = (await db.settings.get<number>('last_backup_at')) ?? 0;
  if (Date.now() - lastBackup > DAY_MS && (await db.projects.list()).length) {
    await db.backup('diario');
    await db.settings.set('last_backup_at', Date.now());
  }

  return {
    config,
    db,
    hub,
    providers: registry,
    detection,
    profiles,
    agents,
    projects,
    toolkits,
    customProviders,
    runs,
    orchestrator,
    agentState,
    chat,
    metrics,
    terminals,
    memory,
    workflows,
    settings,
    recoveredFrom: sqlite.opened.recoveredFrom,
    interruptedOnStart,
    async close() {
      terminals.closeAll();
      agentState.close();
      await runs.shutdown();
      await db.close();
    },
  };
}
