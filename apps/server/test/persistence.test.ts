import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import type { Agent, Profile, Run } from '@xinoia/shared';
import { applyMigrations, backupDatabase, DatabaseTooNewError, openDatabase } from '../src/persistence/sqlite/connection.ts';
import { createSqlitePersistence } from '../src/persistence/sqlite/index.ts';
import { MIGRATIONS } from '../src/persistence/sqlite/migrations.ts';
import { removeDir, tempDir } from './support/harness.ts';

function paths() {
  const dir = tempDir();
  return { dir, file: path.join(dir, 'x.db'), backups: path.join(dir, 'backups') };
}

const pragma = (db: DatabaseSync, name: string) => Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];

test('Configuração: WAL, chaves estrangeiras, busy timeout e migração inicial', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups);
  assert.equal(pragma(db, 'journal_mode'), 'wal');
  assert.equal(pragma(db, 'foreign_keys'), 1);
  assert.equal(pragma(db, 'busy_timeout'), 5000);
  assert.equal(pragma(db, 'user_version'), MIGRATIONS.at(-1)?.version);
  db.close();
  removeDir(dir);
});

test('Índices esperados existem', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups);
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((r) => r.name);
  for (const expected of ['idx_runs_project_time', 'idx_runs_agent_time', 'idx_runs_status', 'idx_run_events_run']) {
    assert.ok(names.includes(expected), expected);
  }
  db.close();
  removeDir(dir);
});

test('Nenhuma coluna guarda credenciais', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  for (const { name } of tables) {
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>;
    for (const column of columns) {
      assert.doesNotMatch(column.name, /password|senha|secret|token|credential|api_?key|cookie/i, `${name}.${column.name}`);
    }
  }
  db.close();
  removeDir(dir);
});

test('Migração que falha é desfeita e o banco continua na versão anterior', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups, [{ version: 1, name: 'a', up: 'CREATE TABLE a (v TEXT) STRICT;' }]);
  db.exec("INSERT INTO a VALUES ('dado do usuário')");

  assert.throws(
    () => applyMigrations(db, backups, [
      { version: 1, name: 'a', up: 'CREATE TABLE a (v TEXT) STRICT;' },
      { version: 2, name: 'quebrada', up: 'CREATE TABLE b (v TEXT) STRICT; INSERT INTO nao_existe VALUES (1);' },
    ]),
    /Migração 2 \(quebrada\) falhou e foi desfeita/,
  );

  assert.equal(pragma(db, 'user_version'), 1);
  assert.equal((db.prepare('SELECT v FROM a').get() as { v: string }).v, 'dado do usuário');
  const b = db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE name = 'b'").get() as { total: number };
  assert.equal(b.total, 0, 'a parte que chegou a rodar foi desfeita');
  db.close();
  removeDir(dir);
});

test('Antes de migrar um banco com dados, é feita uma cópia íntegra', () => {
  const { dir, file, backups } = paths();
  const first = [{ version: 1, name: 'a', up: 'CREATE TABLE a (v TEXT) STRICT;' }];
  const { db } = openDatabase(file, backups, first);
  db.exec("INSERT INTO a VALUES ('importante')");

  const result = applyMigrations(db, backups, [...first, { version: 2, name: 'b', up: 'ALTER TABLE a ADD COLUMN w TEXT;' }]);
  assert.equal(result.from, 1);
  assert.equal(result.to, 2);
  assert.ok(result.backup && fs.existsSync(result.backup));

  const copy = new DatabaseSync(result.backup!);
  assert.equal((copy.prepare('SELECT v FROM a').get() as { v: string }).v, 'importante');
  assert.equal(pragma(copy, 'user_version'), 1);
  copy.close();
  db.close();
  removeDir(dir);
});

test('Banco inicial novo não gera cópia inútil', () => {
  const { dir, file, backups } = paths();
  const { db, backup } = openDatabase(file, backups);
  assert.equal(backup, null);
  db.close();
  removeDir(dir);
});

test('Banco de versão mais nova que o app é recusado sem alteração', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups);
  db.exec('PRAGMA user_version = 999');
  db.close();
  assert.throws(() => openDatabase(file, backups), DatabaseTooNewError);
  const check = new DatabaseSync(file);
  assert.equal(pragma(check, 'user_version'), 999);
  check.close();
  removeDir(dir);
});

test('Banco danificado é guardado ao lado e restaurado da última cópia', () => {
  const { dir, file, backups } = paths();
  const first = [{ version: 1, name: 'a', up: 'CREATE TABLE a (v TEXT) STRICT;' }];
  const { db } = openDatabase(file, backups, first);
  db.exec("INSERT INTO a VALUES ('salvo')");
  backupDatabase(db, backups, 'manual');
  db.close();

  fs.writeFileSync(file, 'isto não é um banco de dados, é lixo '.repeat(200));

  const reopened = openDatabase(file, backups, first);
  assert.ok(reopened.recoveredFrom);
  assert.equal((reopened.db.prepare('SELECT v FROM a').get() as { v: string }).v, 'salvo');
  reopened.db.close();
  assert.ok(fs.readdirSync(dir).some((name) => name.includes('corrompido')), 'o arquivo danificado não foi apagado');
  removeDir(dir);
});

