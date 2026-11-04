import crypto from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { AppConfig } from './config.ts';
import { createContext, type AppContext } from './context.ts';
import { AppError } from './errors.ts';
import type { ProviderRegistry } from './providers/registry.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import { registerMissionRoutes } from './routes/missions.ts';
import { registerRunRoutes } from './routes/runs.ts';
import { registerSystemRoutes } from './routes/system.ts';
import { installHttpGuard } from './security/http-guard.ts';
import { registerWebSocket } from './ws/routes.ts';

export interface CreateAppOptions {
  config: AppConfig;
  token?: string;
  providers?: ProviderRegistry;
  allowedOrigins?: string[];
  logToFile?: boolean;
}

export interface XinoiaApp {
  app: FastifyInstance;
  ctx: AppContext;
  token: string;
}

export async function createApp(options: CreateAppOptions): Promise<XinoiaApp> {
  const token = options.token ?? crypto.randomBytes(32).toString('hex');
  const ctx = await createContext(options.config, options.providers);

  const app = Fastify({
    logger: options.logToFile === false
      ? false
      : {
          level: 'info',
          file: path.join(options.config.logsDir, 'server.log'),
          // O token de acesso do WebSocket vai na URL e não pode parar no log.
          serializers: {
            req: (request) => ({ method: request.method, url: request.url.split('?')[0] }),
          },
        },
    bodyLimit: 2 * 1024 * 1024,
    // Uma conexão parada não pode impedir o app de fechar ou de se atualizar.
    forceCloseConnections: true,
  });

  installHttpGuard(app, { token, allowedOrigins: options.allowedOrigins });
  await app.register(websocket);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const field = first?.path.join('.');
      return reply.code(400).send({
        error: 'invalid_input',
        message: field ? `${field}: ${first?.message}` : first?.message ?? 'Dados inválidos.',
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Erro interno. Veja o log do XinoIA.' });
  });

  registerSystemRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerMissionRoutes(app, ctx);
  registerWebSocket(app, ctx);

  app.addHook('onClose', async () => {
    await ctx.close();
  });

  return { app, ctx, token };
}
