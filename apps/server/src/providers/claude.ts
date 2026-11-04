import type { AgentEvent, UsageWindow } from '@xinoia/shared';
import { baseName, classifyError, clip, parseJsonLine, safeArg } from './common.ts';
import type { LineParser, ProviderAdapter } from './types.ts';

const READ_ONLY_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';

interface ToolDescription {
  summary: string;
  command?: string;
  files?: string[];
}

function describeTool(name: string, input: Record<string, unknown> = {}): ToolDescription {
  const file = input.file_path ?? input.path ?? input.notebook_path;
  switch (name) {
    case 'Write':
      return { summary: `Criando ${baseName(file)}`, files: [String(file)] };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { summary: `Editando ${baseName(file)}`, files: [String(file)] };
    case 'Read':
      return { summary: `Lendo ${baseName(file)}` };
    case 'Bash':
    case 'PowerShell':
      return { summary: clip(input.command, 90), command: String(input.command ?? '') };
    case 'Grep':
    case 'Glob':
      return { summary: `Buscando ${clip(input.pattern, 60)}` };
    case 'WebSearch':
      return { summary: `Pesquisando ${clip(input.query, 60)}` };
    case 'WebFetch':
      return { summary: `Abrindo ${clip(input.url, 60)}` };
    case 'TodoWrite':
      return { summary: 'Atualizando lista de tarefas' };
    case 'Task':
    case 'Agent':
      return { summary: `Subagente: ${clip(input.description, 60)}` };
    default:
      return { summary: name };
  }
}

function toolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) => (part.type === 'text' ? part.text ?? '' : `[${part.type}]`))
      .join('\n');
  }
  return '';
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function normalizeWindows(raw: unknown): Record<string, UsageWindow> | null {
  if (!raw || typeof raw !== 'object') return null;
  const windows: Record<string, UsageWindow> = {};
  for (const [name, value] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    windows[name] = {
      utilization: typeof value.utilization === 'number' ? value.utilization : null,
      resetsAt: typeof value.resetsAt === 'number' ? value.resetsAt : null,
      status: typeof value.status === 'string' ? value.status : null,
    };
  }
  return windows;
}

