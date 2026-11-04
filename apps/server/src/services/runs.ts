import fs from 'node:fs';
import path from 'node:path';
import type { Agent, AgentEvent, Profile, Project, Run, StoredRunEvent } from '@xinoia/shared';
import { CreateRunInput } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence, RunFilter } from '../persistence/types.ts';
import { startCliRun, type RunHandle, type RunOutcome } from '../process/runner.ts';
import { buildEnv } from '../process/spawn.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderAdapter } from '../providers/types.ts';
import { redact, redactDeep } from '../security/redact.ts';
import type { EventHub } from '../ws/hub.ts';
import { KeyedQueue } from './keyed-queue.ts';
import { buildPersona } from './persona.ts';
import { dangerousCommand, effectivePermission, writeClaudePolicy, type SettingsService } from './policy.ts';
import type { ProfileService } from './profiles.ts';
import { quotePath, type ToolkitService } from './toolkits.ts';

const MAX_OUTPUT_CHARS = 64_000;
const MAX_RAW_LOG_BYTES = 20 * 1024 * 1024;
const TEXT_FLUSH_MS = 80;

export function friendlyError(kind: Run['errorKind'], fallback: string | null): string {
  switch (kind) {
    case 'limit':
      return 'A conta atingiu o limite de uso informado pelo provedor. Espere renovar ou escolha outra conta para este agente.';
    case 'auth':
      return 'A conta precisa de login. Faça o login oficial deste perfil e tente de novo.';
    case 'missing':
      return 'A ferramenta não está instalada neste computador.';
    default:
      return fallback ?? 'A execução falhou.';
  }
}

/** Grava os eventos de uma execução em ordem, juntando pedaços de texto próximos. */
class RunEventWriter {
  private readonly db: Persistence;
  private readonly hub: EventHub;
  private readonly runId: string;
  private chain: Promise<void> = Promise.resolve();
  private textBuffer = '';
  private textTimer: NodeJS.Timeout | null = null;

  constructor(db: Persistence, hub: EventHub, runId: string) {
    this.db = db;
    this.hub = hub;
    this.runId = runId;
  }

  private write(event: AgentEvent): void {
    this.chain = this.chain.then(async () => {
      const stored: StoredRunEvent = await this.db.runEvents.append(this.runId, Date.now(), event);
      this.hub.publish({ kind: 'run_event', data: stored });
    });
  }

  private flushText(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    if (!this.textBuffer) return;
    const text = redact(this.textBuffer);
    this.textBuffer = '';
    this.write({ type: 'text', text });
  }

  push(event: AgentEvent): void {
    if (event.type === 'text') {
      this.textBuffer += event.text;
      this.textTimer ??= setTimeout(() => this.flushText(), TEXT_FLUSH_MS);
      return;
    }
    this.flushText();
    const clean = redactDeep(event);
    if (clean.type === 'tool_end' && clean.output.length > MAX_OUTPUT_CHARS) {
      clean.output = `${clean.output.slice(0, MAX_OUTPUT_CHARS)}\n… saída cortada no histórico`;
    }
    this.write(clean);
  }

  async close(): Promise<void> {
    this.flushText();
    await this.chain;
  }
}

