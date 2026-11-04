import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  Agent,
  AgentEvent,
  ChatMessage,
  CustomProvider,
  GoalQueue,
  McpServer,
  MemoryItem,
  Mission,
  MissionEventData,
  MissionStatus,
  PermissionLevel,
  Profile,
  Project,
  QueueItem,
  RoleId,
  Run,
  RunStatus,
  ErrorKind,
  Skill,
  StoredRunEvent,
  Task,
  Toolkit,
  Workflow,
} from '@xinoia/shared';
import type { Persistence, RunFilter, SessionKey } from '../types.ts';
import { backupDatabase, openDatabase, type OpenResult } from './connection.ts';

type Row = Record<string, SQLInputValue>;

const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const parseOrNull = <T>(value: unknown): T | null => (value === null || value === undefined ? null : parse<T>(value));
const textOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

const NO_PROFILE = '-';
const profileKey = (key: SessionKey): string => key.profileId ?? NO_PROFILE;

function toProfile(r: Row): Profile {
  return {
    id: String(r.id),
    provider: String(r.provider),
    label: String(r.label),
    homeDir: textOrNull(r.home_dir),
    credential: r.api_key_cipher ? 'api_key' : 'login',
    auth: parseOrNull(r.auth_json),
    usage: parseOrNull(r.usage_json),
    totals: parse(r.totals_json),
    createdAt: Number(r.created_at),
  };
}

function toProject(r: Row): Project {
  return {
    id: String(r.id),
    name: String(r.name),
    path: String(r.path),
    info: parse(r.info_json),
    createdAt: Number(r.created_at),
  };
}

function toToolkit(r: Row): Toolkit {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    pluginPath: textOrNull(r.plugin_path),
    enabledInDefaultAccount: Number(r.enabled_in_default_account) === 1,
    skills: parse<Skill[]>(r.skills_json),
    mcp: parseOrNull<McpServer>(r.mcp_json),
    exclusive: Number(r.exclusive) === 1,
    preset: textOrNull(r.preset),
    createdAt: Number(r.created_at),
  };
}

function toRun(r: Row): Run {
  return {
    id: String(r.id),
    agentId: textOrNull(r.agent_id),
    agentName: String(r.agent_name),
    profileId: textOrNull(r.profile_id),
    projectId: String(r.project_id),
    provider: String(r.provider),
    status: String(r.status) as RunStatus,
    prompt: String(r.prompt),
    permission: String(r.permission) as PermissionLevel,
    command: textOrNull(r.command),
    sessionId: textOrNull(r.session_id),
    model: textOrNull(r.model),
    exitCode: numOrNull(r.exit_code),
    errorKind: textOrNull(r.error_kind) as ErrorKind | null,
    errorText: textOrNull(r.error_text),
    finalText: textOrNull(r.final_text),
    usage: parseOrNull(r.usage_json),
    filesChanged: parse(r.files_changed_json),
    logPath: textOrNull(r.log_path),
    missionId: textOrNull(r.mission_id),
    taskId: textOrNull(r.task_id),
    queuedAt: Number(r.queued_at),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
  };
}

function toMessage(r: Row): ChatMessage {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    channel: String(r.channel),
    role: String(r.role) as ChatMessage['role'],
    agentId: textOrNull(r.agent_id),
    agentName: textOrNull(r.agent_name),
    text: String(r.text),
    runId: textOrNull(r.run_id),
    status: String(r.status) as ChatMessage['status'],
    error: textOrNull(r.error),
    attachments: parse(r.attachments_json),
    createdAt: Number(r.created_at),
  };
}