export function createClaudeParser(): LineParser {
  const streamedMessages = new Set<unknown>();
  let hasText = false;

  return (line) => {
    const parsed = parseJsonLine(line);
    if (parsed.kind === 'empty') return [];
    if (parsed.kind === 'text') return [{ type: 'raw', text: parsed.text }];
    const j = parsed.value as Record<string, any>;
    const nested = Boolean(j.parent_tool_use_id);

    switch (j.type) {
      case 'system': {
        if (j.subtype !== 'init') return [];
        const events: AgentEvent[] = [{ type: 'session', sessionId: j.session_id ?? null, model: j.model ?? null }];
        if (j.apiKeySource && j.apiKeySource !== 'none') {
          events.push({ type: 'warning', text: `Usando credencial de API (${j.apiKeySource}), não a assinatura.` });
        }
        for (const server of j.mcp_servers ?? []) {
          // Conectores da conta que pedem login não afetam o trabalho; falha de um servidor sim.
          if (server.status === 'failed') {
            events.push({ type: 'warning', text: `MCP ${server.name}: ${server.status}` });
          }
        }
        return events;
      }

      case 'stream_event': {
        const event = j.event ?? {};
        if (nested) return [];
        if (event.type === 'message_start' && hasText) {
          return [{ type: 'text', text: '\n\n' }];
        }
        if (event.type === 'content_block_delta') {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            streamedMessages.add(j.api_message_id);
            hasText = true;
            return [{ type: 'text', text: event.delta.text }];
          }
          if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            return [{ type: 'thinking', text: event.delta.thinking }];
          }
        }
        return [];
      }

      case 'assistant': {
        const events: AgentEvent[] = [];
        for (const block of j.message?.content ?? []) {
          if (block.type === 'text' && block.text && !nested && !streamedMessages.has(j.message.id)) {
            hasText = true;
            events.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            events.push({ type: 'tool_start', toolId: block.id, name: block.name, nested, ...describeTool(block.name, block.input) });
          }
        }
        return events;
      }

      case 'user': {
        const content = j.message?.content;
        if (!Array.isArray(content)) return [];
        return content
          .filter((block: { type?: string }) => block.type === 'tool_result')
          .map((block: { tool_use_id: string; is_error?: boolean; content?: unknown }): AgentEvent => ({
            type: 'tool_end',
            toolId: block.tool_use_id,
            ok: !block.is_error,
            output: toolOutput(block.content),
            nested,
          }));
      }

      case 'rate_limit_event': {
        const info = j.rate_limit_info ?? {};
        return [{
          type: 'limits',
          status: info.status ?? null,
          resetsAt: info.resetsAt ?? null,
          windows: normalizeWindows(info.unifiedWindows),
        }];
      }

      case 'result': {
        const events: AgentEvent[] = [];
        const denied = [...new Set((j.permission_denials ?? []).map((d: { tool_name: string }) => d.tool_name))];
        if (denied.length) {
          events.push({
            type: 'warning',
            text: `Permissão negada para: ${denied.join(', ')}. Aumente a permissão do agente se ele precisar disso.`,
          });
        }
        const failed = Boolean(j.is_error) || j.subtype !== 'success';
        const usage = (j.usage ?? null) as ClaudeUsage | null;
        events.push({
          type: 'final',
          ok: !failed,
          text: j.result ?? '',
          error: failed ? j.result || (j.errors ?? []).join('\n') || j.subtype : null,
          ...(usage
            ? {
                inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
                outputTokens: usage.output_tokens ?? 0,
              }
            : {}),
        });
        return events;
      }

      default:
        return [];
    }
  };
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  homeEnv: 'CLAUDE_CONFIG_DIR',
  defaultHomeDir: '.claude',
  support: 'tested',
  note: null,
  installCommand: 'npm install -g @anthropic-ai/claude-code',
  installUrl: 'https://code.claude.com/docs',
  loginCommand: 'claude auth login',
  logoutArgs: ['auth', 'logout'],
  statusArgs: ['auth', 'status', '--json'],
  capabilityProbe: {
    args: ['--help'],
    flags: {
      streamJson: '--output-format',
      resume: '--resume',
      plugins: '--plugin-dir',
      mcp: '--mcp-config',
      effort: '--effort',
    },
  },
  models: ['fable', 'opus', 'sonnet', 'haiku'],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  requiresProfile: true,

  parseStatus(stdout) {
    const empty = { loggedIn: false, subscription: null, method: null, email: null, plan: null };
    try {
      const j = JSON.parse(stdout) as Record<string, unknown>;
      if (!j.loggedIn) return empty;
      return {
        loggedIn: true,
        subscription: j.authMethod === 'claude.ai',
        method: typeof j.authMethod === 'string' ? j.authMethod : null,
        email: typeof j.email === 'string' ? j.email : null,
        plan: typeof j.subscriptionType === 'string' ? j.subscriptionType : null,
      };
    } catch {
      return empty;
    }
  },

  // Carrega o plugin de verdade, o que funciona mesmo em perfis isolados. No modo
  // não interativo não há quem aprove um pedido, então as ferramentas MCP precisam
  // estar liberadas de antemão. Em "somente leitura" não são, porque não há como
  // saber quais delas alteram alguma coisa.
  toolArgs({ toolkits, profile, permission, mcpConfigFile, quotePath }) {
    const args: string[] = [];
    for (const kit of toolkits) {
      if (kit.pluginPath && !(kit.enabledInDefaultAccount && !profile?.homeDir)) {
        args.push('--plugin-dir', quotePath(kit.pluginPath));
      }
    }
    const servers = toolkits.flatMap((kit) => (kit.mcp ? [kit.mcp] : []));
    if (servers.length && mcpConfigFile) {
      args.push('--mcp-config', quotePath(mcpConfigFile));
      if (permission === 'edit') {
        args.push('--allowedTools', servers.map((server) => `mcp__${server.name}`).join(','));
      }
    }
    return { args, loadsPlugins: true };
  },

  policyArgs(policyFile, quotePath) {
    return ['--settings', quotePath(policyFile)];
  },

  buildArgs({ model, effort, sessionId, permission, extraArgs = [] }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
    if (permission === 'full') args.push('--dangerously-skip-permissions');
    else if (permission === 'read') args.push('--permission-mode', 'dontAsk', '--allowedTools', READ_ONLY_TOOLS);
    else args.push('--permission-mode', 'acceptEdits');
    const m = safeArg(model, 'modelo');
    if (m) args.push('--model', m);
    const e = safeArg(effort, 'esforço');
    if (e) args.push('--effort', e);
    const s = safeArg(sessionId, 'sessão');
    if (s) args.push('--resume', s);
    args.push(...extraArgs);
    return args;
  },

  createParser: createClaudeParser,
  classifyError,
};
