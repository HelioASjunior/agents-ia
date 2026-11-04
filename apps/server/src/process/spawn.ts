import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ProviderAdapter } from '../providers/types.ts';

const isWindows = process.platform === 'win32';

// Remove variáveis que fariam o CLI cobrar por API, usar outro servidor ou herdar
// a sessão de quem abriu o XinoIA. Sobra só o login do perfil escolhido.
const STRIPPED = /^(ANTHROPIC_|CLAUDE|OPENAI_|CODEX_|GEMINI_|GOOGLE_API_KEY|GOOGLE_GENAI_|AWS_BEARER_TOKEN_BEDROCK|NODE_TEST_CONTEXT)/i;
const HOME_VARIABLES = new Set(['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GEMINI_CLI_HOME']);

export function buildEnv(
  adapter: Pick<ProviderAdapter, 'homeEnv' | 'keepsApiEnv'>,
  homeDir: string | null,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (adapter.keepsApiEnv || !STRIPPED.test(key)) env[key] = value;
  }
  if (adapter.homeEnv) {
    if (homeDir) {
      env[adapter.homeEnv] = homeDir;
    } else if (HOME_VARIABLES.has(adapter.homeEnv) && source[adapter.homeEnv]) {
      // O próprio usuário escolheu onde fica o login padrão dele.
      env[adapter.homeEnv] = source[adapter.homeEnv]!;
    }
  }
  return env;
}

export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  noShell?: boolean;
}

export function spawnCli(spec: SpawnSpec): ChildProcessWithoutNullStreams {
  // No Windows os CLIs instalados pelo npm são scripts .cmd, que só rodam via shell.
  // Por isso os argumentos são validados e o prompt nunca é um deles.
  const options = {
    cwd: spec.cwd,
    env: spec.env,
    windowsHide: true,
    detached: !isWindows,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
  };
  if (isWindows && !spec.noShell) {
    const command = /\s/.test(spec.command) ? `"${spec.command}"` : spec.command;
    return spawn([command, ...spec.args].join(' '), { ...options, shell: true });
  }
  return spawn(spec.command, spec.args, options);
}

export function killTree(child: { pid?: number | undefined; kill: (signal?: NodeJS.Signals) => boolean }): void {
  if (!child.pid) return;
  if (isWindows) {
    // Encerra também os processos filhos, como os comandos que o agente abriu.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function capture(spec: SpawnSpec, timeoutMs = 20_000): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnCli(spec);
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error), timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end();
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}
