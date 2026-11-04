import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AuthStatus, Profile, ProfileUsage } from '@xinoia/shared';
import { CreateProfileInput, SetApiKeyInput } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { buildEnv, capture } from '../process/spawn.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderAdapter } from '../providers/types.ts';
import { registerSecret } from '../security/redact.ts';
import { windowsSecretStore, type SecretStore } from '../security/secret-store.ts';
import type { EventHub } from '../ws/hub.ts';

export interface LoginResult {
  /** false: o sistema não permite abrir o terminal daqui; o comando deve ser mostrado. */
  opened: boolean;
  command: string;
}

/** Monta como abrir o login oficial em uma janela de terminal do Windows. */
export function windowsLoginArgs(title: string, command: string, keepOpen = true): string {
  const safeTitle = title.replace(/[^\w\s-]/g, '');
  return `/c start "${safeTitle}" cmd ${keepOpen ? '/k' : '/c'} "${command}"`;
}

export class ProfileService {
  private readonly config: AppConfig;
  private readonly db: Persistence;
  private readonly providers: ProviderRegistry;
  private readonly hub: EventHub;
  private readonly secrets: SecretStore;

  constructor(config: AppConfig, db: Persistence, providers: ProviderRegistry, hub: EventHub, secrets: SecretStore = windowsSecretStore) {
    this.config = config;
    this.db = db;
    this.providers = providers;
    this.hub = hub;
    this.secrets = secrets;
  }

  homeOf(profile: Profile): string | null {
    return profile.homeDir ? path.join(this.config.profilesDir, profile.homeDir) : null;
  }

  private adapterOf(profile: Pick<Profile, 'provider'>): ProviderAdapter {
    const adapter = this.providers.get(profile.provider);
    if (!adapter) throw badRequest(`Provedor desconhecido: ${profile.provider}`);
    return adapter;
  }

  private async require(id: string): Promise<Profile> {
    const profile = await this.db.profiles.get(id);
    if (!profile) throw notFound('Perfil');
    return profile;
  }

  list(): Promise<Profile[]> {
    return this.db.profiles.list();
  }

  async create(input: unknown): Promise<Profile> {
    const data = CreateProfileInput.parse(input);
    const adapter = this.providers.get(data.provider);
    if (!adapter) throw badRequest(`Provedor desconhecido: ${data.provider}`);
    if (!data.useSystemDefault && !adapter.homeEnv) {
      throw badRequest(`${adapter.label} não permite perfis separados. Use o login padrão do computador.`, 'no_isolation');
    }

    // A chave fica em um perfil próprio, para nunca se misturar com o login do computador.
    if (data.apiKey && !adapter.apiKeyEnv) throw badRequest(`${adapter.label} não aceita chave de API.`, 'no_api_key');
    const cipher = data.apiKey ? await this.secrets.protect(data.apiKey) : null;
    if (data.apiKey) registerSecret(data.apiKey);
    const useSystemDefault = data.useSystemDefault && !data.apiKey;

    if (useSystemDefault) {
      const existing = (await this.db.profiles.list()).find((p) => p.provider === data.provider && !p.homeDir);
      if (existing) return existing;
    }

    const id = newId('prof');
    const profile: Profile = {
      id,
      provider: data.provider,
      label: data.label,
      homeDir: useSystemDefault ? null : id,
      credential: cipher ? 'api_key' : 'login',
      auth: null,
      usage: null,
      totals: { runs: 0, inputTokens: 0, outputTokens: 0 },
      createdAt: Date.now(),
    };
    const home = this.homeOf(profile);
    if (home) {
      fs.mkdirSync(home, { recursive: true });
      adapter.prepareHome?.(home);
    }
    await this.db.profiles.insert(profile);
    if (cipher) await this.db.profiles.setApiKeyCipher(id, cipher);
    return profile;
  }

  /** Troca a chave de um perfil que já usa chave de API. */
  async setApiKey(id: string, input: unknown): Promise<Profile> {
    const profile = await this.require(id);
    if (profile.credential !== 'api_key') throw badRequest('Este perfil usa login, não chave de API.', 'not_api_key');
    const { apiKey } = SetApiKeyInput.parse(input);
    await this.db.profiles.setApiKeyCipher(id, await this.secrets.protect(apiKey));
    registerSecret(apiKey);
    return this.check(id);
  }

  /** Ambiente de uma execução: o do perfil e, só se ele usar chave, a chave dele. */
  async envFor(profile: Profile | null, adapter: ProviderAdapter): Promise<Record<string, string>> {
    const env = buildEnv(adapter, profile ? this.homeOf(profile) : null);
    if (profile?.credential === 'api_key' && adapter.apiKeyEnv) {
      const cipher = await this.db.profiles.getApiKeyCipher(profile.id);
      if (!cipher) throw badRequest('Este perfil está sem chave de API. Informe a chave em Contas.', 'no_api_key');
      env[adapter.apiKeyEnv] = await this.secrets.unprotect(cipher);
    }
    return env;
  }

  async rename(id: string, label: string): Promise<Profile> {
    await this.require(id);
    await this.db.profiles.updateLabel(id, label);
    return this.require(id);
  }

