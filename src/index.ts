#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  logger.info('cursidian starting', {
    vault: config.vaultPath,
    readOnly: config.readOnly,
  });

  await server.connect(transport);
  logger.info('cursidian ready');
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
