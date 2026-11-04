import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { MissionNoteInput, ReassignTaskInput, ReplanMissionInput } from '@xinoia/shared';
import type { AppContext } from '../context.ts';

const idParam = z.object({ id: z.string().min(1) });
const taskParam = z.object({ id: z.string().min(1), taskId: z.string().min(1) });
const listQuery = z.object({ projectId: z.string().optional() });
const afterQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

export function registerMissionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { orchestrator } = ctx;
  const id = (request: { params: unknown }) => idParam.parse(request.params).id;

  app.get('/api/missions', async (request) => orchestrator.list(listQuery.parse(request.query).projectId));
  app.post('/api/missions', async (request, reply) => reply.code(201).send(await orchestrator.start(request.body as never)));
  app.get('/api/missions/:id', async (request) => orchestrator.get(id(request)));
  app.get('/api/missions/:id/tasks', async (request) => orchestrator.tasks(id(request)));
  app.get('/api/missions/:id/events', async (request) =>
    orchestrator.events(id(request), afterQuery.parse(request.query).after));

  app.post('/api/missions/:id/approve', async (request) => orchestrator.approve(id(request), request.body));
  app.post('/api/missions/:id/replan', async (request) =>
    orchestrator.replan(id(request), ReplanMissionInput.parse(request.body).feedback));
  app.post('/api/missions/:id/pause', async (request) => orchestrator.pause(id(request)));
  app.post('/api/missions/:id/resume', async (request) => orchestrator.resume(id(request)));
  app.post('/api/missions/:id/cancel', async (request) => orchestrator.cancel(id(request)));
  app.post('/api/missions/:id/notes', async (request) =>
    orchestrator.addNote(id(request), MissionNoteInput.parse(request.body).text));

  app.post('/api/missions/:id/tasks/:taskId/retry', async (request) => {
    const params = taskParam.parse(request.params);
    return orchestrator.retryTask(params.id, params.taskId);
  });
  app.post('/api/missions/:id/tasks/:taskId/skip', async (request) => {
    const params = taskParam.parse(request.params);
    return orchestrator.skipTask(params.id, params.taskId);
  });
  app.post('/api/missions/:id/tasks/:taskId/reassign', async (request) => {
    const params = taskParam.parse(request.params);
    return orchestrator.reassignTask(params.id, params.taskId, ReassignTaskInput.parse(request.body).agentId);
  });

  app.get('/api/agents-state', async () => ctx.agentState.snapshot());
}
