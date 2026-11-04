export interface Migration {
  version: number;
  name: string;
  up: string;
}

// Nunca altere uma migração já publicada. Mudanças de esquema entram como uma nova,
// porque bancos de usuários podem estar em qualquer versão anterior.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'estrutura inicial',
    up: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      ) STRICT;

      -- Sem coluna de credencial: o login fica com cada CLI, na pasta do perfil.
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        home_dir TEXT,
        auth_json TEXT,
        usage_json TEXT,
        totals_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_profiles_provider ON profiles(provider);

      CREATE TABLE custom_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        args TEXT NOT NULL,
        home_env TEXT,
        login_command TEXT,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE toolkits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        plugin_path TEXT,
        enabled_in_default_account INTEGER NOT NULL,
        skills_json TEXT NOT NULL,
        mcp_json TEXT,
        exclusive INTEGER NOT NULL,
        preset TEXT,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        role_title TEXT,
        instructions TEXT,
        provider TEXT NOT NULL,
        profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
        model TEXT,
        effort TEXT,
        permission TEXT NOT NULL,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_agents_profile ON agents(profile_id);

      CREATE TABLE agent_toolkits (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        toolkit_id TEXT NOT NULL REFERENCES toolkits(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, toolkit_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_agent_toolkits_toolkit ON agent_toolkits(toolkit_id);

      -- Só a referência à pasta. O código fica no sistema de arquivos.
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        info_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE provider_sessions (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        profile_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, project_id, profile_key)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        agent_name TEXT NOT NULL,
        profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        permission TEXT NOT NULL,
        command TEXT,
        session_id TEXT,
        model TEXT,
        exit_code INTEGER,
        error_kind TEXT,
        error_text TEXT,
        final_text TEXT,
        usage_json TEXT,
        files_changed_json TEXT NOT NULL,
        log_path TEXT,
        queued_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      ) STRICT;
      CREATE INDEX idx_runs_project_time ON runs(project_id, queued_at DESC);
      CREATE INDEX idx_runs_agent_time ON runs(agent_id, queued_at DESC);
      CREATE INDEX idx_runs_status ON runs(status);

      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_run_events_run ON run_events(run_id, id);
    `,
  },
  {
    version: 2,
    name: 'missões e tarefas',
    up: `
      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        coordinator_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        agent_ids_json TEXT NOT NULL,
        settings_json TEXT NOT NULL,
        plan_summary TEXT,
        pause_reason TEXT,
        report TEXT,
        notes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at INTEGER
      ) STRICT;
      CREATE INDEX idx_missions_project_time ON missions(project_id, created_at DESC);
      CREATE INDEX idx_missions_status ON missions(status);

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        position REAL NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        assignee_name TEXT NOT NULL,
        type TEXT NOT NULL,
        priority INTEGER NOT NULL,
        depends_on_json TEXT NOT NULL,
        status TEXT NOT NULL,
        round INTEGER NOT NULL,
        is_fix INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        verdict TEXT,
        result TEXT,
        handoff TEXT,
        files_changed_json TEXT NOT NULL,
        error_kind TEXT,
        error_text TEXT,
        started_at INTEGER,
        ended_at INTEGER
      ) STRICT;
      CREATE INDEX idx_tasks_mission ON tasks(mission_id, position);
      CREATE INDEX idx_tasks_status ON tasks(status);

      CREATE TABLE mission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX idx_mission_events_mission ON mission_events(mission_id, id);

      ALTER TABLE runs ADD COLUMN mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL;
      ALTER TABLE runs ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
      CREATE INDEX idx_runs_task ON runs(task_id);
      CREATE INDEX idx_runs_mission ON runs(mission_id);
    `,
  },
  {
    version: 3,
    name: 'conversas',
    up: `
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        role TEXT NOT NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        agent_name TEXT,
        text TEXT NOT NULL,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        error TEXT,
        attachments_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_messages_channel ON messages(project_id, channel, created_at);
      CREATE INDEX idx_messages_run ON messages(run_id);
    `,
  },
  {
    version: 4,
    name: 'workflows, memória e isolamento',
    up: `
      CREATE TABLE workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        edges_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE memory_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT,
        mission_id TEXT REFERENCES missions(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_memory_project ON memory_items(project_id, created_at DESC);

      ALTER TABLE tasks ADD COLUMN run_if TEXT NOT NULL DEFAULT 'always';
      ALTER TABLE tasks ADD COLUMN max_attempts INTEGER;
      ALTER TABLE tasks ADD COLUMN merge_from TEXT;
      ALTER TABLE tasks ADD COLUMN approved_at INTEGER;

      ALTER TABLE missions ADD COLUMN isolation TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE missions ADD COLUMN base_branch TEXT;
      ALTER TABLE missions ADD COLUMN integration_branch TEXT;
      ALTER TABLE missions ADD COLUMN merge_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE missions ADD COLUMN workflow_id TEXT;
    `,
  },
  {
    version: 5,
    name: 'chave de API cifrada por perfil',
    up: `
      -- Só o texto cifrado pelo sistema operacional, nunca a chave.
      ALTER TABLE profiles ADD COLUMN api_key_cipher TEXT;
    `,
  },
];
