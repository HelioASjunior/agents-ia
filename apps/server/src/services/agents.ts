import type { Agent } from '@xinoia/shared';
import { CreateAgentInput, UpdateAgentInput } from '@xinoia/shared';
import { badRequest, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { Persistence } from '../persistence/types.ts';
import type { ProviderRegistry } from '../providers/registry.ts';

export class AgentService {
  private readonly db: Persistence;
  private readonly providers: ProviderRegistry;

  constructor(db: Persistence, providers: ProviderRegistry) {
    this.db = db;
    this.providers = providers;
  }

  list(): Promise<Agent[]> {
    return this.db.agents.list();
  }

  async get(id: string): Promise<Agent> {
    const agent = await this.db.agents.get(id);
    if (!agent) throw notFound('Agente');
    return agent;
  }

  private async validate(agent: Agent): Promise<void> {
    if (!this.providers.get(agent.provider)) throw badRequest(`Provedor desconhecido: ${agent.provider}`);
    if (agent.profileId) {
      const profile = await this.db.profiles.get(agent.profileId);
      if (!profile) throw badRequest('O perfil escolhido não existe.');
      if (profile.provider !== agent.provider) {
        throw badRequest('O perfil escolhido é de outro provedor.', 'profile_mismatch');
      }
    }
    for (const toolkitId of agent.toolkitIds) {
      if (!(await this.db.toolkits.get(toolkitId))) throw badRequest('Uma das integrações escolhidas não existe.');
    }
  }

  async create(input: unknown): Promise<Agent> {
    const data = CreateAgentInput.parse(input);
    const agent: Agent = {
      id: newId('agent'),
      name: data.name,
      role: data.role,
      roleTitle: data.roleTitle || null,
      instructions: data.instructions || null,
      provider: data.provider,
      profileId: data.profileId || null,
      model: data.model || null,
      effort: data.effort || null,
      permission: data.permission,
      color: data.color,
      toolkitIds: data.toolkitIds,
      createdAt: Date.now(),
    };
    await this.validate(agent);
    await this.db.agents.insert(agent);
    return agent;
  }

  async update(id: string, input: unknown): Promise<Agent> {
    const current = await this.get(id);
    const data = UpdateAgentInput.parse(input);
    const next: Agent = { ...current };
    if (data.name !== undefined) next.name = data.name;
    if (data.role !== undefined) next.role = data.role;
    if (data.roleTitle !== undefined) next.roleTitle = data.roleTitle || null;
    if (data.instructions !== undefined) next.instructions = data.instructions || null;
    if (data.provider !== undefined) next.provider = data.provider;
    if (data.profileId !== undefined) next.profileId = data.profileId || null;
    if (data.model !== undefined) next.model = data.model || null;
    if (data.effort !== undefined) next.effort = data.effort || null;
    if (data.permission !== undefined) next.permission = data.permission;
    if (data.color !== undefined) next.color = data.color;
    if (data.toolkitIds !== undefined) next.toolkitIds = data.toolkitIds;
    await this.validate(next);
    await this.db.agents.update(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db.agents.delete(id);
  }
}
