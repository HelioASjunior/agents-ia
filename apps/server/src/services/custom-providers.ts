import type { CustomProvider } from '@xinoia/shared';
import { CreateCustomProviderInput } from '@xinoia/shared';
import { notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import { customAdapter, type ProviderRegistry } from '../providers/registry.ts';

export class CustomProviderService {
  private readonly db: Persistence;
  private readonly providers: ProviderRegistry;

  constructor(db: Persistence, providers: ProviderRegistry) {
    this.db = db;
    this.providers = providers;
  }

  async load(): Promise<void> {
    for (const def of await this.db.customProviders.list()) this.providers.register(customAdapter(def));
  }

  list(): Promise<CustomProvider[]> {
    return this.db.customProviders.list();
  }

  async create(input: unknown): Promise<CustomProvider> {
    const data = CreateCustomProviderInput.parse(input);
    const provider: CustomProvider = {
      id: newId('cli'),
      name: data.name,
      command: data.command,
      args: data.args,
      homeEnv: data.homeEnv || null,
      loginCommand: data.loginCommand || null,
      createdAt: Date.now(),
    };
    await this.db.customProviders.insert(provider);
    this.providers.register(customAdapter(provider));
    return provider;
  }

  async remove(id: string): Promise<void> {
    const existing = (await this.db.customProviders.list()).find((p) => p.id === id);
    if (!existing) throw notFound('Agente personalizado');
    await this.db.customProviders.delete(id);
    this.providers.unregister(`custom:${id}`);
  }
}
