import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Agent, DiscoveredToolkit, McpServer, Profile, Skill, Toolkit } from '@xinoia/shared';
import { CreateToolkitInput, McpServer as McpServerSchema } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import type { ProviderAdapter } from '../providers/types.ts';

const UNREAL_PLUGIN = 'unreal-engine-skills-for-claude-code';
export const UNREAL_MCP_DEFAULT_URL = 'http://127.0.0.1:8000/mcp';

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function readSkillInfo(file: string): { name?: string; description?: string } {
  try {
    const block = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    return {
      name: block.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
      description: block.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, ''),
    };
  } catch {
    return {};
  }
}

function readSkills(pluginPath: string): Skill[] {
  const dir = path.join(pluginPath, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => {
      const file = path.join(dir, entry.name, 'SKILL.md');
      const info = readSkillInfo(file);
      return { name: info.name ?? entry.name, description: info.description ?? '', file };
    });
}

interface InstalledPlugin {
  key: string;
  name: string;
  description: string;
  pluginPath: string;
  enabled: boolean;
}

interface RawServer {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

const hasSecrets = (server: RawServer): boolean =>
  Object.keys(server.env ?? {}).length > 0 || Object.keys(server.headers ?? {}).length > 0;

function quotePath(value: string): string {
  if (process.platform !== 'win32') return value;
  // Passa pelo cmd.exe, e estes caracteres escapariam das aspas.
  if (/["%]/.test(value)) throw new Error(`Caminho com caracteres não suportados: ${value}`);
  return `"${value}"`;
}

function probePort(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const socket = net.connect({
      host: parsed.hostname,
      port: Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80),
      timeout: 800,
    });
    const end = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => end(true));
    socket.once('timeout', () => end(false));
    socket.once('error', () => end(false));
  });
}

export interface ResolvedToolkits {
  toolkits: Toolkit[];
  args: string[];
  promptNote: string;
  warnings: string[];
}

export class ToolkitService {
  private readonly config: AppConfig;
  private readonly db: Persistence;

  constructor(config: AppConfig, db: Persistence) {
    this.config = config;
    this.db = db;
  }

  private installedPlugins(): InstalledPlugin[] {
    const home = path.join(this.config.homeDir, '.claude');
    const installed = readJson<{ plugins?: Record<string, unknown> }>(path.join(home, 'plugins', 'installed_plugins.json'), {});
    const enabled = readJson<{ enabledPlugins?: Record<string, boolean> }>(path.join(home, 'settings.json'), {}).enabledPlugins ?? {};
    const plugins: InstalledPlugin[] = [];
    for (const [key, value] of Object.entries(installed.plugins ?? {})) {
      const entry = (Array.isArray(value) ? value[0] : value) as { installPath?: string } | undefined;
      if (!entry?.installPath || !fs.existsSync(entry.installPath)) continue;
      const manifest = readJson<{ name?: string; description?: string }>(path.join(entry.installPath, '.claude-plugin', 'plugin.json'), {});
      plugins.push({
        key,
        name: manifest.name ?? key.split('@')[0] ?? key,
        description: manifest.description ?? '',
        pluginPath: entry.installPath,
        enabled: Boolean(enabled[key]),
      });
    }
    return plugins;
  }

  private serversFrom(file: string): Record<string, RawServer> {
    return readJson<{ mcpServers?: Record<string, RawServer> }>(file, {}).mcpServers ?? {};
  }

  list(): Promise<Toolkit[]> {
    return this.db.toolkits.list();
  }

