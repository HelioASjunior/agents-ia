import type { CustomProvider } from '@xinoia/shared';
import { claudeAdapter } from './claude.ts';
import { codexAdapter } from './codex.ts';
import { geminiAdapter } from './gemini.ts';
import type { ProviderAdapter } from './types.ts';

// Agente local qualquer: o prompt vai por stdin e cada linha de saída vira texto.
export function customAdapter(def: CustomProvider): ProviderAdapter {
  return {
    id: `custom:${def.id}`,
    label: def.name,
    command: def.command,
    homeEnv: def.homeEnv,
    defaultHomeDir: null,
    support: 'custom',
    note: 'Agente personalizado: a saída é mostrada como texto, sem detalhes de ferramentas.',
    apiKeyEnv: null,
    apiKeyUrl: null,
    installCommand: null,
    installUrl: null,
    loginCommand: def.loginCommand,
    logoutArgs: null,
    statusArgs: null,
    capabilityProbe: null,
    models: [],
    efforts: [],
    keepsApiEnv: true,
    requiresProfile: false,
    statusFromHome: () => ({ loggedIn: true, subscription: null, method: null, email: null, plan: null }),
    buildArgs: () => def.args.split(/\s+/).filter(Boolean),
    createParser: () => (line) => [{ type: 'text', text: `${line}\n` }],
    classifyError: () => null,
  };
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(builtIn: ProviderAdapter[] = [claudeAdapter, codexAdapter, geminiAdapter]) {
    for (const adapter of builtIn) this.register(adapter);
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): void {
    this.adapters.delete(id);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
