import fs from 'node:fs';
import path from 'node:path';
import type { AgentEvent } from '@xinoia/shared';
import { baseName, classifyError, clip, parseJsonLine, safeArg } from './common.ts';
import type { LineParser, ProviderAdapter } from './types.ts';

function describe(name: string, input: Record<string, unknown> = {}): { summary: string; command?: string; files?: string[] } {
  const file = input.file_path ?? input.path ?? input.absolute_path;
  if (/write|replace|edit/i.test(name)) return { summary: `Editando ${baseName(file)}`, files: [String(file)] };
  if (/read/i.test(name)) return { summary: `Lendo ${baseName(file)}` };
  if (/shell|command/i.test(name)) return { summary: clip(input.command, 90), command: String(input.command ?? '') };
  if (/search|grep|glob/i.test(name)) return { summary: `Buscando ${clip(input.pattern ?? input.query, 60)}` };
  return { summary: name };
}

export function createGeminiParser(): LineParser {
  return (line) => {
    const parsed = parseJsonLine(line);
    if (parsed.kind === 'empty') return [];
    if (parsed.kind === 'text') return [{ type: 'raw', text: parsed.text }];
    const j = parsed.value as Record<string, any>;
    switch (j.type) {
      case 'init':
        return [{ type: 'session', sessionId: j.session_id ?? null, model: j.model ?? null }];
      case 'message':
        return j.role === 'assistant' && j.content ? [{ type: 'text', text: j.content }] : [];
      case 'tool_use':
        return [{ type: 'tool_start', toolId: j.tool_id, name: j.tool_name, ...describe(j.tool_name, j.parameters) }];
      case 'tool_result':
        return [{
          type: 'tool_end',
          toolId: j.tool_id,
          ok: j.status !== 'error',
          output: typeof j.output === 'string' ? j.output : j.error?.message ?? '',
        }];
      case 'error':
        return j.severity === 'error'
          ? [{ type: 'error', text: j.message }]
          : [{ type: 'warning', text: j.message }];
      case 'result': {
        const failed = j.status === 'error';
        const event: AgentEvent = {
          type: 'final',
          ok: !failed,
          text: '',
          error: failed ? j.error?.message ?? 'Falhou.' : null,
          ...(j.stats ? { inputTokens: j.stats.input_tokens ?? 0, outputTokens: j.stats.output_tokens ?? 0 } : {}),
        };
        return [event];
      }
      default:
        return [];
    }
  };
}

// Escrito a partir da documentação oficial. O Gemini CLI não estava instalado na
// máquina de desenvolvimento, então `support` fica 'documented' até ser testado.
export const geminiAdapter: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  command: 'gemini',
  homeEnv: 'GEMINI_CLI_HOME',
  defaultHomeDir: '.gemini',
  support: 'documented',
  note: 'Adaptador escrito pela documentação, ainda sem teste com conta real. A documentação do Google informa que o Gemini CLI foi substituído pelo Antigravity CLI.',
  installCommand: 'npm install -g @google/gemini-cli',
  installUrl: 'https://geminicli.com/docs',
  apiKeyEnv: 'GEMINI_API_KEY',
  apiKeyUrl: 'https://aistudio.google.com/apikey',
  loginCommand: 'gemini',
  logoutArgs: null,
  statusArgs: null,
  capabilityProbe: {
    args: ['--help'],
    flags: {
      streamJson: '--output-format',
      resume: '--resume',
      approvalMode: '--approval-mode',
    },
  },
  models: ['auto', 'pro', 'flash', 'flash-lite'],
  efforts: [],
  requiresProfile: true,

  // Só confere se o arquivo existe; o conteúdo da credencial nunca é lido.
  statusFromHome(homeDir) {
    const loggedIn = fs.existsSync(path.join(homeDir, '.gemini', 'oauth_creds.json'))
      || fs.existsSync(path.join(homeDir, 'oauth_creds.json'));
    return { loggedIn, subscription: null, method: loggedIn ? 'Google' : null, email: null, plan: null };
  },

  toolArgs() {
    return { args: [], loadsPlugins: false };
  },

  buildArgs({ model, sessionId, permission, extraArgs = [] }) {
    const mode = { read: 'plan', edit: 'auto_edit', full: 'yolo' }[permission];
    const args = ['--output-format', 'stream-json', `--approval-mode=${mode}`, ...extraArgs];
    const m = safeArg(model, 'modelo');
    if (m) args.push('--model', m);
    const s = safeArg(sessionId, 'sessão');
    if (s) args.push('--resume', s);
    return args;
  },

  createParser: createGeminiParser,
  classifyError,
};
