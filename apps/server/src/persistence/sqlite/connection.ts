import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, type Migration } from './migrations.ts';

const KEEP_BACKUPS = 5;

export class DatabaseTooNewError extends Error {}

function configure(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function isHealthy(db: DatabaseSync): boolean {
  try {
    const row = db.prepare('PRAGMA integrity_check(1)').get() as { integrity_check: string };
    return row.integrity_check === 'ok';
  } catch {
    return false;
  }
}

function hasUserData(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type = 'table'").get() as { total: number };
  return row.total > 0;
}

/** VACUUM INTO gera uma cópia consistente, incluindo o que ainda está no WAL. */
export function backupDatabase(db: DatabaseSync, backupsDir: string, reason: string): string {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupsDir, `xinoia-v${userVersion(db)}-${reason}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  pruneBackups(backupsDir);
  return file;
}

function listBackups(backupsDir: string): string[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => path.join(backupsDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function pruneBackups(backupsDir: string): void {
  for (const old of listBackups(backupsDir).slice(KEEP_BACKUPS)) fs.rmSync(old, { force: true });
}

/**
 * Cada migração roda em uma transação própria: se falhar, o banco fica exatamente
 * na versão anterior. Antes de mexer em um banco que já tem dados, faz uma cópia.
 */
export function applyMigrations(
  db: DatabaseSync,
  backupsDir: string,
  migrations: Migration[] = MIGRATIONS,
): { from: number; to: number; backup: string | null } {
  const from = userVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (from > latest) {
    throw new DatabaseTooNewError(
      `O banco de dados é da versão ${from}, mais nova que esta versão do XinoIA (${latest}). Atualize o XinoIA para abrir estes dados.`,
    );
  }
  const pending = migrations.filter((m) => m.version > from);
  if (!pending.length) return { from, to: from, backup: null };

  const backup = hasUserData(db) ? backupDatabase(db, backupsDir, 'pre-migracao') : null;
  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.up);
      db.exec(`PRAGMA user_version = ${Number(migration.version)}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migração ${migration.version} (${migration.name}) falhou e foi desfeita: ${message}`);
    }
  }
  return { from, to: latest, backup };
}

function moveCorrupted(file: string): string {
  const aside = `${file}.corrompido-${Date.now()}`;
  fs.renameSync(file, aside);
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
  return aside;
}

export interface OpenResult {
  db: DatabaseSync;
  recoveredFrom: string | null;
  backup: string | null;
}

function tryOpenHealthy(file: string): DatabaseSync | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    configure(db);
    if (isHealthy(db)) return db;
  } catch {
    // tratado abaixo como banco danificado
  }
  try {
    db?.close();
  } catch {
    // já estava inutilizável
  }
  return null;
}

/**
 * Abre o banco. Se estiver danificado, guarda o arquivo ao lado (nunca apaga) e
 * restaura a cópia de segurança mais recente que estiver íntegra.
 */
export function openDatabase(file: string, backupsDir: string, migrations: Migration[] = MIGRATIONS): OpenResult {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let recoveredFrom: string | null = null;
  let db = tryOpenHealthy(file);

  if (!db) {
    moveCorrupted(file);
    for (const candidate of listBackups(backupsDir)) {
      fs.copyFileSync(candidate, file);
      db = tryOpenHealthy(file);
      if (db) {
        recoveredFrom = candidate;
        break;
      }
      moveCorrupted(file);
    }
    db ??= tryOpenHealthy(file);
    if (!db) throw new Error(`Não foi possível criar o banco de dados em ${file}.`);
  }

  try {
    const { backup } = applyMigrations(db, backupsDir, migrations);
    return { db, recoveredFrom, backup };
  } catch (error) {
    db.close();
    throw error;
  }
}
