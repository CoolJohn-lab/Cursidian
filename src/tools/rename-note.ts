import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { checkRevisionConcurrency } from '../lib/content-hash.js';
import { getVaultIndex, clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { findBacklinks } from '../lib/backlinks.js';
import { rewriteWikilinksForRename } from '../lib/wikilinks.js';
import { withPathLocks, atomicReplaceLocked, PartialUpdateError } from '../lib/vault-io.js';
import { backupNoteIfExists } from '../lib/backup.js';
import { ok, toolError, mapToolError } from '../types/index.js';

export function renameNoteHandler(config: Config) {
  return async ({
    from: fromPath,
    to: toPath,
    updateBacklinks,
    updateIndex,
    expectedRevision,
    expectedHash,
  }: {
    from: string;
    to: string;
    updateBacklinks?: boolean;
    updateIndex?: boolean;
    expectedRevision?: string;
    expectedHash?: string;
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

      const index = await getVaultIndex(config.vaultPath);
      const backlinksBeforeRename = effectiveUpdateBacklinks
        ? await findBacklinks(config.vaultPath, fromRelative, index, config.maxFileSize)
        : [];

      const rewriteCandidates: string[] = [];

      if (effectiveUpdateBacklinks) {
        for (const backlink of backlinksBeforeRename) {
          const backlinkNorm = backlink.path.replace(/\\/g, '/').toLowerCase();
          if (effectiveUpdateIndex && backlinkNorm === 'index.md') {
            continue;
          }
          const backlinkResolved = resolvePath(config.vaultPath, backlink.path);
          await assertSafePathAsync(config.vaultPath, backlinkResolved);
          rewriteCandidates.push(backlinkResolved);
        }
      }

      if (effectiveUpdateIndex) {
        const indexResolved = resolvePath(config.vaultPath, 'index.md');
        await assertSafePathAsync(config.vaultPath, indexResolved);
        rewriteCandidates.push(indexResolved);
      }

      const lockPaths = [fromResolved, toResolved, ...rewriteCandidates];

      return await withPathLocks(lockPaths, async () => {
        try {
          await fs.access(toResolved);
          return toolError({
            error: 'already_exists',
            message: `Destination already exists: ${toPath}`,
            action: 'rename',
            retryable: true,
            sideEffects: 'none',
            path: toPath,
            details: { existingPath: toPath },
            recovery: { tool: 'note', arguments: { action: 'read', path: toPath } },
            hint: 'Read the destination note, then choose a different destination path.',
          });
        } catch {
          // destination free
        }

        const sourceRaw = await readFileBounded(fromResolved, config.maxFileSize);
        const { content: sourceBody } = parseFrontmatter(sourceRaw);
        const revisionCheck = checkRevisionConcurrency({
          raw: sourceRaw,
          body: sourceBody,
          expectedRevision,
          expectedHash,
        });
        if (!revisionCheck.ok) {
          return toolError({
            error: 'hash_mismatch',
            message: revisionCheck.message,
            action: 'rename',
            retryable: true,
            sideEffects: 'none',
            path: fromPath,
            details: { check: expectedRevision ? 'revision' : 'content_hash' },
            recovery: { tool: 'note', arguments: { action: 'read', path: fromPath } },
            hint: revisionCheck.hint,
          });
        }

        let backlinksUpdated = 0;
        let indexUpdated = false;

        for (const backlinkResolved of rewriteCandidates) {
          let raw: string;
          try {
            raw = await readFileBounded(backlinkResolved, config.maxFileSize);
          } catch {
            continue;
          }
          const { data, content } = parseFrontmatter(raw);
          const rewritten = rewriteWikilinksForRename(content, fromRelative, toRelative);
          if (rewritten === content) {
            continue;
          }

          if (config.backupEnabled) {
            await backupNoteIfExists(config.vaultPath, backlinkResolved);
          }
          const body = stringifyFrontmatter(data, rewritten);
          await atomicReplaceLocked(config.vaultPath, backlinkResolved, body, config.maxFileSize);
          const rel = toRelativePath(config.vaultPath, backlinkResolved);
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
          ...(revisionCheck.warnings ? { warnings: revisionCheck.warnings } : {}),
        }, {
          action: 'rename',
          changed: true,
          paths: [...new Set([fromRelative, ...completed])],
          warnings: revisionCheck.warnings,
        });
      });
    } catch (e) {
      if (e instanceof PartialUpdateError) {
        return mapToolError(e, {
          tool: 'note',
          action: 'rename',
          path: fromPath,
          arguments: { action: 'read', path: fromPath },
        });
      }
      return mapToolError(e, {
        tool: 'note',
        action: 'rename',
        path: fromPath,
        arguments: { action: 'rename', path: fromPath, newPath: toPath },
      });
    }
  };
}
