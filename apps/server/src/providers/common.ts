import type { ErrorKind } from '@xinoia/shared';

// O prompt nunca vai por argumento, só por stdin. Os poucos valores variáveis que
// viram argumento passam por esta validação antes de chegar ao shell.
const SAFE_ARG = /^[\w.:\-[\]/=]+$/;

export function safeArg(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = value.trim();
  if (!SAFE_ARG.test(text)) throw new Error(`Valor inválido para ${label}: ${text}`);
  return text;
}

export function clip(text: unknown, max = 120): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function baseName(filePath: unknown): string {
  const text = String(filePath ?? '');
  return text.split(/[\\/]/).filter(Boolean).pop() ?? text;
}

export function classifyError(text: string): ErrorKind | null {
  if (/no conversation found|session.*not found|thread.*not found|no rollout found/i.test(text)) return 'session';
  if (/usage limit|rate.?limit|limit reached|hit your .*limit|quota|too many requests|\b429\b|credit balance/i.test(text)) return 'limit';
  if (/not logged in|please run .*login|\/login|not authenticated|unauthorized|\b401\b|invalid api key|invalid authentication|oauth token/i.test(text)) return 'auth';
  if (/is not recognized|command not found|não é reconhecido|nao e reconhecido/i.test(text)) return 'missing';
  return null;
}

export type ParsedLine =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'json'; value: Record<string, unknown> };

export function parseJsonLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'empty' };
  if (!trimmed.startsWith('{')) return { kind: 'text', text: line };
  try {
    return { kind: 'json', value: JSON.parse(trimmed) as Record<string, unknown> };
  } catch {
    return { kind: 'text', text: line };
  }
}