  /** Mostra o que está instalado para o usuário escolher. Nunca devolve valores de segredos. */
  async discover(projectPath?: string): Promise<DiscoveredToolkit[]> {
    const current = await this.db.toolkits.list();
    const found: DiscoveredToolkit[] = [];
    for (const plugin of this.installedPlugins()) {
      found.push({
        key: `plugin:${plugin.key}`,
        kind: 'plugin',
        name: plugin.name,
        description: plugin.description,
        skills: readSkills(plugin.pluginPath).map((skill) => skill.name),
        secret: false,
        added: current.some((kit) => kit.pluginPath === plugin.pluginPath),
      });
    }
    const addServers = (scope: string, servers: Record<string, RawServer>) => {
      for (const [name, server] of Object.entries(servers)) {
        found.push({
          key: `mcp:${scope}:${name}`,
          kind: 'mcp',
          name,
          description: server.url ?? server.command ?? '',
          skills: [],
          secret: hasSecrets(server),
          added: current.some((kit) => kit.mcp?.name === name),
        });
      }
    };
    addServers('user', this.serversFrom(path.join(this.config.homeDir, '.claude.json')));
    if (projectPath) addServers('project', this.serversFrom(path.join(projectPath, '.mcp.json')));
    return found;
  }

  async importDiscovered(key: string, projectPath?: string): Promise<Toolkit> {
    const [kind, ...rest] = key.split(':');
    if (kind === 'plugin') {
      const plugin = this.installedPlugins().find((p) => p.key === rest.join(':'));
      if (!plugin) throw notFound('Plugin');
      if (plugin.name === UNREAL_PLUGIN) return this.addUnreal();
      return this.insert({
        name: plugin.name,
        description: plugin.description,
        pluginPath: plugin.pluginPath,
        enabledInDefaultAccount: plugin.enabled,
        skills: readSkills(plugin.pluginPath),
      });
    }
    if (kind === 'mcp') {
      const [scope, name] = rest;
      const file = scope === 'user'
        ? path.join(this.config.homeDir, '.claude.json')
        : path.join(projectPath ?? '', '.mcp.json');
      const server = this.serversFrom(file)[name ?? ''];
      if (!server) throw notFound('Servidor MCP');
      if (hasSecrets(server)) {
        throw badRequest('Este servidor guarda segredos na configuração e não será copiado. Ele continua disponível para o login padrão deste computador.', 'has_secrets');
      }
      const mcp = McpServerSchema.parse(
        server.url
          ? { name, type: 'http', url: server.url }
          : { name, type: 'stdio', command: server.command, args: server.args ?? [] },
      );
      return this.insert({ name: name ?? mcp.name, description: server.url ?? server.command ?? '', mcp });
    }
    throw badRequest('Item desconhecido.');
  }

  async create(input: unknown): Promise<Toolkit> {
    const data = CreateToolkitInput.parse(input);
    return this.insert({
      name: data.name,
      description: data.description,
      mcp: data.mcp ?? null,
      exclusive: data.exclusive,
    });
  }

  private async insert(fields: Partial<Toolkit> & { name: string }): Promise<Toolkit> {
    const toolkit: Toolkit = {
      id: newId('kit'),
      description: '',
      pluginPath: null,
      enabledInDefaultAccount: false,
      skills: [],
      mcp: null,
      exclusive: false,
      preset: null,
      createdAt: Date.now(),
      ...fields,
    };
    await this.db.toolkits.insert(toolkit);
    return toolkit;
  }

  /** Skills da Epic mais as ferramentas do editor via MCP. */
  async addUnreal(url: string = UNREAL_MCP_DEFAULT_URL): Promise<Toolkit> {
    const existing = (await this.db.toolkits.list()).find((kit) => kit.preset === 'unreal');
    if (existing) return existing;
    const plugin = this.installedPlugins().find((p) => p.name === UNREAL_PLUGIN);
    return this.insert({
      name: 'Unreal Engine',
      description: 'Skills da Epic Games e ferramentas do Unreal Editor via MCP. O editor precisa estar aberto, com o servidor MCP iniciado.',
      pluginPath: plugin?.pluginPath ?? null,
      enabledInDefaultAccount: plugin?.enabled ?? false,
      skills: plugin ? readSkills(plugin.pluginPath) : [],
      mcp: McpServerSchema.parse({ name: 'unreal-mcp', type: 'http', url }),
      // A própria skill alerta que agentes simultâneos no mesmo editor podem conflitar.
      exclusive: true,
      preset: 'unreal',
    });
  }

