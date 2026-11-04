import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { SaveFileInput } from '@xinoia/shared';
import type { AppContext } from '../context.ts';
import { listFiles, readFile, saveFile } from '../services/files.ts';

const idParam = z.object({ id: z.string().min(1) });
const channelQuery = z.object({ projectId: z.string().min(1), channel: z.string().min(1) });
const searchQuery = z.object({ projectId: z.string().min(1), q: z.string().trim().min(1).max(200) });
const pathQuery = z.object({ path: z.string().default('') });
const metricsQuery = z.object({ projectId: z.string().optional() });

export function registerChatRoutes(app: FastifyInstance, ctx: AppContext): void {
  const id = (request: { params: unknown }) => idParam.parse(request.params).id;

  app.get('/api/chat/messages', async (request) => {
    const query = channelQuery.parse(request.query);
    return ctx.chat.list(query.projectId, query.channel);
  });
  app.post('/api/chat/messages', async (request, reply) => reply.code(201).send(await ctx.chat.send(request.body)));
  app.get('/api/chat/search', async (request) => {
    const query = searchQuery.parse(request.query);
    return ctx.chat.search(query.projectId, query.q);
  });
  app.delete('/api/chat/messages', async (request, reply) => {
    const query = channelQuery.parse(request.query);
    await ctx.chat.clear(query.projectId, query.channel);
    return reply.code(204).send();
  });
  app.post('/api/chat/messages/:id/cancel', async (request, reply) => {
    await ctx.chat.cancel(id(request));
    return reply.code(202).send({ ok: true });
  });
  app.post('/api/projects/:id/attachments', { bodyLimit: 36 * 1024 * 1024 }, async (request, reply) =>
    reply.code(201).send(await ctx.chat.upload(id(request), request.body)));

  // Arquivos do projeto
  app.get('/api/projects/:id/files', async (request) =>
    listFiles(await ctx.projects.get(id(request)), pathQuery.parse(request.query).path));
  app.get('/api/projects/:id/file', async (request) =>
    readFile(await ctx.projects.get(id(request)), pathQuery.parse(request.query).path));
  app.put('/api/projects/:id/file', async (request, reply) => {
    const body = SaveFileInput.parse(request.body);
    saveFile(await ctx.projects.get(id(request)), body.path, body.content);
    return reply.code(204).send();
  });

  // Terminal histórico, painel e linha do tempo
  app.get('/api/projects/:id/terminal', async (request) => ctx.db.runEvents.listForProject(id(request)));
  app.get('/api/metrics', async (request) => ctx.metrics.read(metricsQuery.parse(request.query).projectId));
  app.get('/api/timeline', async (request) => ctx.metrics.timeline(metricsQuery.parse(request.query).projectId));

  // Terminais interativos
  app.get('/api/terminals', async () => ctx.terminals.list());
  app.post('/api/terminals', async (request, reply) => reply.code(201).send(await ctx.terminals.create(request.body)));
  app.delete('/api/terminals/:id', async (request, reply) => {
    ctx.terminals.kill(id(request));
    return reply.code(204).send();
  });

  const terminalMessage = z.discriminatedUnion('type', [
    z.object({ type: z.literal('input'), data: z.string() }),
    z.object({ type: z.literal('resize'), cols: z.number().int(), rows: z.number().int() }),
  ]);

  app.get('/ws/terminal/:id', { websocket: true }, (socket, request) => {
    let session;
    try {
      session = ctx.terminals.get(id(request));
    } catch {
      socket.close();
      return;
    }
    const current = session;
    socket.send(JSON.stringify({ type: 'data', data: current.scrollback() }));
    const unsubscribe = current.subscribe((message) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    });
    socket.on('message', (raw: Buffer) => {
      const parsed = terminalMessage.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) return;
      if (parsed.data.type === 'input') current.write(parsed.data.data);
      else current.resize(parsed.data.cols, parsed.data.rows);
    });
    socket.on('close', unsubscribe);
  });
}
