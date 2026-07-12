import { z } from 'zod/v3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { readNoteHandler } from './read-note.js';
import { createNoteHandler } from './create-note.js';
import { updateNoteHandler } from './update-note.js';
import { deleteNoteHandler } from './delete-note.js';
import { renameNoteHandler } from './rename-note.js';
import { manageFrontmatterHandler } from './manage-frontmatter.js';
import { err } from '../types/index.js';

export function registerNote(server: McpServer, config: Config): void {
  server.registerTool(
    'note',
    {
      description:
        'Read, create, update, delete, rename a note, or edit its frontmatter. action=read returns content+frontmatter+contentHash+outgoingLinks. Path accepts vault-relative paths, titles, and frontmatter aliases (except create, which writes the literal path). update: prefer patch (old_string/new_string) or replace_section (heading); replace is size-guarded. Pass expectedHash from read to detect concurrent edits.',
      inputSchema: {
        action: z
          .enum(['read', 'create', 'update', 'delete', 'rename', 'frontmatter'])
          .describe('Operation: read, create, update, delete, rename, or frontmatter'),
        path: z
          .string()
          .min(1)
          .describe(
            'Note path, title, or frontmatter alias (rename source when action=rename; create uses literal path)',
          ),
        content: z.string().optional().describe('Body for create or update modes'),
        frontmatter: z
          .record(z.unknown())
          .optional()
          .describe('Metadata for create or frontmatter set/merge'),
        overwrite: z.boolean().optional().describe('Overwrite existing note on create'),
        mode: z
          .enum(['replace', 'append', 'prepend', 'patch', 'replace_section'])
          .optional()
          .describe('Update mode; patch inferred when old_string/new_string set'),
        old_string: z.string().optional().describe('Find text for patch mode'),
        new_string: z.string().optional().describe('Replace text for patch mode'),
        heading: z
          .string()
          .optional()
          .describe('Section heading for replace_section (with or without # markers)'),
        expectedHash: z.string().optional().describe('contentHash from read for concurrency check'),
        force: z.boolean().optional().describe('Bypass replace size guard'),
        confirm: z.boolean().optional().describe('Must be true for delete'),
        newPath: z.string().optional().describe('Destination path for rename'),
        updateBacklinks: z.boolean().optional().describe('Rewrite wikilinks on rename'),
        updateIndex: z.boolean().optional().describe('Update index.md on rename'),
        fmOperation: z
          .enum(['set', 'merge', 'delete'])
          .optional()
          .describe('Frontmatter operation (get via action=read)'),
        keys: z.array(z.string()).optional().describe('Frontmatter keys to delete'),
      },
    },
    async (args) => {
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
        expectedHash,
        force,
        confirm,
        newPath,
        updateBacklinks,
        updateIndex,
        fmOperation,
        keys,
      } = args;

      switch (action) {
        case 'read':
          return readNoteHandler(config)({ path });
        case 'create':
          if (content === undefined) {
            return err('action "create" requires content', 'invalid_args', { path });
          }
          return createNoteHandler(config)({ path, content, frontmatter, overwrite });
        case 'update':
          return updateNoteHandler(config)({
            path,
            content,
            mode,
            old_string,
            new_string,
            heading,
            expectedHash,
            force,
          });
        case 'delete':
          if (confirm !== true) {
            return err('delete requires confirm: true', 'invalid_args', { path });
          }
          return deleteNoteHandler(config)({ path, confirm: true });
        case 'rename':
          if (!newPath) {
            return err('action "rename" requires newPath', 'invalid_args', { path });
          }
          return renameNoteHandler(config)({
            from: path,
            to: newPath,
            updateBacklinks,
            updateIndex,
          });
        case 'frontmatter':
          if (!fmOperation) {
            return err('action "frontmatter" requires fmOperation', 'invalid_args', { path });
          }
          return manageFrontmatterHandler(config)({
            path,
            operation: fmOperation,
            data: frontmatter,
            keys,
          });
        default:
          return err(`Unknown action: ${action as string}`, 'invalid_args', { path });
      }
    },
  );
}
