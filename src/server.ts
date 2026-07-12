import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from './config.js';
import { registerAllTools } from './tools/index.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: 'cursidian',
    version,
  });

  registerAllTools(server, config);
  return server;
}