test('Sem cópia disponível, um banco danificado vira um banco novo e o antigo é preservado', () => {
  const { dir, file, backups } = paths();
  fs.writeFileSync(file, 'lixo '.repeat(1000));
  const { db, recoveredFrom } = openDatabase(file, backups);
  assert.equal(recoveredFrom, null);
  assert.equal(pragma(db, 'user_version'), MIGRATIONS.at(-1)?.version);
  db.close();
  assert.ok(fs.readdirSync(dir).some((name) => name.includes('corrompido')));
  removeDir(dir);
});

test('Cópias antigas são descartadas, mantendo as 5 mais recentes', () => {
  const { dir, file, backups } = paths();
  const { db } = openDatabase(file, backups);
  for (let i = 0; i < 8; i += 1) backupDatabase(db, backups, `r${i}`);
  assert.equal(fs.readdirSync(backups).length, 5);
  db.close();
  removeDir(dir);
});

const profile: Profile = {
  id: 'p1',
  provider: 'claude',
  label: 'Conta',
  homeDir: 'p1',
  auth: null,
  usage: null,
  totals: { runs: 0, inputTokens: 0, outputTokens: 0 },
  createdAt: 1,
};
const agent: Agent = {
  id: 'a1',
  name: 'Ana',
  role: 'developer',
  roleTitle: null,
  instructions: null,
  provider: 'claude',
  profileId: 'p1',
  model: null,
  effort: null,
  permission: 'edit',
  color: '#000000',
  toolkitIds: [],
  createdAt: 1,
};
const run: Run = {
  id: 'r1',
  agentId: 'a1',
  agentName: 'Ana',
  profileId: 'p1',
  logPath: null,
  projectId: 'pr1',
  provider: 'claude',
  status: 'running',
  prompt: 'oi',
  permission: 'edit',
  command: null,
  sessionId: null,
  model: null,
  exitCode: null,
  errorKind: null,
  errorText: null,
  finalText: null,
  usage: null,
  filesChanged: [],
  queuedAt: 1,
  startedAt: 1,
  endedAt: null,
};

test('Repositórios: remoções respeitam as chaves estrangeiras', async () => {
  const { dir, file, backups } = paths();
  const db = createSqlitePersistence(file, backups);
  await db.profiles.insert(profile);
  await db.agents.insert(agent);
  await db.projects.insert({ id: 'pr1', name: 'x', path: 'C:\\x', info: { isGit: false, branch: null, isUnreal: false, stack: [] }, createdAt: 1 });
  await db.runs.insert(run);
  await db.runEvents.append('r1', 1, { type: 'text', text: 'olá' });

  // Sem o perfil, o agente continua existindo e só fica sem conta.
  await db.profiles.delete('p1');
  assert.equal((await db.agents.get('a1'))?.profileId, null);

  // Sem o agente, o histórico continua, com o nome dele.
  await db.agents.delete('a1');
  const orphan = await db.runs.get('r1');
  assert.equal(orphan?.agentId, null);
  assert.equal(orphan?.agentName, 'Ana');

  // Sem o projeto, o histórico dele vai junto.
  await db.projects.delete('pr1');
  assert.equal(await db.runs.get('r1'), null);
  assert.deepEqual(await db.runEvents.listForRun('r1'), []);

  await db.close();
  removeDir(dir);
});

test('Escrita concorrente de muitos eventos mantém a ordem', async () => {
  const { dir, file, backups } = paths();
  const db = createSqlitePersistence(file, backups);
  await db.projects.insert({ id: 'pr1', name: 'x', path: 'C:\\x', info: { isGit: false, branch: null, isUnreal: false, stack: [] }, createdAt: 1 });
  await db.runs.insert({ ...run, agentId: null, profileId: null });
  await Promise.all(Array.from({ length: 500 }, (_, i) => db.runEvents.append('r1', i, { type: 'text', text: String(i) })));
  const events = await db.runEvents.listForRun('r1');
  assert.equal(events.length, 500);
  assert.ok(events.every((e, i) => e.event.type === 'text' && e.event.text === String(i)));
  assert.equal(await db.runEvents.lastId(), events.at(-1)?.id);
  await db.close();
  removeDir(dir);
});

test('Sessões são separadas por conta', async () => {
  const { dir, file, backups } = paths();
  const db = createSqlitePersistence(file, backups);
  await db.profiles.insert(profile);
  await db.agents.insert({ ...agent, profileId: null });
  await db.projects.insert({ id: 'pr1', name: 'x', path: 'C:\\x', info: { isGit: false, branch: null, isUnreal: false, stack: [] }, createdAt: 1 });
  const key = { agentId: 'a1', projectId: 'pr1', profileId: 'p1' };
  await db.sessions.set(key, 's1');
  await db.sessions.set(key, 's2');
  assert.equal(await db.sessions.get(key), 's2');
  assert.equal(await db.sessions.get({ ...key, profileId: null }), null);
  await db.sessions.clear(key);
  assert.equal(await db.sessions.get(key), null);
  await db.close();
  removeDir(dir);
});