function toMission(r: Row): Mission {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    goal: String(r.goal),
    status: String(r.status) as MissionStatus,
    mode: String(r.mode) as Mission['mode'],
    coordinatorId: textOrNull(r.coordinator_id),
    agentIds: parse(r.agent_ids_json),
    settings: parse(r.settings_json),
    planSummary: textOrNull(r.plan_summary),
    pauseReason: textOrNull(r.pause_reason),
    report: textOrNull(r.report),
    notes: parse(r.notes_json),
    isolation: String(r.isolation) as Mission['isolation'],
    baseBranch: textOrNull(r.base_branch),
    integrationBranch: textOrNull(r.integration_branch),
    mergeStatus: String(r.merge_status) as Mission['mergeStatus'],
    workflowId: textOrNull(r.workflow_id),
    createdAt: Number(r.created_at),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
  };
}

function toTask(r: Row): Task {
  return {
    id: String(r.id),
    missionId: String(r.mission_id),
    position: Number(r.position),
    title: String(r.title),
    description: String(r.description),
    assigneeId: textOrNull(r.assignee_id),
    assigneeName: String(r.assignee_name),
    type: String(r.type) as Task['type'],
    priority: Number(r.priority),
    dependsOn: parse(r.depends_on_json),
    status: String(r.status) as Task['status'],
    round: Number(r.round),
    isFix: Number(r.is_fix) === 1,
    attempts: Number(r.attempts),
    verdict: textOrNull(r.verdict) as Task['verdict'],
    result: textOrNull(r.result),
    handoff: textOrNull(r.handoff),
    filesChanged: parse(r.files_changed_json),
    errorKind: textOrNull(r.error_kind) as ErrorKind | null,
    errorText: textOrNull(r.error_text),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
    runIf: String(r.run_if) as Task['runIf'],
    maxAttempts: numOrNull(r.max_attempts),
    mergeFrom: textOrNull(r.merge_from),
    approvedAt: numOrNull(r.approved_at),
  };
}

function toQueueItem(r: Row): QueueItem {
  return {
    id: String(r.id),
    position: Number(r.position),
    goal: String(r.goal),
    status: String(r.status) as QueueItem['status'],
    missionId: textOrNull(r.mission_id),
    reason: textOrNull(r.reason),
    inputTokens: Number(r.input_spent),
    outputTokens: Number(r.output_spent),
    runsWithoutUsage: Number(r.runs_without_usage),
    createdAt: Number(r.created_at),
    startedAt: numOrNull(r.started_at),
    endedAt: numOrNull(r.ended_at),
  };
}

function toWorkflow(r: Row): Workflow {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    nodes: parse(r.nodes_json),
    edges: parse(r.edges_json),
    builtin: false,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function toMemory(r: Row): MemoryItem {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kind: String(r.kind) as MemoryItem['kind'],
    text: String(r.text),
    source: textOrNull(r.source),
    missionId: textOrNull(r.mission_id),
    createdAt: Number(r.created_at),
  };
}

function toEvent(r: Row): StoredRunEvent {
  return {
    id: Number(r.id),
    runId: String(r.run_id),
    ts: Number(r.ts),
    event: parse<AgentEvent>(r.payload_json),
  };
}

export interface SqlitePersistence extends Persistence {
  readonly database: DatabaseSync;
  readonly opened: OpenResult;
}