  async check(id: string): Promise<Profile> {
    const profile = await this.require(id);
    const adapter = this.adapterOf(profile);
    const auth = await this.readAuth(profile, adapter);
    await this.db.profiles.updateAuth(id, auth);
    const updated = await this.require(id);
    this.hub.publish({ kind: 'profile_updated', data: updated });
    return updated;
  }

  async checkAll(): Promise<Profile[]> {
    const profiles = await this.db.profiles.list();
    return Promise.all(profiles.map((profile) => this.check(profile.id)));
  }

  private async readAuth(profile: Profile, adapter: ProviderAdapter): Promise<AuthStatus> {
    const home = this.homeOf(profile);
    const checkedAt = Date.now();
    const none = { loggedIn: false, subscription: null, method: null, email: null, plan: null, checkedAt };
    // Conferir a chave de verdade custaria uma chamada paga: quem recusa é a primeira execução.
    if (profile.credential === 'api_key') return { ...none, loggedIn: true, subscription: false, method: 'Chave de API' };
    try {
      if (adapter.statusArgs && adapter.parseStatus) {
        const result = await capture({
          command: adapter.command,
          args: adapter.statusArgs,
          cwd: os.homedir(),
          env: buildEnv(adapter, home),
          noShell: adapter.noShell,
        });
        if (result.timedOut) return { ...none, error: 'O CLI demorou demais para responder.' };
        if (adapter.classifyError(result.stderr) === 'missing') return { ...none, error: `${adapter.label} não está instalado.` };
        return { ...adapter.parseStatus(result.stdout, result.stderr), checkedAt };
      }
      if (adapter.statusFromHome) {
        const dir = home ?? path.join(this.config.homeDir, adapter.defaultHomeDir ?? '.');
        return { ...adapter.statusFromHome(dir), checkedAt };
      }
      return none;
    } catch (error) {
      return { ...none, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // O XinoIA só indica a pasta do perfil. Quem conduz o login é o próprio CLI, no
  // fluxo oficial do fornecedor, e o resultado nunca passa por aqui.
  async openLogin(id: string): Promise<LoginResult> {
    const profile = await this.require(id);
    const adapter = this.adapterOf(profile);
    if (!adapter.loginCommand) throw badRequest(`${adapter.label} não tem comando de login.`);
    const env = buildEnv(adapter, this.homeOf(profile));
    const command = adapter.loginCommand;

    if (process.platform === 'win32') {
      spawn('cmd.exe', [windowsLoginArgs(`Login ${adapter.label} - ${profile.label}`, command)], {
        env,
        windowsVerbatimArguments: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: os.homedir(),
      }).unref();
      return { opened: true, command };
    }

    const home = this.homeOf(profile);
    const prefix = adapter.homeEnv && home ? `export ${adapter.homeEnv}='${home.replace(/'/g, `'\\''`)}'; ` : '';
    const full = `${prefix}${command}`;
    if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(full)}`], {
        detached: true,
        stdio: 'ignore',
      }).unref();
      return { opened: true, command: full };
    }
    return { opened: false, command: full };
  }

  async logout(id: string): Promise<Profile> {
    const profile = await this.require(id);
    const adapter = this.adapterOf(profile);
    if (profile.credential === 'api_key') throw badRequest('Para deixar de usar a chave, remova este perfil.', 'not_login');
    if (!adapter.logoutArgs) throw badRequest(`${adapter.label} não tem comando de saída.`);
    await capture({
      command: adapter.command,
      args: adapter.logoutArgs,
      cwd: os.homedir(),
      env: buildEnv(adapter, this.homeOf(profile)),
      noShell: adapter.noShell,
    });
    return this.check(id);
  }

  /** Remove o perfil. A pasta só é apagada quando é do XinoIA, nunca o login padrão. */
  async remove(id: string): Promise<void> {
    const profile = await this.require(id);
    const home = this.homeOf(profile);
    if (home) {
      const adapter = this.adapterOf(profile);
      if (adapter.logoutArgs && profile.credential === 'login') await this.logout(id).catch(() => undefined);
      const inside = path.resolve(home).startsWith(path.resolve(this.config.profilesDir) + path.sep);
      if (inside) fs.rmSync(home, { recursive: true, force: true });
    }
    await this.db.profiles.delete(id);
  }

  async recordUsage(id: string, usage: ProfileUsage): Promise<void> {
    await this.db.profiles.updateUsage(id, usage);
    const updated = await this.db.profiles.get(id);
    if (updated) this.hub.publish({ kind: 'profile_updated', data: updated });
  }

  async addTotals(id: string, inputTokens: number, outputTokens: number): Promise<void> {
    const profile = await this.db.profiles.get(id);
    if (!profile) return;
    const totals = {
      runs: profile.totals.runs + 1,
      inputTokens: profile.totals.inputTokens + inputTokens,
      outputTokens: profile.totals.outputTokens + outputTokens,
    };
    await this.db.profiles.updateTotals(id, totals);
    this.hub.publish({ kind: 'profile_updated', data: { ...profile, totals } });
  }
}
