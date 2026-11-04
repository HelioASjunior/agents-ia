import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({
  projectId: z.string().optional(),
  agentId: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const eventsQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/runs', async (request) => ctx.runs.list(listQuery.parse(request.query)));
  app.post('/api/runs', async (request, reply) => reply.code(202).send(await ctx.runs.create(request.body)));
  app.get('/api/runs/:id', async (request) => ctx.runs.get(idParam.parse(request.params).id));
  app.get('/api/runs/:id/events', async (request) =>
    ctx.runs.events(idParam.parse(request.params).id, eventsQuery.parse(request.query).after));
  app.post('/api/runs/:id/cancel', async (request, reply) =>
    reply.code(202).send(await ctx.runs.cancel(idParam.parse(request.params).id)));
}
