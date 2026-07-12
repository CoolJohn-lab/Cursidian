import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { getNoteNeighborhoodHandler } from './get-note-neighborhood.js';

export function registerGraph(server: McpServer, config: Config): void {
  server.registerTool(
    'graph',
    {
      description:
        "Return a note's link neighborhood: resolved outgoing wikilinks plus backlinks (notes linking here). Depth 1 only. Path accepts vault-relative paths, titles, and frontmatter aliases.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative path, title, or frontmatter alias of the note'),
      },
    },
    async ({ path }) => getNoteNeighborhoodHandler(config)({ path }),
  );
}
