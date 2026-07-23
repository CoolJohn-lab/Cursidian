import { z } from 'zod/v3';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { readNoteHandler } from './read-note.js';
import { createNoteHandler } from './create-note.js';
import { updateNoteHandler } from './update-note.js';
import { deleteNoteHandler } from './delete-note.js';
import { renameNoteHandler } from './rename-note.js';
import { manageFrontmatterHandler } from './manage-frontmatter.js';
import { invalidArgsError, validateActionArguments } from '../types/index.js';
import {
  MAX_CONTENT_BYTES,
  MAX_FRONTMATTER_KEYS,
} from '../lib/limits.js';

const boundedContent = z.string().max(MAX_CONTENT_BYTES);
const boundedPatch = z.string().max(50_000);

export function registerNote(server: McpServer, config: Config): void {
  server.registerTool(
    'note',
    {
      description:
        'Read, create, update, delete, rename a note, or edit its frontmatter. action=read returns content+frontmatter+contentHash+revisionHash+outgoingLinks. Path accepts vault-relative paths, titles, and frontmatter aliases (except create, which writes the literal path). update: prefer patch (old_string/new_string) or replace_section (heading); replace is size-guarded; optional frontmatter merge on the same update (one journaled op for body + metadata). Pass expectedRevision from read to detect concurrent edits (expectedHash remains a deprecated body-hash alias). Mutations return operationId/undoAvailable when journaling is enabled; use vault undo to reverse.',
      inputSchema: {
        action: z
          .enum(['read', 'create', 'update', 'delete', 'rename', 'frontmatter'])
          .describe('Operation: read, create, update, delete, rename, or frontmatter'),
        path: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'Note path, title, or frontmatter alias (rename source when action=rename; create uses literal path)',
          ),
        content: boundedContent.optional().describe('Used by create and update actions'),
        frontmatter: z
          .record(z.unknown())
          .refine((obj) => Object.keys(obj).length <= MAX_FRONTMATTER_KEYS, {
            message: `frontmatter exceeds ${MAX_FRONTMATTER_KEYS} keys`,
          })
          .optional()
          .describe(
            'Used by create, frontmatter set/merge, and update (merge into existing frontmatter in the same journaled op)',
          ),
        overwrite: z.boolean().optional().describe('Used by create action only'),
        mode: z
          .enum(['replace', 'append', 'prepend', 'patch', 'replace_section'])
          .optional()
          .describe('Used by update action only; patch inferred when old_string and new_string are set'),
        old_string: boundedPatch.optional().describe('Used by update action patch mode only'),
        new_string: boundedPatch.optional().describe('Used by update action patch mode only'),
        heading: z.string().max(500).optional().describe('Used by update action replace_section mode only'),
        expectedRevision: z
          .string()
          .optional()
          .describe(
            'revisionHash from read; used by update, frontmatter, delete, rename, and create with overwrite:true',
          ),
        expectedHash: z
          .string()
          .optional()
          .describe(
            'Deprecated alias of contentHash from read; used by update, frontmatter, delete, rename, and create with overwrite:true',
          ),
        force: z.boolean().optional().describe('Used by update action replace mode only'),
        confirm: z.boolean().optional().describe('Used by delete action only; must be true'),
        newPath: z.string().max(500).optional().describe('Used by rename action only'),
        updateBacklinks: z.boolean().optional().describe('Used by rename action only'),
        updateIndex: z.boolean().optional().describe('Used by rename action only'),
        fmOperation: z
          .enum(['set', 'merge', 'delete'])
          .optional()
          .describe('Used by frontmatter action only'),
        replaceAll: z
          .boolean()
          .optional()
          .describe('Used by frontmatter action set operation only'),
        keys: z
          .array(z.string())
          .max(MAX_FRONTMATTER_KEYS)
          .optional()
          .describe('Used by frontmatter action delete operation only'),
      },
    },
    async (args) => {
      const specs: Record<string, { allowed: string[]; required?: string[] }> = {
        read: { allowed: ['path'], required: ['path'] },
        create: {
          allowed: ['path', 'content', 'frontmatter', 'overwrite', 'expectedRevision', 'expectedHash'],
          required: ['path', 'content'],
        },
        update: {
          allowed: [
            'path',
            'content',
            'mode',
            'old_string',
            'new_string',
            'heading',
            'frontmatter',
            'expectedRevision',
            'expectedHash',
            'force',
          ],
          required: ['path'],
        },
        delete: {
          allowed: ['path', 'confirm', 'expectedRevision', 'expectedHash'],
          required: ['path', 'confirm'],
        },
        rename: {
          allowed: ['path', 'newPath', 'updateBacklinks', 'updateIndex', 'expectedRevision', 'expectedHash'],
          required: ['path', 'newPath'],
        },
        frontmatter: {
          allowed: ['path', 'fmOperation', 'frontmatter', 'replaceAll', 'keys', 'expectedRevision', 'expectedHash'],
          required: ['path', 'fmOperation'],
        },
      };
      const spec = specs[args.action];
      const validation = validateActionArguments({
        tool: 'note',
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
        content,
        frontmatter,
        overwrite,
        mode,
        old_string,
        new_string,
        heading,
        expectedRevision,
        expectedHash,
        force,
        confirm,
        newPath,
        updateBacklinks,
        updateIndex,
        fmOperation,
        replaceAll,
        keys,
      } = args;

      switch (action) {
        case 'read':
          return readNoteHandler(config)({ path });
        case 'create':
          return createNoteHandler(config)({
            path,
            content: content as string,
            frontmatter,
            overwrite,
            expectedRevision,
            expectedHash,
          });
        case 'update':
          return updateNoteHandler(config)({
            path,
            content,
            mode,
            old_string,
            new_string,
            heading,
            frontmatter,
            expectedRevision,
            expectedHash,
            force,
          });
        case 'delete':
          if (confirm !== true) {
            return invalidArgsError({
              tool: 'note',
              action,
              message: 'delete requires confirm: true',
              required: ['path', 'confirm'],
              missing: [],
              rejected: [],
              path,
              arguments: { action: 'delete', path, confirm: true },
            });
          }
          return deleteNoteHandler(config)({
            path,
            confirm: true,
            expectedRevision,
            expectedHash,
          });
        case 'rename':
          return renameNoteHandler(config)({
            from: path,
            to: newPath as string,
            updateBacklinks,
            updateIndex,
            expectedRevision,
            expectedHash,
          });
        case 'frontmatter':
          return manageFrontmatterHandler(config)({
            path,
            operation: fmOperation as 'set' | 'merge' | 'delete',
            data: frontmatter,
            keys,
            replaceAll,
            expectedRevision,
            expectedHash,
          });
        default:
          return invalidArgsError({
            tool: 'note',
            action: action as string,
            message: `Unknown action: ${action as string}`,
            rejected: ['action'],
            path,
            arguments: { action: 'read', path },
          });
      }
    },
  );
}
