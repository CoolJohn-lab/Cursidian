import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { searchContentHandler } from './search-content.js';
import { searchByTagsHandler } from './search-by-tags.js';
import { listNotesHandler } from './list-notes.js';
import { listRecentHandler } from './list-recent.js';
import { listTagsHandler } from './list-tags.js';
import { err } from '../types/index.js';

export function registerSearch(server: McpServer, config: Config): void {
  server.registerTool(
    'search',
    {
      description:
        'Find notes. action=content (default): full-text search, prefer 2-3 keywords, token-AND with OR fallback and typo correction, format=compact for index-only results. action=by_tags: frontmatter tag filter (AND). action=list: enumerate notes by folder (missing folder → not_found). action=recent: newest first. action=tags: tag vocabulary with counts. list/recent/content exclude index/log/hot/_raw/_archives unless includeOperational=true.',
      inputSchema: {
        action: z
          .enum(['content', 'by_tags', 'list', 'recent', 'tags'])
          .optional()
          .default('content')
          .describe('Search mode; defaults to content'),
        query: z.string().optional().describe('Keywords for content search'),
        tags: z
          .array(z.string().min(1))
          .optional()
          .describe('Required for by_tags; optional AND-filter for content'),
        folder: z.string().optional().describe('Subfolder filter for list/recent'),
        recursive: z.boolean().optional().describe('Include subfolders for list'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max results for content/by_tags/recent'),
        caseSensitive: z.boolean().optional().describe('Case-sensitive content search'),
        verbose: z.boolean().optional().describe('Include matchReasons and snippet match text'),
        includeOperational: z
          .boolean()
          .optional()
          .describe('Include index/log/hot/_raw/_archives (content, list, recent)'),
        format: z
          .enum(['full', 'compact'])
          .optional()
          .describe('full=snippets; compact=metadata only'),
      },
    },
    async (args) => {
      const {
        action = 'content',
        query,
        tags,
        folder,
        recursive,
        limit,
        caseSensitive,
        verbose,
        includeOperational,
        format,
      } = args;

      switch (action) {
        case 'content':
          if (!query) {
            return err('action "content" requires query', 'invalid_args');
          }
          return searchContentHandler(config)({
            query,
            caseSensitive,
            limit,
            tags,
            verbose,
            includeOperational,
            format,
          });
        case 'by_tags':
          if (!tags || tags.length === 0) {
            return err('action "by_tags" requires a non-empty tags array', 'invalid_args');
          }
          if (tags.some((t) => t.trim().length === 0)) {
            return err('tags must not contain empty or whitespace-only strings', 'invalid_args');
          }
          return searchByTagsHandler(config)({ tags, limit });
        case 'list':
          return listNotesHandler(config)({ folder, recursive, includeOperational });
        case 'recent':
          return listRecentHandler(config)({ limit, folder, includeOperational });
        case 'tags':
          return listTagsHandler(config)();
        default:
          return err(`Unknown action: ${action as string}`, 'invalid_args');
      }
    },
  );
}
