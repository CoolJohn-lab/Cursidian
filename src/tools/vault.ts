import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { vaultHealthHandler } from './vault-health.js';
import { syncIndexHandler } from './sync-index.js';
import { manageFoldersHandler } from './manage-folders.js';
import { touchWikiMetaHandler } from './touch-wiki-meta.js';
import { err } from '../types/index.js';

export function registerVault(server: McpServer, config: Config): void {
  server.registerTool(
    'vault',
    {
      description:
        'Vault maintenance. action=health: structured report (orphans, broken links, index drift, stale pages). action=sync_index: regenerate index.md from frontmatter. action=create_folder/list_folders/delete_folder: folder ops (delete requires confirm, empty folders only). action=log: append to log.md and optionally hot.md (wiki bookkeeping).',
      inputSchema: {
        action: z
          .enum(['health', 'sync_index', 'create_folder', 'list_folders', 'delete_folder', 'log'])
          .describe('Vault maintenance operation'),
        path: z.string().optional().describe('Folder path for folder actions'),
        staleDays: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Stale threshold in days for health report'),
        dryRun: z.boolean().optional().describe('Preview sync_index without writing'),
        confirm: z.boolean().optional().describe('Must be true for delete_folder'),
        logLine: z.string().optional().describe('Log entry for action=log'),
        hotActivity: z.string().optional().describe('Optional hot.md Recent Activity bullet'),
        expectedLogHash: z.string().optional().describe('contentHash from read on log.md'),
        expectedHotHash: z.string().optional().describe('contentHash from read on hot.md'),
      },
    },
    async (args) => {
      const {
        action,
        path,
        staleDays,
        dryRun,
        confirm,
        logLine,
        hotActivity,
        expectedLogHash,
        expectedHotHash,
      } = args;

      switch (action) {
        case 'health':
          return vaultHealthHandler(config)({ staleDays });
        case 'sync_index':
          return syncIndexHandler(config)({ dryRun });
        case 'create_folder':
          if (!path) {
            return err('action "create_folder" requires path', 'invalid_args');
          }
          return manageFoldersHandler(config)({ operation: 'create', path });
        case 'list_folders':
          return manageFoldersHandler(config)({ operation: 'list', path: path ?? '' });
        case 'delete_folder':
          if (!path) {
            return err('action "delete_folder" requires path', 'invalid_args');
          }
          if (confirm !== true) {
            return err('delete_folder requires confirm: true', 'invalid_args', { path });
          }
          return manageFoldersHandler(config)({ operation: 'delete', path, confirm: true });
        case 'log':
          if (!logLine) {
            return err('action "log" requires logLine', 'invalid_args');
          }
          return touchWikiMetaHandler(config)({
            logLine,
            hotActivity,
            expectedLogHash,
            expectedHotHash,
          });
        default:
          return err(`Unknown action: ${action as string}`, 'invalid_args');
      }
    },
  );
}
