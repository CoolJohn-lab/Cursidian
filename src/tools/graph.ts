import { z } from 'zod/v3';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { getNoteNeighborhoodHandler } from './get-note-neighborhood.js';
import { MAX_GRAPH_BACKLINK_LIMIT } from '../lib/limits.js';

export function registerGraph(server: McpServer, config: Config): void {
  server.registerTool(
    'graph',
    {
      description:
        "Return a note's link neighborhood: resolved outgoing wikilinks, unresolved outgoing links, plus paginated backlinks (notes linking here). Depth 1 only. Path accepts vault-relative paths, titles, and frontmatter aliases.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Vault-relative path, title, or frontmatter alias of the note'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_GRAPH_BACKLINK_LIMIT)
          .optional()
          .describe('Maximum backlinks per page'),
        cursor: z.string().optional().describe('Pagination cursor from a prior graph response'),
      },
    },
    async ({ path, limit, cursor }) => getNoteNeighborhoodHandler(config)({ path, limit, cursor }),
  );
}
