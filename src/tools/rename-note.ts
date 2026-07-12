import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { getVaultIndex, clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { findBacklinks } from '../lib/backlinks.js';
import { rewriteWikilinksForRename } from '../lib/wikilinks.js';
import { atomicReplace, PartialUpdateError } from '../lib/vault-io.js';
import { backupNoteIfExists } from '../lib/backup.js';
import { ok, err, mapToolError } from '../types/index.js';

interface PendingRewrite {
  absolutePath: string;
  body: string;
  backup?: boolean;
}

export function renameNoteHandler(config: Config) {
  return async ({
    from: fromPath,
    to: toPath,
    updateBacklinks,
    updateIndex,
  }: {
    from: string;
    to: string;
    updateBacklinks?: boolean;
    updateIndex?: boolean;
  }) => {
    const completed: string[] = [];
    try {
      assertNotReadOnly(config.readOnly);

      const effectiveUpdateBacklinks = updateBacklinks ?? true;
      const effectiveUpdateIndex = updateIndex ?? true;

      const fromResolved = await resolveExistingNotePath(config.vaultPath, fromPath);
      const toResolved = resolvePath(config.vaultPath, toPath);
      await assertSafePathAsync(config.vaultPath, fromResolved);
      await assertSafePathAsync(config.vaultPath, toResolved);

      const fromRelative = toRelativePath(config.vaultPath, fromResolved);
      const toRelative = toRelativePath(config.vaultPath, toResolved);

      try {
        await fs.access(toResolved);
        return err(`Destination already exists: ${toPath}`, 'already_exists', { path: toPath });
      } catch {
        // destination free
      }

      const index = await getVaultIndex(config.vaultPath);
      const backlinksBeforeRename = effectiveUpdateBacklinks
        ? await findBacklinks(config.vaultPath, fromRelative, index, config.maxFileSize)
        : [];

      const pending: PendingRewrite[] = [];

      if (effectiveUpdateBacklinks) {
        for (const backlink of backlinksBeforeRename) {
          const backlinkNorm = backlink.path.replace(/\\/g, '/').toLowerCase();
          if (effectiveUpdateIndex && backlinkNorm === 'index.md') {
            continue;
          }
          const backlinkResolved = resolvePath(config.vaultPath, backlink.path);
          await assertSafePathAsync(config.vaultPath, backlinkResolved);
          const raw = await readFileBounded(backlinkResolved, config.maxFileSize);
          const { data, content } = parseFrontmatter(raw);
          const rewritten = rewriteWikilinksForRename(content, fromRelative, toRelative);
          if (rewritten !== content) {
            pending.push({
              absolutePath: backlinkResolved,
              body: stringifyFrontmatter(data, rewritten),
              backup: true,
            });
          }
        }
      }

      if (effectiveUpdateIndex) {
        const indexResolved = resolvePath(config.vaultPath, 'index.md');
        await assertSafePathAsync(config.vaultPath, indexResolved);
        try {
          const raw = await readFileBounded(indexResolved, config.maxFileSize);
          const { data, content } = parseFrontmatter(raw);
          const rewritten = rewriteWikilinksForRename(content, fromRelative, toRelative);
          if (rewritten !== content) {
            pending.push({
              absolutePath: indexResolved,
              body: stringifyFrontmatter(data, rewritten),
              backup: true,
            });
          }
        } catch {
          // no index.md
        }
      }

      let backlinksUpdated = 0;
      let indexUpdated = false;

      for (const item of pending) {
        if (config.backupEnabled && item.backup) {
          await backupNoteIfExists(config.vaultPath, item.absolutePath);
        }
        await atomicReplace(config.vaultPath, item.absolutePath, item.body, config.maxFileSize);
        const rel = toRelativePath(config.vaultPath, item.absolutePath);
        completed.push(rel);
        if (rel === 'index.md') {
          indexUpdated = true;
        } else {
          backlinksUpdated += 1;
        }
      }

      await fs.mkdir(path.dirname(toResolved), { recursive: true });
      await assertSafePathAsync(config.vaultPath, toResolved);
      await fs.rename(fromResolved, toResolved);
      completed.push(toRelative);

      clearAllSearchCaches();

      return ok({
        from: fromRelative,
        to: toRelative,
        backlinksUpdated,
        indexUpdated,
      });
    } catch (e) {
      if (e instanceof PartialUpdateError) {
        return mapToolError(e, { path: fromPath });
      }
      return mapToolError(e, { path: fromPath });
    }
  };
}