/** Saída bruta em arquivo, fora do banco, com tamanho limitado. */
class RawLog {
  private readonly stream: fs.WriteStream;
  private written = 0;
  private closed = false;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.stream = fs.createWriteStream(file, { flags: 'a' });
  }

  write(stream: string, line: string): void {
    if (this.closed) return;
    const text = `${JSON.stringify({ ts: Date.now(), stream, line: redact(line) })}\n`;
    this.written += text.length;
    if (this.written > MAX_RAW_LOG_BYTES) {
      this.closed = true;
      this.stream.end(`${JSON.stringify({ note: 'limite do log atingido' })}\n`);
      return;
    }
    this.stream.write(text);
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

interface ActiveRun {
  handle: RunHandle | null;
  cancelRequested: boolean;
  blockedReason?: string;
  finished: Promise<void>;
}

interface RunContext {
  agent: Agent;
  project: Project;
  adapter: ProviderAdapter;
  profile: Profile | null;
  prompt: string;
  resume: boolean;
  cwd: string;
  notice: string | null;
}

export interface RunLink {
  missionId?: string;
  taskId?: string;
  /** Pasta de trabalho, quando a tarefa roda isolada em um worktree. */
  cwd?: string;
}

export interface DangerousCommandEvent {
  run: Run;
  command: string;
  reason: string;
  blocked: boolean;
}

export class RunService {
  private readonly config: AppConfig;
  private readonly db: Persistence;
  private readonly providers: ProviderRegistry;
  private readonly hub: EventHub;
  private readonly profiles: ProfileService;
  private readonly toolkits: ToolkitService;
  private readonly settings: SettingsService;
  private readonly queue = new KeyedQueue();
  private readonly active = new Map<string, ActiveRun>();
  private policyFile: string | null = null;
  /** O orquestrador escuta para registrar na missão e pausar. */
  onDangerous: ((event: DangerousCommandEvent) => void) | null = null;

  constructor(
    config: AppConfig,
    db: Persistence,
    providers: ProviderRegistry,
    hub: EventHub,
    profiles: ProfileService,
    toolkits: ToolkitService,
    settings: SettingsService,
  ) {
    this.config = config;
    this.db = db;
    this.providers = providers;
    this.hub = hub;
    this.profiles = profiles;
    this.toolkits = toolkits;
    this.settings = settings;
  }

  async create(input: unknown, link: RunLink = {}): Promise<Run> {
    const data = CreateRunInput.parse(input);
    const agent = await this.db.agents.get(data.agentId);
    if (!agent) throw notFound('Agente');
    const project = await this.db.projects.get(data.projectId);
    if (!project) throw notFound('Projeto');
    if (!fs.existsSync(project.path)) throw badRequest(`A pasta do projeto não existe mais: ${project.path}`, 'path_not_found');

    const adapter = this.providers.get(agent.provider);
    if (!adapter) throw badRequest(`Provedor desconhecido: ${agent.provider}`);
    const profile = agent.profileId ? await this.db.profiles.get(agent.profileId) : null;
    if (adapter.requiresProfile && !profile) {
      throw badRequest(`${agent.name} não tem perfil conectado. Escolha um perfil de ${adapter.label}.`, 'no_profile');
    }

    const allowed = effectivePermission(data.permission ?? agent.permission, this.settings.get().executionMode);
    const run: Run = {
      id: newId('run'),
      agentId: agent.id,
      agentName: agent.name,
      profileId: profile?.id ?? null,
      projectId: project.id,
      provider: agent.provider,
      status: 'queued',
      prompt: redact(data.prompt),
      permission: allowed.permission,
      command: null,
      sessionId: null,
      model: agent.model,
      exitCode: null,
      errorKind: null,
      errorText: null,
      finalText: null,
      usage: null,
      filesChanged: [],
      logPath: path.join(this.config.logsDir, 'runs', new Date().toISOString().slice(0, 10), `${newId('log')}.jsonl`),
      missionId: link.missionId ?? null,
      taskId: link.taskId ?? null,
      queuedAt: Date.now(),
      startedAt: null,
      endedAt: null,
    };
    await this.db.runs.insert(run);
    this.hub.publish({ kind: 'run_updated', data: run });

    const entry: ActiveRun = { handle: null, cancelRequested: false, finished: Promise.resolve() };
    this.active.set(run.id, entry);
    entry.finished = this.process(run, entry, {
      agent,
      project,
      adapter,
      profile,
      prompt: data.prompt,
      resume: data.resume,
      cwd: link.cwd ?? project.path,
      notice: allowed.reason,
    })
      .catch(async (error: unknown) => {
        run.status = 'failed';
        run.errorKind = 'unknown';
        run.errorText = error instanceof Error ? error.message : String(error);
        run.endedAt = Date.now();
        await this.saveRun(run);
      })
      .finally(() => {
        this.active.delete(run.id);
      });
    return run;
  }

  private async saveRun(run: Run): Promise<void> {
    await this.db.runs.update(run);
    this.hub.publish({ kind: 'run_updated', data: { ...run } });
  }

  private async process(run: Run, entry: ActiveRun, context: RunContext): Promise<void> {
    const { agent, project, adapter, profile, resume } = context;
    const resolved = await this.toolkits.resolve(agent, adapter, profile, run.permission);
    const keys = [
      `agent:${agent.id}`,
      ...resolved.toolkits.filter((kit) => kit.exclusive).map((kit) => `toolkit:${kit.id}`),
    ];
    const release = await this.queue.acquire(keys);
    const writer = new RunEventWriter(this.db, this.hub, run.id);
    const rawLog = new RawLog(run.logPath!);

    try {
      if (entry.cancelRequested) {
        run.status = 'cancelled';
        run.endedAt = Date.now();
        await this.saveRun(run);
        return;
      }

      run.status = 'running';
      run.startedAt = Date.now();
      await this.saveRun(run);
      if (context.notice) writer.push({ type: 'warning', text: context.notice });
      for (const text of resolved.warnings) writer.push({ type: 'warning', text });

      const sessionKey = { agentId: agent.id, projectId: project.id, profileId: profile?.id ?? null };
      let sessionId = resume ? await this.db.sessions.get(sessionKey) : null;
      let outcome = await this.attempt(run, entry, context, resolved, sessionId, writer, rawLog);

      // A sessão pode ter sumido do CLI. Recomeça uma vez em vez de falhar.
      if (!outcome.ok && !outcome.cancelled && sessionId && outcome.errorKind === 'session') {
        writer.push({ type: 'warning', text: 'A sessão anterior não existe mais. Começando uma nova conversa.' });
        await this.db.sessions.clear(sessionKey);
        sessionId = null;
        outcome = await this.attempt(run, entry, context, resolved, sessionId, writer, rawLog);
      }

      if (outcome.sessionId) await this.db.sessions.set(sessionKey, outcome.sessionId);
      await writer.close();

      run.exitCode = outcome.exitCode;
      run.sessionId = outcome.sessionId;
      run.model = outcome.model ?? run.model;
      run.finalText = redact(outcome.finalText);
      if (outcome.inputTokens !== null || outcome.outputTokens !== null) {
        run.usage = { inputTokens: outcome.inputTokens ?? 0, outputTokens: outcome.outputTokens ?? 0 };
      }
      run.endedAt = Date.now();
      if (entry.blockedReason) {
        run.status = 'failed';
        run.errorKind = 'blocked';
        run.errorText = entry.blockedReason;
      } else if (outcome.cancelled) {
        run.status = 'cancelled';
      } else if (outcome.ok) {
        run.status = 'completed';
      } else {
        run.status = 'failed';
        run.errorKind = outcome.errorKind;
        run.errorText = redact(outcome.errorText ?? 'A execução falhou.');
      }
      await this.saveRun(run);
      if (profile) {
        await this.profiles.addTotals(profile.id, run.usage?.inputTokens ?? 0, run.usage?.outputTokens ?? 0);
        if (outcome.errorKind === 'auth') void this.profiles.check(profile.id).catch(() => undefined);
      }
    } finally {
      await writer.close();
      await rawLog.close();
      release();
    }
  }

  private async attempt(
    run: Run,
    entry: ActiveRun,
    context: RunContext,
    resolved: { args: string[]; promptNote: string },
    sessionId: string | null,
    writer: RunEventWriter,
    rawLog: RawLog,
  ): Promise<RunOutcome> {
    const { agent, project, adapter, profile, prompt, cwd } = context;
    const policyArgs = adapter.policyArgs?.((this.policyFile ??= writeClaudePolicy(this.config)), quotePath) ?? [];
    const options = {
      model: agent.model,
      effort: agent.effort,
      sessionId,
      permission: run.permission,
      extraArgs: [...resolved.args, ...policyArgs],
    };
    run.command = redact(`${adapter.command} ${adapter.buildArgs(options).join(' ')}`);
    await this.saveRun(run);

    // Sessão retomada já conhece o papel; repetir só gastaria contexto.
    let fullPrompt = prompt;
    if (!sessionId) {
      const team = await this.db.agents.list();
      fullPrompt = [buildPersona(agent, project, team, cwd), resolved.promptNote, prompt].filter(Boolean).join('\n\n');
    }

    const home = profile ? this.profiles.homeOf(profile) : null;
    const { stallMinutes, maxRunMinutes } = this.settings.get();
    const handle = startCliRun({
      adapter,
      prompt: fullPrompt,
      cwd,
      env: buildEnv(adapter, home),
      options,
      inactivityMs: stallMinutes * 60_000,
      maxDurationMs: maxRunMinutes * 60_000,
      onRawLine: (stream, line) => rawLog.write(stream, line),
      onEvent: (event) => {
        if (event.type === 'tool_start' && event.files?.length) {
          for (const file of event.files) {
            const relative = (path.isAbsolute(file) ? path.relative(cwd, file) : file).replaceAll('\\', '/');
            if (!run.filesChanged.includes(relative)) run.filesChanged.push(relative);
          }
        }
        if (event.type === 'limits' && profile) {
          void this.profiles.recordUsage(profile.id, {
            status: event.status,
            resetsAt: event.resetsAt,
            windows: event.windows,
            reportedAt: Date.now(),
          });
        }
        writer.push(event);
        if (event.type === 'tool_start' && event.command) this.checkCommand(run, entry, event.command);
      },
    });
    entry.handle = handle;
    if (entry.cancelRequested) handle.cancel();
    return handle.done;
  }

  /** Comando perigoso: em modos com supervisão, para antes de causar mais estrago. */
  private checkCommand(run: Run, entry: ActiveRun, command: string): void {
    const reason = dangerousCommand(command);
    if (!reason) return;
    const blocked = this.settings.get().executionMode !== 'autonomous';
    const clean = redact(command);
    this.onDangerous?.({ run, command: clean, reason, blocked });
    if (blocked) {
      entry.blockedReason = `Comando interrompido por segurança (${reason}): ${clean.slice(0, 200)}`;
      entry.handle?.cancel();
    }
  }

  async cancel(id: string): Promise<Run> {
    const run = await this.get(id);
    const entry = this.active.get(id);
    if (!entry) throw conflict('Esta execução já terminou.', 'not_running');
    entry.cancelRequested = true;
    entry.handle?.cancel();
    return run;
  }

  async get(id: string): Promise<Run> {
    const run = await this.db.runs.get(id);
    if (!run) throw notFound('Execução');
    return run;
  }

  list(filter?: RunFilter): Promise<Run[]> {
    return this.db.runs.list(filter);
  }

  events(id: string, afterId = 0): Promise<StoredRunEvent[]> {
    return this.db.runEvents.listForRun(id, afterId);
  }

  /** Espera a execução terminar. Usado por testes e pelo encerramento do app. */
  async waitFor(id: string): Promise<Run> {
    await this.active.get(id)?.finished;
    return this.get(id);
  }

  activeCount(): number {
    return this.active.size;
  }

  /** Encerra tudo que está rodando antes de fechar o app. */
  async shutdown(): Promise<void> {
    const entries = [...this.active.values()];
    for (const entry of entries) {
      entry.cancelRequested = true;
      entry.handle?.cancel();
    }
    await Promise.all(entries.map((entry) => entry.finished));
  }
}
