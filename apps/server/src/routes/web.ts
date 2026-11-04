import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

// A interface só carrega recursos dela mesma, o que limita o estrago caso a saída de
// um agente tente injetar algo na página.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function registerWebRoutes(app: FastifyInstance, webDir: string): void {
  const root = path.resolve(webDir);

  const send = (file: string) => {
    const content = fs.readFileSync(file);
    return { content, type: TYPES[path.extname(file)] ?? 'application/octet-stream' };
  };

  app.get('/*', async (request, reply) => {
    const pathname = decodeURIComponent(request.url.split('?')[0] ?? '/');
    if (pathname.startsWith('/api/') || pathname.startsWith('/ws')) return reply.code(404).send({ error: 'not_found' });

    let file = path.resolve(root, `.${pathname}`);
    const inside = file === root || file.startsWith(root + path.sep);
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Rotas da interface caem no index.html; arquivos que faltam não.
      if (path.extname(pathname)) return reply.code(404).send({ error: 'not_found' });
      file = path.join(root, 'index.html');
    }
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'not_found' });
    const { content, type } = send(file);
    return reply
      .header('content-type', type)
      .header('content-security-policy', CSP)
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(content);
  });
}
