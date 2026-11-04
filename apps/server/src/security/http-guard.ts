import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.ts';

export interface GuardOptions {
  token: string;
  /** Origens extras permitidas, como o servidor Vite em desenvolvimento. */
  allowedOrigins?: string[];
}

function tokenMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function receivedToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Navegadores não permitem definir cabeçalho ao abrir um WebSocket.
  if (request.url.startsWith('/ws')) return (request.query as { token?: string }).token;
  return undefined;
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host);
}

function originAllowed(request: FastifyRequest, allowed: Set<string>): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === 'null') return false;
  try {
    if (new URL(origin).host === request.headers.host) return true;
  } catch {
    return false;
  }
  return allowed.has(origin);
}

/**
 * Um socket de upgrade fica fora do controle do servidor HTTP: se o pedido for
 * recusado e ele continuar aberto, impede o app de encerrar. Por isso a recusa
 * é escrita direto no socket, que é fechado em seguida.
 */
function rejectUpgrade(request: FastifyRequest, reply: FastifyReply, status: number, message: string): FastifyReply {
  reply.hijack();
  const socket = request.raw.socket;
  const body = JSON.stringify({ message });
  socket.end(
    `HTTP/1.1 ${status} Recusado\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroySoon();
  return reply;
}

export function installHttpGuard(app: FastifyInstance, options: GuardOptions): void {
  const allowed = new Set(options.allowedOrigins ?? []);

  app.addHook('onRequest', async (request, reply) => {
    const refuse = (status: number, code: string, message: string) => {
      if (request.headers.upgrade) return rejectUpgrade(request, reply, status, message);
      throw new AppError(status, code, message);
    };

    // Host local barra DNS rebinding: um site apontando seu domínio para 127.0.0.1.
    if (!isLocalHost(request.headers.host)) return refuse(403, 'forbidden_host', 'Host não permitido.');
    if (!originAllowed(request, allowed)) return refuse(403, 'forbidden_origin', 'Origem não permitida.');
    // Só os arquivos da interface são públicos, e eles não contêm o token: ele chega
    // à página no fragmento da URL de abertura, que nunca é enviado ao servidor.
    const protectedPath = request.url.startsWith('/api/') || request.url.startsWith('/ws');
    if (!protectedPath || request.url === '/api/health') return undefined;
    if (!tokenMatches(receivedToken(request), options.token)) {
      return refuse(401, 'unauthorized', 'Token ausente ou inválido.');
    }
    return undefined;
  });
}
