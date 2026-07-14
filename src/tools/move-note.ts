import { z } from 'zod/v3';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly } from '../lib/security.js';
import { replaceWikilink } from '../lib/wikilinks.js';
import { logger } from '../lib/logger.js';
import { ok, err } from '../types/index.js';

export function registerMoveNote(server: McpServer, config: Config): void {
  server.registerTool(
    'move_note',
    {
      description:
        'Move or rename a note within the vault. Optionally updates all wikilinks in other notes that reference the moved note. Use this to reorganize your vault structure while maintaining link integrity.',
      inputSchema: {
        fromPath: z.string().min(1).describe('Current path of the note to move (relative to vault root)'),
        toPath: z.string().min(1).describe('New destination path for the note (relative to vault root)'),
        updateBacklinks: z.boolean().optional().default(true).describe('If true, update [[wikilinks]] in all other notes that reference this note. Defaults to true.'),
      },
    },
    async ({ fromPath, toPath, updateBacklinks }) => {
      try {
        assertNotReadOnly(config.readOnly);

        const fromResolved = resolvePath(config.vaultPath, fromPath);
        const toResolved = resolvePath(config.vaultPath, toPath);

        await assertSafePathAsync(config.vaultPath, fromResolved);
        await assertSafePathAsync(config.vaultPath, toResolved);

        await fs.mkdir(path.dirname(toResolved), { recursive: true });
        await fs.rename(fromResolved, toResolved);

        const fromRelative = toRelativePath(config.vaultPath, fromResolved);
        const toRelative = toRelativePath(config.vaultPath, toResolved);

        let updatedFiles = 0;

        if (updateBacklinks) {
          const files = await fg('**/*.md', {
            cwd: config.vaultPath,
            absolute: true,
            dot: false,
            ignore: ['**/.obsidian-mcp-trash/**'],
          });

          for (const file of files) {
            if (file === toResolved) continue;
            const content = await fs.readFile(file, 'utf-8');
            const updated = replaceWikilink(content, fromRelative, toRelative);
            if (updated !== content) {
              await fs.writeFile(file, updated, 'utf-8');
              updatedFiles++;
            }
          }
        }

        logger.info('Note moved', { from: fromRelative, to: toRelative, updatedFiles });
        return ok({ from: fromRelative, to: toRelative, backlinksUpdated: updatedFiles });
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
