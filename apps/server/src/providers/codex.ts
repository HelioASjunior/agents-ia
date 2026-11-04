import fs from 'node:fs';
import path from 'node:path';
import type { AgentEvent } from '@xinoia/shared';
import { baseName, classifyError, clip, parseJsonLine, safeArg } from './common.ts';
import type { LineParser, ProviderAdapter } from './types.ts';

function shownCommand(command: unknown): string {
  const text = String(command ?? '');
  const inner = text.match(/-Command\s+(.+)$/s) ?? text.match(/-lc\s+(.+)$/s);
  return (inner?.[1] ?? text).replace(/^['"]|['"]$/g, '');
}

function parseItem(phase: string, item: Record<string, any>, state: { hasText: boolean }): AgentEvent[] {
  const completed = phase === 'item.completed';
  switch (item.type) {
    case 'agent_message': {
      if (!completed || !item.text) return [];
      const text = state.hasText ? `\n\n${item.text}` : item.text;
      state.hasText = true;
      return [{ type: 'text', text }];
    }
    case 'reasoning':
      return completed && item.text ? [{ type: 'thinking', text: item.text }] : [];
    case 'command_execution': {
      if (phase === 'item.started') {
        const command = shownCommand(item.command);
        return [{ type: 'tool_start', toolId: item.id, name: 'Shell', summary: clip(command, 90), command }];
      }
      return completed
        ? [{ type: 'tool_end', toolId: item.id, ok: item.exit_code === 0, output: item.aggregated_output ?? '' }]
        : [];
    }
    case 'file_change': {
      if (!completed) return [];
      const changes: Array<{ path: string; kind?: string }> = item.changes ?? [];
      const summary = changes.length === 1 ? `Editando ${baseName(changes[0]?.path)}` : `Editando ${changes.length} arquivos`;
      return [
        { type: 'tool_start', toolId: item.id, name: 'Arquivos', summary, files: changes.map((c) => c.path) },
        {
          type: 'tool_end',
          toolId: item.id,
          ok: item.status !== 'failed',
          output: changes.map((c) => `${c.kind ?? 'update'} ${c.path}`).join('\n'),
        },
      ];
    }
    case 'mcp_tool_call':
      if (phase === 'item.started') {
        return [{ type: 'tool_start', toolId: item.id, name: 'MCP', summary: `${item.server}.${item.tool}` }];
      }
      return completed
        ? [{ type: 'tool_end', toolId: item.id, ok: item.status !== 'failed', output: item.error?.message ?? '' }]
        : [];
    case 'web_search':
      return completed
        ? [
            { type: 'tool_start', toolId: item.id, name: 'Web', summary: `Pesquisando ${clip(item.query, 60)}` },
            { type: 'tool_end', toolId: item.id, ok: true, output: '' },
          ]
        : [];
    case 'error': {
      if (!completed) return [];
      const text = String(item.message ?? '');
      // Reclamação sobre a configuração pessoal da conta: não diz respeito à tarefa.
      return [{ type: /ignoring \d+ unrecognized configuration/i.test(text) ? 'noise' : 'warning', text }];
    }
    default:
      return [];
  }
}

export function createCodexParser(): LineParser {
  const state = { hasText: false };
  return (line) => {
    const parsed = parseJsonLine(line);
    if (parsed.kind === 'empty') return [];
    if (parsed.kind === 'text') return [{ type: 'raw', text: parsed.text }];
    const j = parsed.value as Record<string, any>;
    switch (j.type) {
      case 'thread.started':
        return [{ type: 'session', sessionId: j.thread_id ?? null }];
      case 'turn.completed':
        return [{ type: 'usage', inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 }];
      case 'turn.failed':
        return [{ type: 'error', text: j.error?.message ?? 'O turno falhou.' }];
      case 'error':
        return [{ type: 'error', text: j.message ?? 'Erro desconhecido.' }];
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        return parseItem(j.type, j.item ?? {}, state);
      default:
        return [];
    }
  };
}

export const codexAdapter: ProviderAdapter = {
  id: 'codex',
  label: 'Codex CLI',
  command: 'codex',
  homeEnv: 'CODEX_HOME',
  defaultHomeDir: '.codex',
  support: 'tested',
  note: null,
  installCommand: 'npm install -g @openai/codex',
  installUrl: 'https://developers.openai.com/codex/cli',
  // Só vale no `codex exec`, que é como o XinoIA roda o Codex.
  apiKeyEnv: 'CODEX_API_KEY',
  apiKeyUrl: 'https://platform.openai.com/api-keys',
  loginCommand: 'codex login',
  logoutArgs: ['logout'],
  statusArgs: ['login', 'status'],
  capabilityProbe: {
    args: ['exec', '--help'],
    flags: {
      streamJson: '--json',
      resume: 'resume',
      mcp: '--config',
      sandbox: '--sandbox',
    },
  },
  models: [],
  efforts: ['low', 'medium', 'high', 'xhigh'],
  requiresProfile: true,

  prepareHome(homeDir) {
    // Guarda o login na pasta do perfil em vez do cofre do sistema, que é um só
    // para todos os perfis e misturaria as contas.
    const config = path.join(homeDir, 'config.toml');
    if (!fs.existsSync(config)) fs.writeFileSync(config, 'cli_auth_credentials_store = "file"\n');
  },

  parseStatus(stdout, stderr) {
    const text = `${stdout}\n${stderr}`;
    const none = { loggedIn: false, subscription: null, method: null, email: null, plan: null };
    if (/not logged in/i.test(text) || !/logged in/i.test(text)) return none;
    const subscription = /chatgpt/i.test(text);
    return { ...none, loggedIn: true, subscription, method: subscription ? 'ChatGPT' : 'Chave de API' };
  },

  // Recebe MCP HTTP por configuração de linha de comando. Servidores stdio exigiriam
  // listas com aspas, que não atravessam o cmd.exe com segurança. As skills vão pelo
  // prompt, porque este CLI não carrega plugins do Claude Code.
  toolArgs({ toolkits }) {
    const args: string[] = [];
    for (const kit of toolkits) {
      if (kit.mcp?.type === 'http') {
        args.push('-c', `mcp_servers.${kit.mcp.name}.url=${kit.mcp.url}`);
      }
    }
    return { args, loadsPlugins: false };
  },

  buildArgs({ model, effort, sessionId, permission, extraArgs = [] }) {
    const args = ['exec', '--json', '--skip-git-repo-check', ...extraArgs];
    if (permission === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', permission === 'read' ? 'read-only' : 'workspace-write');
    const m = safeArg(model, 'modelo');
    if (m) args.push('--model', m);
    const e = safeArg(effort, 'esforço');
    if (e) args.push('-c', `model_reasoning_effort=${e}`);
    const s = safeArg(sessionId, 'sessão');
    if (s) args.push('resume', s);
    args.push('-');
    return args;
  },

  // A saída de erro traz muito ruído de servidores MCP configurados pelo usuário.
  isNoise(line) {
    return /rmcp::|codex_core::|^\d{4}-\d\d-\d\dT\S+\s+(WARN|INFO|DEBUG)\b/.test(line);
  },

  createParser: createCodexParser,
  classifyError,
};