  async update(id: string, patch: { url?: string; exclusive?: boolean }): Promise<Toolkit> {
    const toolkit = await this.db.toolkits.get(id);
    if (!toolkit) throw notFound('Integração');
    const next = { ...toolkit };
    if (patch.url !== undefined) {
      if (next.mcp?.type !== 'http') throw badRequest('Esta integração não usa URL.');
      next.mcp = McpServerSchema.parse({ ...next.mcp, url: patch.url });
    }
    if (patch.exclusive !== undefined) next.exclusive = patch.exclusive;
    await this.db.toolkits.update(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.db.toolkits.delete(id);
  }

  /** Quais servidores MCP HTTP estão respondendo agora, como o do Unreal Editor. */
  async health(): Promise<Record<string, boolean | null>> {
    const toolkits = await this.db.toolkits.list();
    const entries = await Promise.all(toolkits.map(async (kit) => [
      kit.id,
      kit.mcp?.type === 'http' ? await probePort(kit.mcp.url) : null,
    ] as const));
    return Object.fromEntries(entries);
  }

  private writeMcpConfig(servers: McpServer[]): string | null {
    if (!servers.length) return null;
    const mcpServers = Object.fromEntries(servers.map((server) => [
      server.name,
      server.type === 'http'
        ? { type: 'http', url: server.url }
        : { type: 'stdio', command: server.command, args: server.args },
    ]));
    const names = servers.map((server) => server.name).sort().join('_');
    const file = path.join(this.config.dataDir, 'mcp', `${names}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2));
    return file;
  }

  /** Traduz as integrações do agente para o que o CLI dele entende. */
  async resolve(agent: Agent, adapter: ProviderAdapter, profile: Profile | null, permission: Agent['permission']): Promise<ResolvedToolkits> {
    const all = await this.db.toolkits.list();
    const toolkits = all.filter((kit) => agent.toolkitIds.includes(kit.id));
    if (!toolkits.length) return { toolkits, args: [], promptNote: '', warnings: [] };

    const warnings: string[] = [];
    const servers = toolkits.flatMap((kit) => (kit.mcp ? [kit.mcp] : []));
    for (const server of servers) {
      if (server.type === 'http' && !(await probePort(server.url))) {
        warnings.push(`O servidor MCP ${server.name} não está respondendo em ${server.url}. Se for o Unreal, abra o editor e inicie o servidor.`);
      }
    }

    const tools = adapter.toolArgs?.({
      toolkits,
      profile,
      permission,
      mcpConfigFile: this.writeMcpConfig(servers),
      quotePath,
    }) ?? { args: [], loadsPlugins: false };

    if (!adapter.toolArgs && servers.length) {
      warnings.push(`${adapter.label} não recebe servidores MCP pelo XinoIA.`);
    }
    if (adapter.id === 'codex' && servers.some((server) => server.type === 'stdio')) {
      warnings.push('Codex só recebe MCP HTTP pelo XinoIA. Servidores stdio precisam estar no config.toml do perfil.');
    }
    if (adapter.id === 'gemini' && servers.length) {
      warnings.push('Gemini CLI ainda não recebe MCP pelo XinoIA. Configure o servidor no settings.json do perfil.');
    }

    const lines: string[] = [];
    if (!tools.loadsPlugins) {
      const skills = toolkits.flatMap((kit) => kit.skills);
      if (skills.length) {
        lines.push('Você tem estas skills em disco. Quando a tarefa se encaixar na descrição, leia o SKILL.md antes de agir e siga as instruções dele:');
        for (const skill of skills) {
          lines.push(`- ${skill.name}: ${skill.file}\n  Quando usar: ${skill.description.slice(0, 300)}`);
        }
      }
    }
    if (servers.length && permission === 'read') {
      lines.push('Sua permissão é somente leitura, então as ferramentas MCP não estão liberadas. Diga isso se a tarefa depender delas.');
    }
    return { toolkits, args: tools.args, promptNote: lines.join('\n'), warnings };
  }
}
