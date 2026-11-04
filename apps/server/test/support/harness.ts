import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type XinoiaApp } from '../../src/app.ts';
import { createConfig, type AppConfig } from '../../src/config.ts';
import type { Persistence } from '../../src/persistence/types.ts';
import { claudeAdapter } from '../../src/providers/claude.ts';
import { ProviderRegistry } from '../../src/providers/registry.ts';
import type { ProviderAdapter } from '../../src/providers/types.ts';

const fakeCli = fileURLToPath(new URL('./fake-cli.mjs', import.meta.url));

export function tempDir(prefix = 'xinoia-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** Mesmo adaptador do Claude, mas apontando para o CLI falso. */
export function fakeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    ...claudeAdapter,
    id: 'fake',
    label: 'CLI de teste',
    command: process.execPath,
    noShell: true,
    statusArgs: null,
    logoutArgs: null,
    parseStatus: undefined,
    statusFromHome: () => ({ loggedIn: true, subscription: true, method: 'teste', email: null, plan: null }),
    buildArgs: (options) => [fakeCli, ...claudeAdapter.buildArgs(options)],
    ...overrides,
  };
}

export interface Harness extends XinoiaApp {
  config: AppConfig;
  dataDir: string;
  projectDir: string;
  auth: { authorization: string };
  db(): Persistence;
  cleanup(): Promise<void>;
  /** Cria projeto, perfil e agente prontos para rodar no CLI falso. */
  setup(name?: string): Promise<{ projectId: string; profileId: string; agentId: string }>;
}

export async function createHarness(options: { dataDir?: string; keep?: boolean; homeDir?: string } = {}): Promise<Harness> {
  const dataDir = options.dataDir ?? tempDir();
  const projectDir = tempDir('xinoia-projeto-');
  const homeDir = options.homeDir ?? tempDir('xinoia-home-');
  const config = createConfig({ dataDir, homeDir });
  const registry = new ProviderRegistry([fakeAdapter()]);
  const instance = await createApp({ config, providers: registry, logToFile: false, token: 'token-de-teste' });
  // Os testes de orquestração controlam a aprovação por conta própria. Os de modos de
  // execução mudam esta configuração explicitamente.
  await instance.ctx.settings.update({ executionMode: 'autonomous' });

  return {
    ...instance,
    config,
    dataDir,
    projectDir,
    auth: { authorization: `Bearer ${instance.token}` },
    db: () => instance.ctx.db,
    async setup(name = 'Ana') {
      const project = await instance.ctx.projects.create({ path: projectDir, name: 'teste' }).catch(async () => {
        const [existing] = await instance.ctx.projects.list();
        return existing!;
      });
      const profile = await instance.ctx.profiles.create({ provider: 'fake', label: `Perfil ${name}` });
      const agent = await instance.ctx.agents.create({ name, provider: 'fake', profileId: profile.id });
      return { projectId: project.id, profileId: profile.id, agentId: agent.id };
    },
    async cleanup() {
      await instance.app.close();
      if (!options.keep) removeDir(dataDir);
      removeDir(projectDir);
      if (!options.homeDir) removeDir(homeDir);
    },
  };
}
