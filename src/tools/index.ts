import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';

import { registerNote } from './note.js';
import { registerSearch } from './search.js';
import { registerGraph } from './graph.js';
import { registerVault } from './vault.js';
import { registerContext } from './context.js';

/**
 * Registers the consolidated 5-tool MCP surface for Cursor agents.
 */
export function registerAllTools(server: McpServer, config: Config): void {
  registerNote(server, config);
  registerSearch(server, config);
  registerGraph(server, config);
  registerVault(server, config);
  registerContext(server, config);
}
