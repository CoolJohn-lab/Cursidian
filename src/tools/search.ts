import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { searchContentHandler } from './search-content.js';
import { searchByTagsHandler } from './search-by-tags.js';
import { listNotesHandler } from './list-notes.js';
import { listRecentHandler } from './list-recent.js';
import { listTagsHandler } from './list-tags.js';
import { invalidArgsError, validateActionArguments } from '../types/index.js';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, MAX_QUERY_LENGTH, MAX_RECENT_LIMIT } from '../lib/limits.js';

export function registerSearch(server: McpServer, config: Config): void {
  server.registerTool(
    'search',
    {
      description:
        'Find notes. action=content (default): full-text search, prefer 2-3 keywords, token-AND with OR fallback and typo correction, format=compact for index-only results. action=by_tags: frontmatter tag filter (AND). action=list: enumerate notes by folder (missing folder -> not_found). action=recent: newest first. action=tags: full tag vocabulary with counts; accepts no other arguments. content/by_tags/list/recent support cursor/truncated/nextCursor (stale cursor -> structured error with details.changedPaths). Responses may set incomplete+skipped when the vault scan could not read every file. list/recent/content exclude index/_raw unless includeOperational=true.',
      inputSchema: {
        action: z
          .enum(['content', 'by_tags', 'list', 'recent', 'tags'])
          .optional()
          .default('content')
          .describe('Selects content, by_tags, list, recent, or tags action; defaults to content'),
        query: z.string().max(MAX_QUERY_LENGTH).optional().describe('Used by content action only'),
        tags: z
          .array(z.string().min(1))
          .optional()
          .describe('Used by by_tags and content actions'),
        folder: z.string().max(500).optional().describe('Used by list and recent actions'),
        recursive: z.boolean().optional().describe('Used by list action only'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe('Used by content, by_tags, list, and recent actions. Not valid for action=tags'),
        cursor: z
          .string()
          .optional()
          .describe('Used by content, by_tags, list, and recent actions. Not valid for action=tags'),
        caseSensitive: z.boolean().optional().describe('Used by content action only'),
        verbose: z.boolean().optional().describe('Used by content action only'),
        includeOperational: z
          .boolean()
          .optional()
          .describe('Used by content, list, and recent actions'),
        format: z
          .enum(['full', 'compact'])
          .optional()
          .describe('Used by content action only'),
      },
    },
    async (args) => {
      const action = args.action ?? 'content';
      const specs: Record<string, { allowed: string[]; required?: string[] }> = {
        content: {
          allowed: [
            'query',
            'tags',
            'limit',
            'cursor',
            'caseSensitive',
            'verbose',
            'includeOperational',
            'format',
          ],
          required: ['query'],
        },
        by_tags: { allowed: ['tags', 'limit', 'cursor'], required: ['tags'] },
        list: { allowed: ['folder', 'recursive', 'limit', 'cursor', 'includeOperational'] },
        recent: { allowed: ['folder', 'limit', 'cursor', 'includeOperational'] },
        tags: { allowed: [] },
      };
      const spec = specs[action];
      const validation = validateActionArguments({
        tool: 'search',
        action,
        args: { ...args, action },
        allowed: spec.allowed,
        required: spec.required,
      });
      if (validation) {
        return validation;
      }

      const {
        query,
        tags,
        folder,
        recursive,
        limit,
        cursor,
        caseSensitive,
        verbose,
        includeOperational,
        format,
      } = args;

      switch (action) {
        case 'content':
          return searchContentHandler(config)({
            query: query as string,
            caseSensitive,
            limit,
            cursor,
            tags,
            verbose,
            includeOperational,
            format,
          });
        case 'by_tags':
          if (!tags || tags.length === 0) {
            return invalidArgsError({
              tool: 'search',
              action,
              message: 'action "by_tags" requires a non-empty tags array',
              required: ['tags'],
              missing: ['tags'],
              rejected: [],
              arguments: { action: 'by_tags', tags: ['<tag>'] },
            });
          }
          if (tags.some((t) => t.trim().length === 0)) {
            return invalidArgsError({
              tool: 'search',
              action,
              message: 'tags must not contain empty or whitespace-only strings',
              required: ['tags'],
              missing: [],
              rejected: ['tags'],
              arguments: { action: 'by_tags', tags: tags.filter((tag) => tag.trim().length > 0) },
            });
          }
          return searchByTagsHandler(config)({ tags, limit, cursor });
        case 'list':
          return listNotesHandler(config)({
            folder,
            recursive,
            includeOperational,
            limit: limit ?? DEFAULT_LIST_LIMIT,
            cursor,
          });
        case 'recent': {
          const recentLimit = limit !== undefined ? Math.min(limit, MAX_RECENT_LIMIT) : undefined;
          return listRecentHandler(config)({
            limit: recentLimit,
            folder,
            includeOperational,
            cursor,
          });
        }
        case 'tags':
          return listTagsHandler(config)();
        default:
          return invalidArgsError({
            tool: 'search',
            action: action as string,
            message: `Unknown action: ${action as string}`,
            rejected: ['action'],
            arguments: { action: 'content', query: '<query>' },
          });
      }
    },
  );
}