export function createSqlitePersistence(file: string, backupsDir: string): SqlitePersistence {
  const opened = openDatabase(file, backupsDir);
  const { db } = opened;

  const all = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).all(...params) as Row[];
  const one = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).get(...params) as Row | undefined;
  const run = (sql: string, ...params: SQLInputValue[]) => db.prepare(sql).run(...params);

  const toQueue = (r: Row): GoalQueue => ({
    id: String(r.id),
    projectId: String(r.project_id),
    workflowId: String(r.workflow_id),
    onFailure: String(r.on_failure) as GoalQueue['onFailure'],
    tokenLimit: numOrNull(r.spend_limit),
    running: Boolean(r.running),
    stopReason: textOrNull(r.stop_reason),
    items: all('SELECT * FROM goal_queue_items WHERE queue_id = ? ORDER BY position', String(r.id)).map(toQueueItem),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  });

  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const toolkitIds = (agentId: string): string[] =>
    all('SELECT toolkit_id FROM agent_toolkits WHERE agent_id = ? ORDER BY toolkit_id', agentId)
      .map((row) => String(row.toolkit_id));

  const toAgent = (r: Row): Agent => ({
    id: String(r.id),
    name: String(r.name),
    role: String(r.role) as RoleId,
    roleTitle: textOrNull(r.role_title),
    instructions: textOrNull(r.instructions),
    provider: String(r.provider),
    profileId: textOrNull(r.profile_id),
    model: textOrNull(r.model),
    effort: textOrNull(r.effort),
    permission: String(r.permission) as PermissionLevel,
    color: String(r.color),
    toolkitIds: toolkitIds(String(r.id)),
    createdAt: Number(r.created_at),
  });

  const insertTask = (t: Task): void => {
    run(
      `INSERT INTO tasks (id, mission_id, position, title, description, assignee_id, assignee_name, type, priority, depends_on_json, status, round, is_fix, attempts, verdict, result, handoff, files_changed_json, error_kind, error_text, started_at, ended_at, run_if, max_attempts, merge_from, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.id,
      t.missionId,
      t.position,
      t.title,
      t.description,
      t.assigneeId,
      t.assigneeName,
      t.type,
      t.priority,
      JSON.stringify(t.dependsOn),
      t.status,
      t.round,
      t.isFix ? 1 : 0,
      t.attempts,
      t.verdict,
      t.result,
      t.handoff,
      JSON.stringify(t.filesChanged),
      t.errorKind,
      t.errorText,
      t.startedAt,
      t.endedAt,
      t.runIf,
      t.maxAttempts,
      t.mergeFrom,
      t.approvedAt,
    );
  };

  const setAgentToolkits = (agent: Agent): void => {
    run('DELETE FROM agent_toolkits WHERE agent_id = ?', agent.id);
    for (const toolkitId of agent.toolkitIds) {
      run('INSERT INTO agent_toolkits (agent_id, toolkit_id) VALUES (?, ?)', agent.id, toolkitId);
    }
  };

  return {
    database: db,
    opened,

    settings: {
      async get<T>(key: string) {
        const row = one('SELECT value_json FROM settings WHERE key = ?', key);
        return row ? parse<T>(row.value_json) : null;
      },
      async set(key, value) {
        run(
          'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
          key,
          JSON.stringify(value),
        );
      },
    },

    profiles: {
      async list() {
        return all('SELECT * FROM profiles ORDER BY created_at').map(toProfile);
      },
      async get(id) {
        const row = one('SELECT * FROM profiles WHERE id = ?', id);
        return row ? toProfile(row) : null;
      },
      async insert(p) {
        run(
          'INSERT INTO profiles (id, provider, label, home_dir, auth_json, usage_json, totals_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          p.id,
          p.provider,
          p.label,
          p.homeDir,
          p.auth ? JSON.stringify(p.auth) : null,
          p.usage ? JSON.stringify(p.usage) : null,
          JSON.stringify(p.totals),
          p.createdAt,
        );
      },
      async updateLabel(id, label) {
        run('UPDATE profiles SET label = ? WHERE id = ?', label, id);
      },
      async getApiKeyCipher(id) {
        return textOrNull(one('SELECT api_key_cipher FROM profiles WHERE id = ?', id)?.api_key_cipher);
      },
      async setApiKeyCipher(id, cipher) {
        run('UPDATE profiles SET api_key_cipher = ? WHERE id = ?', cipher, id);
      },
      async updateAuth(id, auth) {
        run('UPDATE profiles SET auth_json = ? WHERE id = ?', JSON.stringify(auth), id);
      },
      async updateUsage(id, usage) {
        run('UPDATE profiles SET usage_json = ? WHERE id = ?', JSON.stringify(usage), id);
      },
      async updateTotals(id, totals) {
        run('UPDATE profiles SET totals_json = ? WHERE id = ?', JSON.stringify(totals), id);
      },
      async delete(id) {
        run('DELETE FROM profiles WHERE id = ?', id);
      },
    },

    agents: {
      async list() {
        return all('SELECT * FROM agents ORDER BY created_at').map(toAgent);
      },
      async get(id) {
        const row = one('SELECT * FROM agents WHERE id = ?', id);
        return row ? toAgent(row) : null;
      },
      async insert(a) {
        transaction(() => {
          run(
            'INSERT INTO agents (id, name, role, role_title, instructions, provider, profile_id, model, effort, permission, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            a.id,
            a.name,
            a.role,
            a.roleTitle,
            a.instructions,
            a.provider,
            a.profileId,
            a.model,
            a.effort,
            a.permission,
            a.color,
            a.createdAt,
          );
          setAgentToolkits(a);
        });
      },
      async update(a) {
        transaction(() => {
          run(
            'UPDATE agents SET name = ?, role = ?, role_title = ?, instructions = ?, provider = ?, profile_id = ?, model = ?, effort = ?, permission = ?, color = ? WHERE id = ?',
            a.name,
            a.role,
            a.roleTitle,
            a.instructions,
            a.provider,
            a.profileId,
            a.model,
            a.effort,
            a.permission,
            a.color,
            a.id,
          );
          setAgentToolkits(a);
        });
      },
      async delete(id) {
        run('DELETE FROM agents WHERE id = ?', id);
      },
    },

    projects: {
      async list() {
        return all('SELECT * FROM projects ORDER BY created_at').map(toProject);
      },
      async get(id) {
        const row = one('SELECT * FROM projects WHERE id = ?', id);
        return row ? toProject(row) : null;
      },
      async findByPath(path) {
        const row = one('SELECT * FROM projects WHERE path = ?', path);
        return row ? toProject(row) : null;
      },
      async insert(p) {
        run(
          'INSERT INTO projects (id, name, path, info_json, created_at) VALUES (?, ?, ?, ?, ?)',
          p.id,
          p.name,
          p.path,
          JSON.stringify(p.info),
          p.createdAt,
        );
      },
      async updateInfo(id, info) {
        run('UPDATE projects SET info_json = ? WHERE id = ?', JSON.stringify(info), id);
      },
      async delete(id) {
        run('DELETE FROM projects WHERE id = ?', id);
      },
    },

    toolkits: {
      async list() {
        return all('SELECT * FROM toolkits ORDER BY created_at').map(toToolkit);
      },
      async get(id) {
        const row = one('SELECT * FROM toolkits WHERE id = ?', id);
        return row ? toToolkit(row) : null;
      },
      async insert(t) {
        run(
          'INSERT INTO toolkits (id, name, description, plugin_path, enabled_in_default_account, skills_json, mcp_json, exclusive, preset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          t.id,
          t.name,
          t.description,
          t.pluginPath,
          t.enabledInDefaultAccount ? 1 : 0,
          JSON.stringify(t.skills),
          t.mcp ? JSON.stringify(t.mcp) : null,
          t.exclusive ? 1 : 0,
          t.preset,
          t.createdAt,
        );
      },
      async update(t) {
        run(
          'UPDATE toolkits SET name = ?, description = ?, mcp_json = ?, exclusive = ? WHERE id = ?',
          t.name,
          t.description,
          t.mcp ? JSON.stringify(t.mcp) : null,
          t.exclusive ? 1 : 0,
          t.id,
        );
      },
      async delete(id) {
        run('DELETE FROM toolkits WHERE id = ?', id);
      },
    },

    customProviders: {
      async list() {
        return all('SELECT * FROM custom_providers ORDER BY created_at').map((r): CustomProvider => ({
          id: String(r.id),
          name: String(r.name),
          command: String(r.command),
          args: String(r.args),
          homeEnv: textOrNull(r.home_env),
          loginCommand: textOrNull(r.login_command),
          createdAt: Number(r.created_at),
        }));
      },
      async insert(p) {
        run(
          'INSERT INTO custom_providers (id, name, command, args, home_env, login_command, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          p.id,
          p.name,
          p.command,
          p.args,
          p.homeEnv,
          p.loginCommand,
          p.createdAt,
        );
      },
      async delete(id) {
        run('DELETE FROM custom_providers WHERE id = ?', id);
      },
    },

    sessions: {
      async get(key) {
        const row = one(
          'SELECT session_id FROM provider_sessions WHERE agent_id = ? AND project_id = ? AND profile_key = ?',
          key.agentId,
          key.projectId,
          profileKey(key),
        );
        return row ? String(row.session_id) : null;
      },
      async set(key, sessionId) {
        run(
          `INSERT INTO provider_sessions (agent_id, project_id, profile_key, session_id, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(agent_id, project_id, profile_key) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
          key.agentId,
          key.projectId,
          profileKey(key),
          sessionId,
          Date.now(),
        );
      },
      async clear(key) {
        run(
          'DELETE FROM provider_sessions WHERE agent_id = ? AND project_id = ? AND profile_key = ?',
          key.agentId,
          key.projectId,
          profileKey(key),
        );
      },
    },

    runs: {
      async insert(r) {
        run(
          `INSERT INTO runs (id, agent_id, agent_name, profile_id, project_id, provider, status, prompt, permission, command, session_id, model, exit_code, error_kind, error_text, final_text, usage_json, files_changed_json, log_path, mission_id, task_id, queued_at, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.id,
          r.agentId,
          r.agentName,
          r.profileId,
          r.projectId,
          r.provider,
          r.status,
          r.prompt,
          r.permission,
          r.command,
          r.sessionId,
          r.model,
          r.exitCode,
          r.errorKind,
          r.errorText,
          r.finalText,
          r.usage ? JSON.stringify(r.usage) : null,
          JSON.stringify(r.filesChanged),
          r.logPath,
          r.missionId,
          r.taskId,
          r.queuedAt,
          r.startedAt,
          r.endedAt,
        );
      },
      async update(r) {
        run(
          `UPDATE runs SET status = ?, command = ?, session_id = ?, model = ?, exit_code = ?, error_kind = ?, error_text = ?, final_text = ?, usage_json = ?, files_changed_json = ?, log_path = ?, started_at = ?, ended_at = ? WHERE id = ?`,
          r.status,
          r.command,
          r.sessionId,
          r.model,
          r.exitCode,
          r.errorKind,
          r.errorText,
          r.finalText,
          r.usage ? JSON.stringify(r.usage) : null,
          JSON.stringify(r.filesChanged),
          r.logPath,
          r.startedAt,
          r.endedAt,
          r.id,
        );
      },
      async get(id) {
        const row = one('SELECT * FROM runs WHERE id = ?', id);
        return row ? toRun(row) : null;
      },
      async list(filter: RunFilter = {}) {
        const where: string[] = [];
        const params: SQLInputValue[] = [];
        if (filter.projectId) {
          where.push('project_id = ?');
          params.push(filter.projectId);
        }
        if (filter.agentId) {
          where.push('agent_id = ?');
          params.push(filter.agentId);
        }
        if (filter.missionId) {
          where.push('mission_id = ?');
          params.push(filter.missionId);
        }
        if (filter.status) {
          where.push('status = ?');
          params.push(filter.status);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        params.push(filter.limit ?? 100);
        return all(`SELECT * FROM runs ${clause} ORDER BY queued_at DESC LIMIT ?`, ...params).map(toRun);
      },
      async markUnfinishedAsInterrupted(now) {
        const changed = run(
          `UPDATE runs SET status = 'interrupted', ended_at = ?, error_text = 'O XinoIA foi fechado durante a execução.' WHERE status IN ('queued', 'running')`,
          now,
        );
        return Number(changed.changes);
      },
    },

    runEvents: {
      async append(runId, ts, event) {
        const inserted = run(
          'INSERT INTO run_events (run_id, ts, type, payload_json) VALUES (?, ?, ?, ?)',
          runId,
          ts,
          event.type,
          JSON.stringify(event),
        );
        return { id: Number(inserted.lastInsertRowid), runId, ts, event };
      },
      async listForRun(runId, afterId = 0) {
        return all('SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id', runId, afterId).map(toEvent);
      },
      async listAfter(afterId, limit = 2000) {
        return all('SELECT * FROM run_events WHERE id > ? ORDER BY id LIMIT ?', afterId, limit).map(toEvent);
      },
      async listForProject(projectId, limit = 5000) {
        const rows = all(
          `SELECT e.* FROM run_events e JOIN runs r ON r.id = e.run_id
           WHERE r.project_id = ? ORDER BY e.id DESC LIMIT ?`,
          projectId,
          limit,
        );
        return rows.reverse().map(toEvent);
      },
      async lastId() {
        const row = one('SELECT coalesce(max(id), 0) AS last FROM run_events');
        return Number(row?.last ?? 0);
      },
    },

    messages: {
      async insert(m) {
        run(
          `INSERT INTO messages (id, project_id, channel, role, agent_id, agent_name, text, run_id, status, error, attachments_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          m.id,
          m.projectId,
          m.channel,
          m.role,
          m.agentId,
          m.agentName,
          m.text,
          m.runId,
          m.status,
          m.error,
          JSON.stringify(m.attachments),
          m.createdAt,
        );
      },
      async update(m) {
        run('UPDATE messages SET text = ?, run_id = ?, status = ?, error = ? WHERE id = ?', m.text, m.runId, m.status, m.error, m.id);
      },
      async get(id) {
        const row = one('SELECT * FROM messages WHERE id = ?', id);
        return row ? toMessage(row) : null;
      },
      async list(projectId, channel, limit = 300) {
        const rows = all(
          'SELECT * FROM messages WHERE project_id = ? AND channel = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
          projectId,
          channel,
          limit,
        );
        return rows.reverse().map(toMessage);
      },
      async search(projectId, query, limit = 50) {
        const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
        return all(
          `SELECT * FROM messages WHERE project_id = ? AND text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
          projectId,
          like,
          limit,
        ).map(toMessage);
      },
      async clearChannel(projectId, channel) {
        run('DELETE FROM messages WHERE project_id = ? AND channel = ?', projectId, channel);
      },
      async markStreamingAsInterrupted() {
        run(`UPDATE messages SET status = 'cancelled', error = 'O XinoIA foi fechado durante a resposta.' WHERE status = 'streaming'`);
      },
    },

    metrics: {
      async counts(projectId) {
        const filter = projectId ? 'WHERE project_id = ?' : '';
        const params = projectId ? [projectId] : [];
        const group = (sql: string, ...values: SQLInputValue[]) =>
          Object.fromEntries(all(sql, ...values).map((row) => [String(row.status), Number(row.total)]));
        const tasks = projectId
          ? group(`SELECT t.status, count(*) AS total FROM tasks t JOIN missions m ON m.id = t.mission_id WHERE m.project_id = ? GROUP BY t.status`, projectId)
          : group('SELECT status, count(*) AS total FROM tasks GROUP BY status');
        const usageRows = all(`SELECT usage_json FROM runs ${filter ? `${filter} AND` : 'WHERE'} usage_json IS NOT NULL`, ...params);
        const tokens = { input: 0, output: 0, runsWithData: usageRows.length };
        for (const row of usageRows) {
          const usage = parse<{ inputTokens: number; outputTokens: number }>(row.usage_json);
          tokens.input += usage.inputTokens;
          tokens.output += usage.outputTokens;
        }
        const average = one(
          `SELECT avg(ended_at - started_at) AS value FROM runs ${filter ? `${filter} AND` : 'WHERE'} started_at IS NOT NULL AND ended_at IS NOT NULL`,
          ...params,
        );
        return {
          runs: group(`SELECT status, count(*) AS total FROM runs ${filter} GROUP BY status`, ...params),
          tasks,
          missions: group(`SELECT status, count(*) AS total FROM missions ${filter} GROUP BY status`, ...params),
          tokens,
          averageRunMs: average?.value === null || average?.value === undefined ? null : Number(average.value),
        };
      },
    },

    queues: {
      async list() {
        return all('SELECT * FROM goal_queues ORDER BY created_at').map(toQueue);
      },
      async getForProject(projectId) {
        const row = one('SELECT * FROM goal_queues WHERE project_id = ?', projectId);
        return row ? toQueue(row) : null;
      },
      async save(q) {
        transaction(() => {
          run(
            `INSERT INTO goal_queues (id, project_id, workflow_id, on_failure, spend_limit, running, stop_reason, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET workflow_id = excluded.workflow_id, on_failure = excluded.on_failure, spend_limit = excluded.spend_limit,
               running = excluded.running, stop_reason = excluded.stop_reason, updated_at = excluded.updated_at`,
            q.id,
            q.projectId,
            q.workflowId,
            q.onFailure,
            q.tokenLimit,
            q.running ? 1 : 0,
            q.stopReason,
            q.createdAt,
            q.updatedAt,
          );
          run('DELETE FROM goal_queue_items WHERE queue_id = ?', q.id);
          for (const item of q.items) {
            run(
              `INSERT INTO goal_queue_items (id, queue_id, position, goal, status, mission_id, reason, input_spent, output_spent, runs_without_usage, created_at, started_at, ended_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              item.id,
              q.id,
              item.position,
              item.goal,
              item.status,
              item.missionId,
              item.reason,
              item.inputTokens,
              item.outputTokens,
              item.runsWithoutUsage,
              item.createdAt,
              item.startedAt,
              item.endedAt,
            );
          }
        });
      },
    },

    workflows: {
      async list() {
        return all('SELECT * FROM workflows ORDER BY updated_at DESC').map(toWorkflow);
      },
      async get(id) {
        const row = one('SELECT * FROM workflows WHERE id = ?', id);
        return row ? toWorkflow(row) : null;
      },
      async insert(w) {
        run(
          'INSERT INTO workflows (id, name, description, nodes_json, edges_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          w.id,
          w.name,
          w.description,
          JSON.stringify(w.nodes),
          JSON.stringify(w.edges),
          w.createdAt,
          w.updatedAt,
        );
      },
      async update(w) {
        run(
          'UPDATE workflows SET name = ?, description = ?, nodes_json = ?, edges_json = ?, updated_at = ? WHERE id = ?',
          w.name,
          w.description,
          JSON.stringify(w.nodes),
          JSON.stringify(w.edges),
          w.updatedAt,
          w.id,
        );
      },
      async delete(id) {
        run('DELETE FROM workflows WHERE id = ?', id);
      },
    },

    memory: {
      async list(projectId, limit = 100) {
        return all('SELECT * FROM memory_items WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', projectId, limit).map(toMemory);
      },
      async insert(m) {
        run(
          'INSERT INTO memory_items (id, project_id, kind, text, source, mission_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          m.id,
          m.projectId,
          m.kind,
          m.text,
          m.source,
          m.missionId,
          m.createdAt,
        );
      },
      async delete(id) {
        run('DELETE FROM memory_items WHERE id = ?', id);
      },
    },

    missions: {
      async insert(m) {
        run(
          `INSERT INTO missions (id, project_id, goal, status, mode, coordinator_id, agent_ids_json, settings_json, plan_summary, pause_reason, report, notes_json, created_at, started_at, ended_at, isolation, base_branch, integration_branch, merge_status, workflow_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          m.id,
          m.projectId,
          m.goal,
          m.status,
          m.mode,
          m.coordinatorId,
          JSON.stringify(m.agentIds),
          JSON.stringify(m.settings),
          m.planSummary,
          m.pauseReason,
          m.report,
          JSON.stringify(m.notes),
          m.createdAt,
          m.startedAt,
          m.endedAt,
          m.isolation,
          m.baseBranch,
          m.integrationBranch,
          m.mergeStatus,
          m.workflowId,
        );
      },
      async update(m) {
        run(
          `UPDATE missions SET status = ?, coordinator_id = ?, agent_ids_json = ?, settings_json = ?, plan_summary = ?, pause_reason = ?, report = ?, notes_json = ?, started_at = ?, ended_at = ?, isolation = ?, base_branch = ?, integration_branch = ?, merge_status = ? WHERE id = ?`,
          m.status,
          m.coordinatorId,
          JSON.stringify(m.agentIds),
          JSON.stringify(m.settings),
          m.planSummary,
          m.pauseReason,
          m.report,
          JSON.stringify(m.notes),
          m.startedAt,
          m.endedAt,
          m.isolation,
          m.baseBranch,
          m.integrationBranch,
          m.mergeStatus,
          m.id,
        );
      },
      async get(id) {
        const row = one('SELECT * FROM missions WHERE id = ?', id);
        return row ? toMission(row) : null;
      },
      async list(filter = {}) {
        const limit = filter.limit ?? 50;
        const rows = filter.projectId
          ? all('SELECT * FROM missions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', filter.projectId, limit)
          : all('SELECT * FROM missions ORDER BY created_at DESC LIMIT ?', limit);
        return rows.map(toMission);
      },
      async listUnfinished() {
        return all(`SELECT * FROM missions WHERE status IN ('planning', 'running', 'reporting')`).map(toMission);
      },
    },

    tasks: {
      async replaceForMission(missionId, tasks) {
        transaction(() => {
          run('DELETE FROM tasks WHERE mission_id = ?', missionId);
          for (const task of tasks) insertTask(task);
        });
      },
      async insert(task) {
        insertTask(task);
      },
      async update(t) {
        run(
          `UPDATE tasks SET position = ?, title = ?, description = ?, assignee_id = ?, assignee_name = ?, type = ?, priority = ?, depends_on_json = ?, status = ?, round = ?, is_fix = ?, attempts = ?, verdict = ?, result = ?, handoff = ?, files_changed_json = ?, error_kind = ?, error_text = ?, started_at = ?, ended_at = ?, run_if = ?, max_attempts = ?, merge_from = ?, approved_at = ? WHERE id = ?`,
          t.position,
          t.title,
          t.description,
          t.assigneeId,
          t.assigneeName,
          t.type,
          t.priority,
          JSON.stringify(t.dependsOn),
          t.status,
          t.round,
          t.isFix ? 1 : 0,
          t.attempts,
          t.verdict,
          t.result,
          t.handoff,
          JSON.stringify(t.filesChanged),
          t.errorKind,
          t.errorText,
          t.startedAt,
          t.endedAt,
          t.runIf,
          t.maxAttempts,
          t.mergeFrom,
          t.approvedAt,
          t.id,
        );
      },
      async get(id) {
        const row = one('SELECT * FROM tasks WHERE id = ?', id);
        return row ? toTask(row) : null;
      },
      async listForMission(missionId) {
        return all('SELECT * FROM tasks WHERE mission_id = ? ORDER BY position', missionId).map(toTask);
      },
    },

    missionEvents: {
      async append(missionId, taskId, ts, data) {
        const inserted = run(
          'INSERT INTO mission_events (mission_id, task_id, ts, type, payload_json) VALUES (?, ?, ?, ?, ?)',
          missionId,
          taskId,
          ts,
          data.type,
          JSON.stringify(data),
        );
        return { id: Number(inserted.lastInsertRowid), missionId, taskId, ts, data };
      },
      async listForMission(missionId, afterId = 0) {
        return all('SELECT * FROM mission_events WHERE mission_id = ? AND id > ? ORDER BY id', missionId, afterId).map((r) => ({
          id: Number(r.id),
          missionId: String(r.mission_id),
          taskId: textOrNull(r.task_id),
          ts: Number(r.ts),
          data: parse<MissionEventData>(r.payload_json),
        }));
      },
    },

    async backup(reason) {
      return backupDatabase(db, backupsDir, reason);
    },

    async schemaVersion() {
      const row = one('PRAGMA user_version');
      return Number(row?.user_version ?? 0);
    },

    async close() {
      db.close();
    },
  };
}
