import type { ModelOption, ProviderInfo } from '@xinoia/shared';
import type { AppConfig } from '../config.ts';
import { buildEnv, capture } from '../process/spawn.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import type { ProviderAdapter } from '../providers/types.ts';

interface Detected {
  installed: boolean;
  version: string | null;
  capabilities: Record<string, boolean>;
  modelOptions: ModelOption[];
}

export class DetectionService {
  private readonly cache = new Map<string, Detected>();
  private readonly config: AppConfig;
  private readonly providers: ProviderRegistry;

  constructor(config: AppConfig, providers: ProviderRegistry) {
    this.config = config;
    this.providers = providers;
  }

  private async probe(adapter: ProviderAdapter): Promise<Detected> {
    const spec = {
      command: adapter.command,
      cwd: this.config.homeDir,
      env: buildEnv(adapter, null),
      noShell: adapter.noShell,
    };
    const version = await capture({ ...spec, args: ['--version'] }, 15_000);
    if (version.code !== 0) return { installed: false, version: null, capabilities: {}, modelOptions: [] };

    const capabilities: Record<string, boolean> = {};
    if (adapter.capabilityProbe) {
      const help = await capture({ ...spec, args: adapter.capabilityProbe.args }, 15_000);
      const text = `${help.stdout}\n${help.stderr}`;
      for (const [name, flag] of Object.entries(adapter.capabilityProbe.flags)) {
        capabilities[name] = text.includes(flag);
      }
    }
    let modelOptions: ModelOption[] = [];
    if (adapter.modelProbe) {
      const catalog = await capture({ ...spec, args: adapter.modelProbe.args }, 15_000);
      if (catalog.code === 0) modelOptions = adapter.modelProbe.parse(catalog.stdout);
    }
    return { installed: true, version: version.stdout.trim().split('\n')[0] ?? null, capabilities, modelOptions };
  }

  async refresh(): Promise<ProviderInfo[]> {
    await Promise.all(this.providers.list().map(async (adapter) => {
      this.cache.set(adapter.id, await this.probe(adapter));
    }));
    return this.list();
  }

  isInstalled(id: string): boolean {
    return this.cache.get(id)?.installed ?? false;
  }

  list(): ProviderInfo[] {
    return this.providers.list().map((adapter) => {
      const detected = this.cache.get(adapter.id);
      const catalog = detected?.modelOptions ?? [];
      const modelOptions = catalog.length
        ? catalog
        : adapter.models.map((id) => ({ id, label: adapter.modelLabels?.[id] ?? id, efforts: adapter.efforts }));
      return {
        id: adapter.id,
        label: adapter.label,
        installed: detected?.installed ?? false,
        version: detected?.version ?? null,
        capabilities: detected?.capabilities ?? {},
        support: adapter.support,
        isolatesProfiles: Boolean(adapter.homeEnv),
        canLogin: Boolean(adapter.loginCommand),
        supportsApiKey: Boolean(adapter.apiKeyEnv),
        apiKeyUrl: adapter.apiKeyUrl,
        installCommand: adapter.installCommand,
        installUrl: adapter.installUrl,
        models: modelOptions.map((option) => option.id),
        modelOptions,
        // Do catálogo, em ordem: o Codex tem níveis que a lista fixa não conhece.
        efforts: catalog.length ? [...new Set(catalog.flatMap((option) => option.efforts))] : adapter.efforts,
        note: adapter.note,
      };
    });
  }
}
