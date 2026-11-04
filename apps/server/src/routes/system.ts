import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { PRODUCT_NAME } from '@xinoia/shared';
import type { AppContext } from '../context.ts';

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({ ok: true, product: PRODUCT_NAME }));

  app.get('/api/system', async () => ({
    product: PRODUCT_NAME,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    dataDir: ctx.config.dataDir,
    schemaVersion: await ctx.db.schemaVersion(),
    recoveredFrom: ctx.recoveredFrom,
    interruptedOnStart: ctx.interruptedOnStart,
    activeRuns: ctx.runs.activeCount(),
  }));

  app.post('/api/system/backup', async () => ({ file: await ctx.db.backup('manual') }));
}
