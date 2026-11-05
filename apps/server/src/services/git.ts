import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitChange, GitCommit, GitStatus } from '@xinoia/shared';
import { badRequest } from '../errors.ts';

const exec = promisify(execFile);
const MAX_OUTPUT = 32 * 1024 * 1024;

export class GitError extends Error {
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

/** Sem shell, sem pedir senha no terminal, e sem depender do idioma do Git. */
export async function git(cwd: string, args: string[], timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await exec('git', args, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new GitError((failure.stderr || failure.message).trim(), failure.stdout ?? '', failure.stderr ?? '');
  }
}

async function identityArgs(cwd: string): Promise<string[]> {
  const email = await git(cwd, ['config', 'user.email']).catch(() => '');
  // Só usa um autor próprio se a pessoa não tiver configurado o dela.
  return email.trim() ? [] : ['-c', 'user.name=XinoIA', '-c', 'user.email=xinoia@users.noreply.github.com'];
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  return git(cwd, ['rev-parse', '--git-dir']).then(() => true, () => false);
}

export async function hasCommits(cwd: string): Promise<boolean> {
  return git(cwd, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false);
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const name = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
  return name && name !== 'HEAD' ? name : null;
}

/** A branch atual ou, sem branch, o commit. Null se o projeto não usa Git ou não tem commits. */
export async function currentHead(cwd: string): Promise<string | null> {
  return (await currentBranch(cwd)) ?? (await git(cwd, ['rev-parse', '--verify', 'HEAD']).then((value) => value.trim(), () => null));
}

export function parseStatus(output: string): GitChange[] {
  const changes: GitChange[] = [];
  const parts = output.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]!;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (code.includes('U') || code === 'AA' || code === 'DD') {
      changes.push({ path: file, status: 'U' });
    } else if (code.includes('R') || code.includes('C')) {
      changes.push({ path: file, status: 'R' });
      i += 1;
    } else if (code === '??') {
      changes.push({ path: file, status: '?' });
    } else {
      changes.push({ path: file, status: code.trim()[0] ?? 'M' });
    }
  }
  return changes;
}

export async function status(cwd: string): Promise<GitStatus> {
  if (!(await isGitRepo(cwd))) return { isRepo: false, branch: null, hasCommits: false, changes: [], commits: [] };
  const committed = await hasCommits(cwd);
  const changes = parseStatus(await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));
  let commits: GitCommit[] = [];
  if (committed) {
    const log = await git(cwd, ['log', '-20', '--format=%H%x00%s%x00%an%x00%ct%x00']);
    const fields = log.split('\0').map((field) => field.trim());
    for (let i = 0; i + 3 < fields.length; i += 4) {
      commits.push({ hash: fields[i]!, subject: fields[i + 1]!, author: fields[i + 2]!, date: Number(fields[i + 3]) * 1000 });
    }
    commits = commits.filter((commit) => commit.hash);
  }
  return { isRepo: true, branch: await currentBranch(cwd), hasCommits: committed, changes, commits };
}

export async function diffFile(cwd: string, file: string): Promise<string> {
  if (!(await hasCommits(cwd))) return '';
  return git(cwd, ['diff', 'HEAD', '--', file]);
}

