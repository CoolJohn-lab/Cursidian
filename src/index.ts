#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { logger } from './lib/logger.js';
import { drainInFlight, reapOrphanTempFiles } from './lib/vault-io.js';
import { flushLogSink } from './lib/logger.js';

let shuttingDown = false;

async function shutdown(signal: string, server: McpServer): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('cursidian shutting down', { signal });
  const drained = await drainInFlight(5000);
  if (!drained) {
    logger.warn('shutdown proceeded with operations still in flight');
  }
  try {
    await flushLogSink();
  } catch {
    // best-effort
  }
  try {
    await server.close();
  } catch {
    // best-effort
  }
  process.exit(drained ? 0 : 1);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void shutdown(sig, server);
    });
  }
  process.stdin.on('close', () => {
    void shutdown('stdin-close', server);
  });

  logger.info('cursidian starting', {
    vault: config.vaultPath,
    readOnly: config.readOnly,
  });

  await server.connect(transport);
  logger.info('cursidian ready');

  void reapOrphanTempFiles(config.vaultPath).then((removed) => {
    if (removed > 0) {
      logger.info('reaped orphan temp files', { removed });
    }
  });
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
