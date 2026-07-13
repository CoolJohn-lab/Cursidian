import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { vaultHealthHandler } from './vault-health.js';
import { syncIndexHandler } from './sync-index.js';
import { manageFoldersHandler } from './manage-folders.js';
import { touchWikiMetaHandler } from './touch-wiki-meta.js';
import { operationHistoryHandler } from './operation-history.js';
import { undoOperationHandler } from './undo-operation.js';
import { manageManifestHandler } from './manage-manifest.js';
import { vaultDeslopHandler, vaultSlopCheckHandler } from './vault-slop.js';
import { invalidArgsError, validateActionArguments } from '../types/index.js';
import { MAX_LOG_LINE_LENGTH } from '../lib/limits.js';

export function registerVault(server: McpServer, config: Config): void {
  server.registerTool(
    'vault',
    {
      description:
        'Vault maintenance. action=health: structured report (orphans, broken links, index drift, stale pages). action=sync_index: regenerate index.md from frontmatter. action=slop_check: read-only LLM-slop report (body + frontmatter). action=deslop: journaled char/emoji auto-fix (confirm: true; dryRun preview). action=create_folder/list_folders/delete_folder: folder ops (delete requires confirm, empty folders only). action=log: append to log.md and optionally hot.md (wiki bookkeeping). action=history: list journaled operations. action=undo: reverse a journaled operation (requires confirm: true). action=manifest: typed read/upsert/remove for _meta/manifest.md ingest ledger.',
      inputSchema: {
        action: z
          .enum([
            'health',
            'sync_index',
            'slop_check',
            'deslop',
            'create_folder',
            'list_folders',
            'delete_folder',
            'log',
            'history',
            'undo',
            'manifest',
          ])
          .describe('Selects a vault maintenance action'),
        manifestOperation: z
          .enum(['read', 'upsert_source', 'upsert_project', 'remove'])
          .optional()
          .describe('Used by manifest action only'),
        sourceKey: z.string().optional().describe('Used by manifest upsert_source and remove (source)'),
        sourceIngested: z.string().optional().describe('Used by manifest upsert_source only'),
        sourceMtime: z.string().optional().describe('Used by manifest upsert_source only'),
        sourcePages: z.array(z.string()).optional().describe('Used by manifest upsert_source only'),
        projectName: z.string().optional().describe('Used by manifest upsert_project and remove (project)'),
        projectCwd: z.string().optional().describe('Used by manifest upsert_project only'),
        projectLastCommit: z.string().optional().describe('Used by manifest upsert_project only'),
        projectSynced: z.string().optional().describe('Used by manifest upsert_project only'),
        removeKind: z
          .enum(['source', 'project'])
          .optional()
          .describe('Used by manifest remove only'),
        removeKey: z.string().optional().describe('Used by manifest remove only'),
        expectedRevision: z.string().optional().describe('Used by manifest mutations only'),
        path: z.string().optional().describe('Used by create_folder, list_folders, and delete_folder actions'),
        staleDays: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Used by health action only'),
        dryRun: z.boolean().optional().describe('Used by sync_index and deslop actions'),
        confirm: z
          .boolean()
          .optional()
          .describe('Used by delete_folder, undo, and deslop actions; must be true'),
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
        slop_check: { allowed: [] },
        deslop: { allowed: ['dryRun', 'confirm'] },
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
      const manifestSpecs: Record<string, { allowed: string[]; required?: string[] }> = {
        read: { allowed: ['manifestOperation'] },
        upsert_source: {
          allowed: [
            'manifestOperation',
            'expectedRevision',
            'sourceKey',
            'sourceIngested',
            'sourceMtime',
            'sourcePages',
          ],
          required: ['manifestOperation', 'sourceKey', 'sourceIngested'],
        },
        upsert_project: {
          allowed: [
            'manifestOperation',
            'expectedRevision',
            'projectName',
            'projectCwd',
            'projectLastCommit',
            'projectSynced',
          ],
          required: ['manifestOperation', 'projectName', 'projectCwd'],
        },
        remove: {
          allowed: ['manifestOperation', 'expectedRevision', 'removeKind', 'removeKey'],
          required: ['manifestOperation', 'removeKind', 'removeKey'],
        },
      };

      if (args.action === 'manifest') {
        if (!args.manifestOperation) {
          return invalidArgsError({
            tool: 'vault',
            action: 'manifest',
            message: 'manifest requires manifestOperation',
            required: ['manifestOperation'],
            missing: ['manifestOperation'],
            rejected: [],
            arguments: { action: 'manifest', manifestOperation: 'read' },
          });
        }
        const manifestSpec = manifestSpecs[args.manifestOperation];
        if (!manifestSpec) {
          return invalidArgsError({
            tool: 'vault',
            action: 'manifest',
            message: `Unknown manifestOperation: ${args.manifestOperation}`,
            required: ['manifestOperation'],
            missing: [],
            rejected: ['manifestOperation'],
            arguments: { action: 'manifest', manifestOperation: 'read' },
          });
        }
        const manifestValidation = validateActionArguments({
          tool: 'vault',
          action: 'manifest',
          args,
          allowed: manifestSpec.allowed,
          required: manifestSpec.required,
        });
        if (manifestValidation) {
          return manifestValidation;
        }
      } else {
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
        manifestOperation,
        sourceKey,
        sourceIngested,
        sourceMtime,
        sourcePages,
        projectName,
        projectCwd,
        projectLastCommit,
        projectSynced,
        removeKind,
        removeKey,
        expectedRevision,
      } = args;

      switch (action) {
        case 'health':
          return vaultHealthHandler(config)({ staleDays });
        case 'sync_index':
          return syncIndexHandler(config)({ dryRun });
        case 'slop_check':
          return vaultSlopCheckHandler(config)();
        case 'deslop':
          return vaultDeslopHandler(config)({ dryRun, confirm });
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
        case 'manifest':
          return manageManifestHandler(config)({
            manifestOperation: manifestOperation as 'read' | 'upsert_source' | 'upsert_project' | 'remove',
            expectedRevision,
            sourceKey,
            sourceIngested,
            sourceMtime,
            sourcePages,
            projectName,
            projectCwd,
            projectLastCommit,
            projectSynced,
            removeKind,
            removeKey,
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