export async function clone(url: string, target: string): Promise<void> {
  if (fs.existsSync(target) && fs.readdirSync(target).length) {
    throw badRequest('A pasta de destino já existe e não está vazia.', 'path_not_empty');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // `--` impede que um endereço malicioso seja lido como opção do Git, e os protocolos
  // ficam restritos para não permitir `ext::`, que executa comandos.
  await git(path.dirname(target), ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.http.allow=always', '-c', 'protocol.ssh.allow=always', 'clone', '--', url, target], 10 * 60_000)
    .catch((error: GitError) => {
      throw badRequest(`Não foi possível clonar: ${error.message.split('\n').at(-1)}`, 'clone_failed');
    });
}

// ---------------------------------------------------------------------------
// Isolamento por worktree
// ---------------------------------------------------------------------------

const safeBranchPart = (value: string) => value.replace(/[^\w-]/g, '-');

export interface Isolation {
  baseBranch: string;
  integrationBranch: string;
}

function worktreesRoot(dataDir: string, missionId: string): string {
  return path.join(dataDir, 'worktrees', safeBranchPart(missionId));
}

/** Cria o ramo que recebe o trabalho da missão, sem tocar no ramo atual do usuário. */
export async function startIsolation(projectPath: string, dataDir: string, missionId: string): Promise<Isolation> {
  const baseBranch = (await currentBranch(projectPath)) ?? (await git(projectPath, ['rev-parse', 'HEAD'])).trim();
  const integrationBranch = `xinoia/${safeBranchPart(missionId)}`;
  const integration = path.join(worktreesRoot(dataDir, missionId), 'integracao');
  fs.mkdirSync(path.dirname(integration), { recursive: true });
  await git(projectPath, ['worktree', 'add', '-q', '-b', integrationBranch, integration, baseBranch]);
  return { baseBranch, integrationBranch };
}

export function integrationPath(dataDir: string, missionId: string): string {
  return path.join(worktreesRoot(dataDir, missionId), 'integracao');
}

/** Pasta de trabalho só desta tarefa, a partir do que já foi integrado. */
export async function createTaskWorktree(projectPath: string, dataDir: string, missionId: string, taskId: string, integrationBranch: string): Promise<{ dir: string; branch: string }> {
  const branch = `${integrationBranch}-${safeBranchPart(taskId)}`;
  const dir = path.join(worktreesRoot(dataDir, missionId), safeBranchPart(taskId));
  await removeTaskWorktree(projectPath, dir, branch);
  await git(projectPath, ['worktree', 'add', '-q', '-b', branch, dir, integrationBranch]);
  return { dir, branch };
}

export async function removeTaskWorktree(projectPath: string, dir: string, branch: string): Promise<void> {
  await git(projectPath, ['worktree', 'remove', '--force', dir]).catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await git(projectPath, ['worktree', 'prune']).catch(() => undefined);
  await git(projectPath, ['branch', '-D', branch]).catch(() => undefined);
}

/** Registra o que o agente deixou na pasta dele. Devolve false se nada mudou. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, ['add', '-A']);
  const pending = (await git(dir, ['status', '--porcelain=v1', '-z'])).length > 0;
  const merging = fs.existsSync(path.join(await gitDir(dir), 'MERGE_HEAD'));
  if (!pending && !merging) return false;
  await git(dir, [...(await identityArgs(dir)), 'commit', '-q', '-m', message, '--no-verify']);
  return true;
}

async function gitDir(dir: string): Promise<string> {
  const value = (await git(dir, ['rev-parse', '--git-dir'])).trim();
  return path.isAbsolute(value) ? value : path.join(dir, value);
}

/** Com uma destas operações pela metade, guardar o trabalho misturaria tudo em um commit só. */
const UNFINISHED = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'];

async function freeBranchName(cwd: string, wanted: string): Promise<string> {
  const taken = (name: string) => git(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true, () => false);
  let name = wanted;
  for (let attempt = 2; await taken(name); attempt += 1) name = `${wanted}-${attempt}`;
  return name;
}

export interface SavedWork {
  /** Onde o trabalho ficou, ou null se não havia nada para guardar. */
  branch: string | null;
  /** O trabalho está seguro, mas o projeto não voltou para a branch de origem. */
  returnError: string | null;
}

/**
 * Tira o trabalho da pasta sem apagar nada: as alterações viram um commit em uma branch
 * própria, respeitando o .gitignore, e a pasta volta para `back`. Sem alterações, mas em
 * outra branch, o trabalho já está nela. Se o commit falhar, as alterações ficam na pasta.
 */
export async function saveWorkToBranch(cwd: string, wanted: string, back: string, message: string): Promise<SavedWork> {
  const dir = await gitDir(cwd);
  const { changes } = await status(cwd);
  if (UNFINISHED.some((name) => fs.existsSync(path.join(dir, name))) || changes.some((change) => change.status === 'U')) {
    throw new Error('o Git está no meio de um merge ou rebase, ou há arquivos em conflito.');
  }
  const backAt = (await git(cwd, ['rev-parse', '--verify', `${back}^{commit}`]).catch(() => {
    throw new Error(`${back} não existe mais.`);
  })).trim();
  const here = await currentBranch(cwd);
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim();

  let branch: string | null = null;
  if (changes.length) {
    branch = await freeBranchName(cwd, wanted);
    await git(cwd, ['checkout', '-q', '-b', branch]);
    try {
      await commitAll(cwd, message);
    } catch (error) {
      await git(cwd, ['checkout', '-q', here ?? head]).catch(() => undefined);
      await git(cwd, ['branch', '-D', branch]).catch(() => undefined);
      throw error;
    }
  } else if (here && here !== back) {
    branch = here;
  } else if (!here && head !== backAt) {
    branch = await freeBranchName(cwd, wanted);
    await git(cwd, ['branch', branch]);
  }

  if (!branch && here === back) return { branch, returnError: null };
  const returnError = await git(cwd, ['checkout', '-q', back]).then(() => null, (error: Error) => error.message);
  return { branch, returnError };
}

export interface MergeResult {
  ok: boolean;
  conflicts: string[];
}

/** Tenta integrar. Em conflito, desfaz e informa os arquivos: nada é sobrescrito. */
export async function merge(dir: string, branch: string, message: string): Promise<MergeResult> {
  try {
    await git(dir, [...(await identityArgs(dir)), 'merge', '--no-ff', '-q', '-m', message, '--', branch]);
    return { ok: true, conflicts: [] };
  } catch (error) {
    const conflicts = parseStatus(await git(dir, ['status', '--porcelain=v1', '-z']))
      .filter((change) => change.status === 'U')
      .map((change) => change.path);
    await git(dir, ['merge', '--abort']).catch(() => undefined);
    if (conflicts.length) return { ok: false, conflicts };
    // Arquivo que não está no Git seria sobrescrito: é um conflito como outro qualquer,
    // só que o Git recusa antes de começar.
    const text = error instanceof GitError ? error.stderr : '';
    if (/untracked working tree files would be overwritten/.test(text)) {
      const files = text.split('\n').filter((line) => /^\s+\S/.test(line)).map((line) => line.trim());
      return { ok: false, conflicts: files };
    }
    throw error;
  }
}

/** Deixa o conflito na pasta, com as marcações, para o agente resolver. */
export async function startConflictingMerge(dir: string, branch: string): Promise<string[]> {
  await git(dir, [...(await identityArgs(dir)), 'merge', '--no-commit', '--', branch]).catch(() => undefined);
  return parseStatus(await git(dir, ['status', '--porcelain=v1', '-z']))
    .filter((change) => change.status === 'U')
    .map((change) => change.path);
}

export async function changedFilesBetween(projectPath: string, base: string, branch: string): Promise<string[]> {
  const output = await git(projectPath, ['diff', '--name-only', `${base}...${branch}`]).catch(() => '');
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export async function diffBetween(projectPath: string, base: string, branch: string): Promise<string> {
  return git(projectPath, ['diff', `${base}...${branch}`]).catch(() => '');
}

/** Encerra o isolamento da missão: apaga as pastas e os ramos temporários. */
export async function finishIsolation(projectPath: string, dataDir: string, missionId: string, integrationBranch: string): Promise<void> {
  const root = worktreesRoot(dataDir, missionId);
  await git(projectPath, ['worktree', 'remove', '--force', path.join(root, 'integracao')]).catch(() => undefined);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await git(projectPath, ['worktree', 'prune']).catch(() => undefined);
  const branches = await git(projectPath, ['branch', '--list', `${integrationBranch}*`, '--format=%(refname:short)']).catch(() => '');
  for (const branch of branches.split('\n').map((line) => line.trim()).filter(Boolean)) {
    await git(projectPath, ['branch', '-D', branch]).catch(() => undefined);
  }
}
