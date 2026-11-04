import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { CloneProjectInput } from '@xinoia/shared';
import type { AppContext } from '../context.ts';
import { badRequest } from '../errors.ts';
import { clone, diffFile, status } from '../services/git.ts';
import { resolveInside } from '../services/files.ts';

const idParam = z.object({ id: z.string().min(1) });
const pathQuery = z.object({ path: z.string().min(1) });
const itemParam = z.object({ id: z.string().min(1), itemId: z.string().min(1) });

export function registerProjectToolRoutes(app: FastifyInstance, ctx: AppContext): void {
  const id = (request: { params: unknown }) => idParam.parse(request.params).id;

  // Git
  app.post('/api/projects/clone', async (request, reply) => {
    const data = CloneProjectInput.parse(request.body);
    if (!path.isAbsolute(data.path)) throw badRequest('Informe o caminho completo da pasta.');
    const target = path.resolve(data.path);
    await clone(data.url, target);
    return reply.code(201).send(await ctx.projects.create({ path: target, name: data.name }));
  });
  app.get('/api/projects/:id/git/status', async (request) => status((await ctx.projects.get(id(request))).path));
  app.get('/api/projects/:id/git/diff', async (request) => {
    const project = await ctx.projects.get(id(request));
    const file = pathQuery.parse(request.query).path;
    resolveInside(project, file);
    return { diff: await diffFile(project.path, file) };
  });

  // Memória do projeto
  app.get('/api/projects/:id/memory', async (request) => ctx.memory.list(id(request)));
  app.post('/api/projects/:id/memory', async (request, reply) =>
    reply.code(201).send(await ctx.memory.create(id(request), request.body)));
  app.delete('/api/memory/:id', async (request, reply) => {
    await ctx.memory.delete(id(request));
    return reply.code(204).send();
  });

  // Revisão antes do merge
  app.get('/api/missions/:id/changes', async (request) => ctx.orchestrator.reviewChanges(id(request)));
  app.post('/api/missions/:id/merge', async (request) => ctx.orchestrator.mergeResult(id(request)));
  app.post('/api/missions/:id/discard', async (request) => ctx.orchestrator.discardResult(id(request)));

  // Workflows
  app.get('/api/workflows', async () => ctx.workflows.list());
  app.get('/api/workflows/:id', async (request) => ctx.workflows.get(id(request)));
  app.post('/api/workflows', async (request, reply) => reply.code(201).send(await ctx.workflows.create(request.body)));
  app.put('/api/workflows/:id', async (request) => ctx.workflows.update(id(request), request.body));
  app.delete('/api/workflows/:id', async (request, reply) => {
    await ctx.workflows.remove(id(request));
    return reply.code(204).send();
  });
  app.post('/api/workflows/:id/run', async (request, reply) =>
    reply.code(201).send(await ctx.workflows.run(id(request), request.body)));

  // Fila de objetivos
  const item = (request: { params: unknown }) => itemParam.parse(request.params);
  app.get('/api/projects/:id/queue', async (request) => ctx.queues.get(id(request)));
  app.put('/api/projects/:id/queue', async (request) => ctx.queues.save(id(request), request.body));
  app.post('/api/projects/:id/queue/start', async (request) => ctx.queues.start(id(request)));
  app.post('/api/projects/:id/queue/stop', async (request) => ctx.queues.stop(id(request)));
  app.post('/api/projects/:id/queue/order', async (request) => ctx.queues.reorder(id(request), request.body));
  app.post('/api/projects/:id/queue/clear', async (request) => ctx.queues.clearFinished(id(request)));
  app.post('/api/projects/:id/queue/items', async (request) => ctx.queues.addItems(id(request), request.body));
  app.patch('/api/projects/:id/queue/items/:itemId', async (request) => ctx.queues.updateItem(item(request).id, item(request).itemId, request.body));
  app.delete('/api/projects/:id/queue/items/:itemId', async (request) => ctx.queues.removeItem(item(request).id, item(request).itemId));
  app.post('/api/projects/:id/queue/items/:itemId/requeue', async (request) => ctx.queues.requeue(item(request).id, item(request).itemId));

  // Configurações
  app.get('/api/settings', async () => ctx.settings.get());
  app.patch('/api/settings', async (request) => ctx.settings.update(request.body));
}
