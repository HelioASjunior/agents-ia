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
];
