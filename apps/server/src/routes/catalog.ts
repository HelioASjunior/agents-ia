import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ROLES, UpdateProfileInput } from '@xinoia/shared';
import type { AppContext } from '../context.ts';

const idParam = z.object({ id: z.string().min(1) });

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/roles', async () => ROLES);

  // Provedores
  app.get('/api/providers', async () => ctx.detection.list());
  app.post('/api/providers/refresh', async () => ctx.detection.refresh());

  app.get('/api/custom-providers', async () => ctx.customProviders.list());
  app.post('/api/custom-providers', async (request, reply) => {
    const created = await ctx.customProviders.create(request.body);
    await ctx.detection.refresh();
    return reply.code(201).send(created);
  });
  app.delete('/api/custom-providers/:id', async (request, reply) => {
    await ctx.customProviders.remove(idParam.parse(request.params).id);
    return reply.code(204).send();
  });

  // Perfis
  app.get('/api/profiles', async () => ctx.profiles.list());
  app.post('/api/profiles', async (request, reply) => reply.code(201).send(await ctx.profiles.create(request.body)));
  app.patch('/api/profiles/:id', async (request) =>
    ctx.profiles.rename(idParam.parse(request.params).id, UpdateProfileInput.parse(request.body).label));
  app.delete('/api/profiles/:id', async (request, reply) => {
    await ctx.profiles.remove(idParam.parse(request.params).id);
    return reply.code(204).send();
  });
  app.put('/api/profiles/:id/api-key', async (request) => ctx.profiles.setApiKey(idParam.parse(request.params).id, request.body));
  app.post('/api/profiles/check', async () => ctx.profiles.checkAll());
  app.post('/api/profiles/:id/check', async (request) => ctx.profiles.check(idParam.parse(request.params).id));
  app.post('/api/profiles/:id/login', async (request) => ctx.profiles.openLogin(idParam.parse(request.params).id));
  app.post('/api/profiles/:id/logout', async (request) => ctx.profiles.logout(idParam.parse(request.params).id));

  // Agentes
  app.get('/api/agents', async () => ctx.agents.list());
  app.post('/api/agents', async (request, reply) => reply.code(201).send(await ctx.agents.create(request.body)));
  app.get('/api/agents/:id', async (request) => ctx.agents.get(idParam.parse(request.params).id));
  app.patch('/api/agents/:id', async (request) => ctx.agents.update(idParam.parse(request.params).id, request.body));
  app.delete('/api/agents/:id', async (request, reply) => {
    await ctx.agents.remove(idParam.parse(request.params).id);
    return reply.code(204).send();
  });

  // Projetos
  app.get('/api/projects', async () => ctx.projects.list());
  app.post('/api/projects', async (request, reply) => reply.code(201).send(await ctx.projects.create(request.body)));
  app.post('/api/projects/:id/refresh', async (request) => ctx.projects.refresh(idParam.parse(request.params).id));
  app.delete('/api/projects/:id', async (request, reply) => {
    await ctx.projects.remove(idParam.parse(request.params).id);
    return reply.code(204).send();
  });

  // Integrações
  const projectQuery = z.object({ projectId: z.string().optional() });
  const projectPath = async (projectId?: string) =>
    projectId ? (await ctx.projects.get(projectId)).path : undefined;

  app.get('/api/toolkits', async () => ctx.toolkits.list());
  app.get('/api/toolkits/health', async () => ctx.toolkits.health());
  app.get('/api/toolkits/discover', async (request) =>
    ctx.toolkits.discover(await projectPath(projectQuery.parse(request.query).projectId)));
  app.post('/api/toolkits', async (request, reply) => reply.code(201).send(await ctx.toolkits.create(request.body)));
  app.post('/api/toolkits/import', async (request, reply) => {
    const body = z.object({ key: z.string().min(1), projectId: z.string().optional() }).parse(request.body);
    return reply.code(201).send(await ctx.toolkits.importDiscovered(body.key, await projectPath(body.projectId)));
  });
  app.post('/api/toolkits/unreal', async (request, reply) => {
    const body = z.object({ url: z.string().optional() }).parse(request.body ?? {});
    return reply.code(201).send(await ctx.toolkits.addUnreal(body.url));
  });
  app.patch('/api/toolkits/:id', async (request) => {
    const body = z.object({ url: z.string().optional(), exclusive: z.boolean().optional() }).parse(request.body);
    return ctx.toolkits.update(idParam.parse(request.params).id, body);
  });
  app.delete('/api/toolkits/:id', async (request, reply) => {
    await ctx.toolkits.remove(idParam.parse(request.params).id);
    return reply.code(204).send();
  });
}
