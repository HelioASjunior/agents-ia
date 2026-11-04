import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { IPty } from 'node-pty';
import type { TerminalInfo } from '@xinoia/shared';
import { CreateTerminalInput } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { buildEnv } from '../process/spawn.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { redact } from '../security/redact.ts';
import type { ProfileService } from './profiles.ts';

const SCROLLBACK_BYTES = 256 * 1024;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export interface TerminalSession extends TerminalInfo {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  subscribe(listener: (message: { type: 'data'; data: string } | { type: 'exit'; code: number }) => void): () => void;
  kill(): void;
  /** O que já apareceu, para quem conectar depois. */
  scrollback(): string;
}

function loadPty(): typeof import('node-pty') {
  // node-pty é um módulo nativo: só carrega quando um terminal é aberto de fato.
  const require = createRequire(import.meta.url);
  return require('node-pty') as typeof import('node-pty');
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly config: AppConfig;
  private readonly db: Persistence;
  private readonly providers: ProviderRegistry;
  private readonly profiles: ProfileService;

  constructor(config: AppConfig, db: Persistence, providers: ProviderRegistry, profiles: ProfileService) {
    this.config = config;
    this.db = db;
    this.providers = providers;
    this.profiles = profiles;
  }

  get(id: string): TerminalSession {
    const session = this.sessions.get(id);
    if (!session) throw notFound('Terminal');
    return session;
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map(({ id, kind, title }) => ({ id, kind, title }));
  }

  async create(input: unknown): Promise<TerminalInfo> {
    const data = CreateTerminalInput.parse(input);
    if (data.kind === 'shell') {
      const project = await this.db.projects.get(data.projectId);
      if (!project) throw notFound('Projeto');
      const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
      const env = { ...process.env } as Record<string, string>;
      return this.spawn('shell', `Terminal: ${project.name}`, shell, [], project.path, env);
    }

    // Só roda o comando oficial do adaptador, nunca um texto vindo da requisição.
    if (data.kind === 'install') {
      const adapter = this.providers.get(data.provider);
      if (!adapter?.installCommand) throw badRequest('Esta ferramenta não tem instalador.');
      const env = buildEnv(adapter, null);
      return process.platform === 'win32'
        ? this.spawn('install', `Instalar: ${adapter.label}`, 'cmd.exe', `/c ${adapter.installCommand}`, os.homedir(), env)
        : this.spawn('install', `Instalar: ${adapter.label}`, process.env.SHELL || 'bash', ['-lc', adapter.installCommand], os.homedir(), env);
    }

    const profile = await this.db.profiles.get(data.profileId);
    if (!profile) throw notFound('Perfil');
    const adapter = this.providers.get(profile.provider);
    if (!adapter?.loginCommand) throw badRequest('Este provedor não tem comando de login.');
    const env = buildEnv(adapter, this.profiles.homeOf(profile));
    const [shell, args] = process.platform === 'win32'
      ? ['cmd.exe', ['/c', adapter.loginCommand]] as const
      : [process.env.SHELL || 'bash', ['-lc', adapter.loginCommand]] as const;
    return this.spawn('login', `Login: ${profile.label}`, shell, [...args], os.homedir(), env);
  }

  /** Endereço que o login mostrou, para abrir de novo se o navegador não abriu sozinho. */
  loginLink(id: string): string | null {
    const session = this.get(id);
    if (session.kind !== 'login') return null;
    const text = session.scrollback().replace(ANSI, '');
    return /https:\/\/[^\s"'<>]+/.exec(text)?.[0] ?? null;
  }

  private spawn(kind: TerminalInfo['kind'], title: string, shell: string, args: string[] | string, cwd: string, env: Record<string, string>): TerminalInfo {
    const pty = loadPty();
    const id = newId('term');
    // Bem largo no login: o endereço não pode quebrar em duas linhas ao ser lido.
    const child: IPty = pty.spawn(shell, args, { name: 'xterm-256color', cols: kind === 'login' ? 500 : 100, rows: 28, cwd, env });

    const listeners = new Set<Parameters<TerminalSession['subscribe']>[0]>();
    let buffer = '';
    const logFile = path.join(this.config.logsDir, 'terminals', `${id}.log`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    child.onData((data) => {
      buffer = (buffer + data).slice(-SCROLLBACK_BYTES);
      // Login não vai para o log: é onde um código ou segredo pode aparecer.
      if (kind !== 'login') fs.appendFile(logFile, redact(data), () => undefined);
      for (const listener of listeners) listener({ type: 'data', data });
    });
    child.onExit(({ exitCode }) => {
      for (const listener of listeners) listener({ type: 'exit', code: exitCode });
      this.sessions.delete(id);
    });

    const session: TerminalSession = {
      id,
      kind,
      title,
      write: (data) => child.write(data),
      resize: (cols, rows) => {
        if (cols > 0 && rows > 0) child.resize(cols, rows);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      kill: () => {
        // Pede para sair antes: matar direto um shell que já está encerrando faz um
        // processo auxiliar do node-pty quebrar no Windows.
        try {
          child.write(kind === 'shell' ? 'exit\r' : '\x03');
        } catch {
          // Já encerrado.
        }
        const timer = setTimeout(() => {
          if (this.sessions.has(id)) child.kill();
        }, 1500);
        timer.unref();
      },
      scrollback: () => buffer,
    };
    this.sessions.set(id, session);
    return { id, kind, title };
  }

  kill(id: string): void {
    this.get(id).kill();
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.kill();
    this.sessions.clear();
  }
}
