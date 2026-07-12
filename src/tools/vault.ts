import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { vaultHealthHandler } from './vault-health.js';
import { syncIndexHandler } from './sync-index.js';
import { manageFoldersHandler } from './manage-folders.js';
import { touchWikiMetaHandler } from './touch-wiki-meta.js';
import { operationHistoryHandler } from './operation-history.js';
import { undoOperationHandler } from './undo-operation.js';
import { invalidArgsError, validateActionArguments } from '../types/index.js';
import { MAX_LOG_LINE_LENGTH } from '../lib/limits.js';

export function registerVault(server: McpServer, config: Config): void {
  server.registerTool(
    'vault',
    {
      description:
        'Vault maintenance. action=health: structured report (orphans, broken links, index drift, stale pages). action=sync_index: regenerate index.md from frontmatter. action=create_folder/list_folders/delete_folder: folder ops (delete requires confirm, empty folders only). action=log: append to log.md and optionally hot.md (wiki bookkeeping). action=history: list journaled operations. action=undo: reverse a journaled operation (requires confirm: true).',
      inputSchema: {
        action: z
          .enum([
            'health',
            'sync_index',
            'create_folder',
            'list_folders',
            'delete_folder',
            'log',
            'history',
            'undo',
          ])
          .describe('Selects a vault maintenance action'),
        path: z.string().optional().describe('Used by create_folder, list_folders, and delete_folder actions'),
        staleDays: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Used by health action only'),
        dryRun: z.boolean().optional().describe('Used by sync_index action only'),
        confirm: z.boolean().optional().describe('Used by delete_folder and undo actions; must be true'),
        logLine: z.string().max(MAX_LOG_LINE_LENGTH).optional().describe('Used by log action only'),
        hotActivity: z.string().max(MAX_LOG_LINE_LENGTH).optional().describe('Used by log action only'),
        expectedLogHash: z.string().optional().describe('Used by log action only'),
        expectedHotHash: z.string().optional().describe('Used by log action only'),
        operationId: z.string().optional().describe('Used by undo action only'),
        force: z.boolean().optional().describe('Used by undo action only'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Used by history action only'),
      },
    },
    async (args) => {
      const specs: Record<string, { allowed: string[]; required?: string[] }> = {
        health: { allowed: ['staleDays'] },
        sync_index: { allowed: ['dryRun'] },
        create_folder: { allowed: ['path'], required: ['path'] },
        list_folders: { allowed: ['path'] },
        delete_folder: { allowed: ['path', 'confirm'], required: ['path', 'confirm'] },
        log: {
          allowed: ['logLine', 'hotActivity', 'expectedLogHash', 'expectedHotHash'],
          required: ['logLine'],
        },
        history: { allowed: ['limit'] },
        undo: {
          allowed: ['operationId', 'confirm', 'force'],
          required: ['operationId', 'confirm'],
        },
      };
      const spec = specs[args.action];
      const validation = validateActionArguments({
        tool: 'vault',
        action: args.action,
        args,
        allowed: spec.allowed,
        required: spec.required,
        path: args.path,
      });
      if (validation) {
        return validation;
      }

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
        operationId,
        force,
        limit,
      } = args;

      switch (action) {
        case 'health':
          return vaultHealthHandler(config)({ staleDays });
        case 'sync_index':
          return syncIndexHandler(config)({ dryRun });
        case 'create_folder':
          return manageFoldersHandler(config)({ operation: 'create', path: path as string });
        case 'list_folders':
          return manageFoldersHandler(config)({ operation: 'list', path: path ?? '' });
        case 'delete_folder':
          if (confirm !== true) {
            return invalidArgsError({
              tool: 'vault',
              action,
              message: 'delete_folder requires confirm: true',
              required: ['path', 'confirm'],
              missing: [],
              rejected: [],
              path,
              arguments: { action: 'delete_folder', path, confirm: true },
            });
          }
          return manageFoldersHandler(config)({ operation: 'delete', path: path as string, confirm: true });
        case 'log':
          return touchWikiMetaHandler(config)({
            logLine: logLine as string,
            hotActivity,
            expectedLogHash,
            expectedHotHash,
          });
        case 'history':
          return operationHistoryHandler(config)({ limit });
        case 'undo':
          if (confirm !== true) {
            return invalidArgsError({
              tool: 'vault',
              action,
              message: 'undo requires confirm: true',
              required: ['operationId', 'confirm'],
              missing: [],
              rejected: [],
              arguments: { action: 'undo', operationId, confirm: true },
            });
          }
          return undoOperationHandler(config)({
            operationId: operationId as string,
            force,
          });
        default:
          return invalidArgsError({
            tool: 'vault',
            action: action as string,
            message: `Unknown action: ${action as string}`,
            rejected: ['action'],
            arguments: { action: 'health' },
          });
      }
    },
  );
}
