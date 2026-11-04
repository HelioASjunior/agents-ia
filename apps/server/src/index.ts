import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { createConfig } from './config.ts';

/** Canal com a casca desktop, quando o servidor roda dentro do aplicativo. */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: { type?: string } }) => void): void;
}
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;

try {
  const config = createConfig();
  const webDir = process.env.XINOIA_WEB_DIR
    ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

  const { app, ctx, token } = await createApp({
    config,
    webDir: fs.existsSync(webDir) ? webDir : undefined,
    allowedOrigins: process.env.XINOIA_DEV_ORIGIN ? [process.env.XINOIA_DEV_ORIGIN] : [],
  });

  await ctx.detection.refresh();
  void ctx.profiles.checkAll();

  const port = Number(process.env.XINOIA_PORT ?? 0);
  const address = await app.listen({ host: '127.0.0.1', port });
  const actualPort = Number(new URL(address).port);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await app.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (parent) {
    parent.on('message', (event) => {
      if (event.data?.type === 'shutdown') void shutdown();
    });
    parent.postMessage({ type: 'ready', port: actualPort, token });
  } else {
    process.stdout.write(`XinoIA pronto. Abra: ${address}/#token=${token}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (parent) parent.postMessage({ type: 'fatal', error: message });
  else process.stderr.write(`${message}\n`);
  process.exit(1);
}
