import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { vaultHealthHandler } from './vault-health.js';
import { syncIndexHandler } from './sync-index.js';
import { manageFoldersHandler } from './manage-folders.js';
import { operationHistoryHandler } from './operation-history.js';
import { undoOperationHandler } from './undo-operation.js';
import { manageManifestHandler } from './manage-manifest.js';
import { manageVocabularyHandler } from './manage-vocabulary.js';
import { vaultDeslopHandler, vaultSlopCheckHandler } from './vault-slop.js';
import { invalidArgsError, validateActionArguments } from '../types/index.js';

export function registerVault(server: McpServer, config: Config): void {
  server.registerTool(
    'vault',
    {
      description:
        'Vault maintenance. action=health: structured report (orphans, broken links, index drift, stale pages; respects index.md indexMode flat|hub). action=sync_index: flat rebuild of index.md from frontmatter, or hub mode preserve curated body (never dump every leaf). action=slop_check: read-only LLM-slop report (body + frontmatter). action=deslop: journaled char/emoji auto-fix (confirm: true; dryRun preview). action=create_folder/list_folders/delete_folder: folder ops (delete requires confirm, empty folders only). action=history: list journaled operations. action=undo: reverse a journaled operation (requires confirm: true). action=manifest: typed read/upsert/remove for _meta/manifest.md ingest ledger. action=vocabulary: typed read/upsert/remove for _meta/vocabulary.md domain synonyms and pairings, used by search query expansion.',
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
            'history',
            'undo',
            'manifest',
            'vocabulary',
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
          .enum(['source', 'project', 'synonym', 'pairing'])
          .optional()
          .describe('Used by manifest remove and vocabulary remove'),
        removeKey: z.string().optional().describe('Used by manifest remove and vocabulary remove'),
        expectedRevision: z.string().optional().describe('Used by manifest mutations only'),
        vocabularyOperation: z
          .enum(['read', 'upsert', 'remove'])
          .optional()
          .describe('Used by vocabulary action only'),
        synonymGroup: z
          .array(z.string())
          .optional()
          .describe('Used by vocabulary upsert only - 2+ interchangeable words/phrases'),
        pairingKey: z.string().optional().describe('Used by vocabulary upsert only'),
        pairingValues: z.array(z.string()).optional().describe('Used by vocabulary upsert only'),
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
      const vocabularySpecs: Record<string, { allowed: string[]; required?: string[] }> = {
        read: { allowed: ['vocabularyOperation'] },
        upsert: {
          allowed: ['vocabularyOperation', 'synonymGroup', 'pairingKey', 'pairingValues'],
          required: ['vocabularyOperation'],
        },
        remove: {
          allowed: ['vocabularyOperation', 'removeKind', 'removeKey'],
          required: ['vocabularyOperation', 'removeKind', 'removeKey'],
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
      } else if (args.action === 'vocabulary') {
        if (!args.vocabularyOperation) {
          return invalidArgsError({
            tool: 'vault',
            action: 'vocabulary',
            message: 'vocabulary requires vocabularyOperation',
            required: ['vocabularyOperation'],
            missing: ['vocabularyOperation'],
            rejected: [],
            arguments: { action: 'vocabulary', vocabularyOperation: 'read' },
          });
        }
        const vocabularySpec = vocabularySpecs[args.vocabularyOperation];
        if (!vocabularySpec) {
          return invalidArgsError({
            tool: 'vault',
            action: 'vocabulary',
            message: `Unknown vocabularyOperation: ${args.vocabularyOperation}`,
            required: ['vocabularyOperation'],
            missing: [],
            rejected: ['vocabularyOperation'],
            arguments: { action: 'vocabulary', vocabularyOperation: 'read' },
          });
        }
        const vocabularyValidation = validateActionArguments({
          tool: 'vault',
          action: 'vocabulary',
          args,
          allowed: vocabularySpec.allowed,
          required: vocabularySpec.required,
        });
        if (vocabularyValidation) {
          return vocabularyValidation;
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
        vocabularyOperation,
        synonymGroup,
        pairingKey,
        pairingValues,
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
            removeKind:
              removeKind === 'source' || removeKind === 'project' ? removeKind : undefined,
            removeKey,
          });
        case 'vocabulary':
          return manageVocabularyHandler(config)({
            vocabularyOperation: vocabularyOperation as 'read' | 'upsert' | 'remove',
            synonymGroup,
            pairingKey,
            pairingValues,
            removeKind:
              removeKind === 'synonym' || removeKind === 'pairing' ? removeKind : undefined,
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
