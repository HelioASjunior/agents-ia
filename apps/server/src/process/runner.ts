import readline from 'node:readline';
import type { AgentEvent, ErrorKind } from '@xinoia/shared';
import type { BuildArgsOptions, ProviderAdapter } from '../providers/types.ts';
import { killTree, spawnCli } from './spawn.ts';

export interface RunRequest {
  adapter: ProviderAdapter;
  prompt: string;
  cwd: string;
  env: Record<string, string>;
  options: BuildArgsOptions;
  inactivityMs: number;
  /** Tempo total máximo, mesmo que o agente continue ativo. */
  maxDurationMs?: number;
  onEvent: (event: AgentEvent) => void;
  /** Cada linha bruta da saída, para o log completo em arquivo. */
  onRawLine?: (stream: 'stdout' | 'stderr', line: string) => void;
}

export interface RunOutcome {
  ok: boolean;
  /** Tudo que o agente escreveu. */
  text: string;
  /** A resposta final, quando o CLI a separa do resto. */
  finalText: string;
  sessionId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorText: string | null;
  errorKind: ErrorKind | null;
  cancelled: boolean;
  exitCode: number | null;
  durationMs: number;
}

export interface RunHandle {
  done: Promise<RunOutcome>;
  cancel(): void;
}

export function startCliRun(request: RunRequest): RunHandle {
  const { adapter, prompt, cwd, env, options, inactivityMs, maxDurationMs, onEvent, onRawLine } = request;
  const startedAt = Date.now();
  const parse = adapter.createParser();
  const outcome: RunOutcome = {
    ok: false,
    text: '',
    finalText: '',
    sessionId: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    errorText: null,
    errorKind: null,
    cancelled: false,
    exitCode: null,
    durationMs: 0,
  };

  const child = spawnCli({ command: adapter.command, args: adapter.buildArgs(options), cwd, env, noShell: adapter.noShell });

  let settled = false;
  let timedOut = false;
  let stderrTail = '';
  let resolveDone!: (value: RunOutcome) => void;
  const done = new Promise<RunOutcome>((resolve) => { resolveDone = resolve; });

  let watchdog: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(watchdog);
    if (inactivityMs > 0) {
      watchdog = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, inactivityMs);
    }
  };
  touch();
  let overTime = false;
  const hardLimit = maxDurationMs
    ? setTimeout(() => {
        overTime = true;
        killTree(child);
      }, maxDurationMs)
    : undefined;

  const handle = (event: AgentEvent) => {
    switch (event.type) {
      case 'session':
        outcome.sessionId = event.sessionId ?? outcome.sessionId;
        outcome.model = event.model ?? outcome.model;
        break;
      case 'text':
        outcome.text += event.text;
        break;
      case 'usage':
        outcome.inputTokens = event.inputTokens;
        outcome.outputTokens = event.outputTokens;
        break;
      case 'final':
        outcome.finalText = event.text;
        if (event.inputTokens !== undefined) outcome.inputTokens = event.inputTokens;
        if (event.outputTokens !== undefined) outcome.outputTokens = event.outputTokens;
        if (event.error) outcome.errorText = event.error;
        break;
      case 'error':
        outcome.errorText = event.text;
        break;
      default:
        break;
    }
    onEvent(event);
  };

  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    touch();
    onRawLine?.('stdout', line);
    try {
      for (const event of parse(line)) handle(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: 'warning', text: `Linha do CLI ignorada: ${message}` });
    }
  });

  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    touch();
    if (!line.trim()) return;
    onRawLine?.('stderr', line);
    if (adapter.isNoise?.(line)) {
      onEvent({ type: 'noise', text: line });
      return;
    }
    stderrTail = `${stderrTail}\n${line}`.slice(-2000);
    onEvent({ type: 'stderr', text: line });
  });

  const finish = (code: number | null, spawnError?: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    clearTimeout(hardLimit);
    outcome.exitCode = code;
    outcome.durationMs = Date.now() - startedAt;
    if (spawnError) outcome.errorText = spawnError;
    if (timedOut) {
      outcome.errorText = `Sem atividade por ${Math.round(inactivityMs / 60_000)} min. A execução foi encerrada.`;
      outcome.errorKind = 'timeout';
    }
    if (overTime) {
      outcome.errorText = `A execução passou do limite de ${Math.round((maxDurationMs ?? 0) / 60_000)} min e foi encerrada.`;
      outcome.errorKind = 'timeout';
    }
    outcome.ok = code === 0 && !outcome.errorText && !outcome.cancelled;
    if (!outcome.ok && !outcome.cancelled && !outcome.errorText) {
      outcome.errorText = stderrTail.trim() || `O processo terminou com código ${code}.`;
    }
    if (outcome.errorText && !outcome.errorKind) {
      outcome.errorKind = adapter.classifyError(`${outcome.errorText}\n${stderrTail}`) ?? 'unknown';
    }
    outcome.finalText ||= outcome.text;
    resolveDone(outcome);
  };

  child.on('error', (error) => finish(-1, error.message));
  child.on('close', (code) => finish(code));
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  return {
    done,
    cancel() {
      outcome.cancelled = true;
      killTree(child);
    },
  };
}
