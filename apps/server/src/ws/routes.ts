import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@xinoia/shared';
import type { AppContext } from '../context.ts';

const wsQuery = z.object({ after: z.coerce.number().int().min(0).optional() });

export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    // Assina antes de ler o histórico para nada se perder no intervalo. O que chegar
    // enquanto o histórico é enviado fica guardado e vai depois, sem repetir.
    let replaying = true;
    let lastSent = 0;
    const pending: ServerMessage[] = [];
    const unsubscribe = ctx.hub.subscribe((message) => {
      if (replaying) {
        pending.push(message);
        return;
      }
      send(message);
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);

    void (async () => {
      const { after } = wsQuery.parse(request.query);
      send({ kind: 'hello', lastEventId: await ctx.db.runEvents.lastId() });
      if (after !== undefined) {
        for (const data of await ctx.db.runEvents.listAfter(after)) {
          send({ kind: 'run_event', data });
          lastSent = data.id;
        }
      }
      replaying = false;
      for (const message of pending) {
        if (message.kind === 'run_event' && message.data.id <= lastSent) continue;
        send(message);
      }
    })().catch((error: unknown) => {
      request.log.error(error);
      socket.close();
    });
  });
}
