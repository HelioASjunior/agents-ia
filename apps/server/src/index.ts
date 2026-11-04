import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { createConfig } from './config.ts';

const config = createConfig();
const webDir = process.env.XINOIA_WEB_DIR
  ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const { app, ctx, token } = await createApp({
  config,
  webDir: fs.existsSync(webDir) ? webDir : undefined,
  allowedOrigins: process.env.XINOIA_DEV_ORIGIN ? [process.env.XINOIA_DEV_ORIGIN] : [],
});

await ctx.detection.refresh();
await ctx.profiles.checkAll();

const port = Number(process.env.XINOIA_PORT ?? 0);
const address = await app.listen({ host: '127.0.0.1', port });
const runtimeFile = path.join(config.dataDir, 'runtime.json');
const actualPort = Number(new URL(address).port);

// Como a casca desktop descobre onde falar. Fica na pasta do usuário.
fs.writeFileSync(runtimeFile, JSON.stringify({ port: actualPort, token, pid: process.pid }), { mode: 0o600 });

process.stdout.write(`XinoIA pronto. Abra: ${address}/#token=${token}\n`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  fs.rmSync(runtimeFile, { force: true });
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
