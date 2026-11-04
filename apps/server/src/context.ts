import fs from 'node:fs';
import type { AppConfig } from './config.ts';
import { createSqlitePersistence } from './persistence/sqlite/index.ts';
import type { Persistence } from './persistence/types.ts';
import { ProviderRegistry } from './providers/registry.ts';
import { AgentStateService } from './services/agent-state.ts';
import { AgentService } from './services/agents.ts';
import { CustomProviderService } from './services/custom-providers.ts';
import { DetectionService } from './services/detection.ts';
import { Orchestrator } from './services/orchestrator.ts';
import { ProfileService } from './services/profiles.ts';
import { ProjectService } from './services/projects.ts';
import { RunService } from './services/runs.ts';
import { ToolkitService } from './services/toolkits.ts';
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
  const runs = new RunService(config, db, registry, hub, profiles, toolkits);
  const agentState = new AgentStateService(hub);
  const orchestrator = new Orchestrator(db, runs, hub);

  const interruptedOnStart = await db.runs.markUnfinishedAsInterrupted(Date.now());
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
    recoveredFrom: sqlite.opened.recoveredFrom,
    interruptedOnStart,
    async close() {
      agentState.close();
      await runs.shutdown();
      await db.close();
    },
  };
}
