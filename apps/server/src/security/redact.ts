// Mascara segredos antes de qualquer coisa ser gravada ou enviada à interface. O
// agente pode imprimir um .env ou um token no terminal sem ninguém pedir.
const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-ant-[\w-]{10,}/g, 'sk-ant-***'],
  [/\bsk-[\w-]{20,}/g, 'sk-***'],
  [/\b(gh[pousr]|github_pat)_\w{16,}/g, '$1_***'],
  [/\bAIza[\w-]{30,}/g, 'AIza***'],
  [/\bxox[abprs]-[\w-]{10,}/g, 'xox*-***'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, 'jwt-***'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***chave-privada***'],
  [/\b(bearer)\s+[\w.~+/=-]{12,}/gi, '$1 ***'],
  [/\b([\w-]*(?:password|passwd|senha|secret|api[_-]?key|access[_-]?token|auth[_-]?token)[\w-]*)(["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, '$1$2***'],
];

export function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result;
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(redactDeep) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item)])) as T;
  }
  return value;
}
