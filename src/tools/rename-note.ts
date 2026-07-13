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
import { atomicReplaceLocked } from '../lib/vault-io.js';
import {
  mergeJournaledWarnings,
  runJournaledMultiFileOperation,
} from '../lib/multi-file-operation.js';
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
      const snapshotPaths = [fromResolved, toResolved, ...rewriteCandidates];

      const journaled = await runJournaledMultiFileOperation(config, {
        tool: 'note',
        action: 'rename',
        lockPaths,
        snapshotPaths,
        run: async ({ tracker, recordAfter, readRevision }) => {
          const sourceRaw = await readFileBounded(fromResolved, config.maxFileSize);
          const { content: sourceBody } = parseFrontmatter(sourceRaw);
          const revisionCheck = checkRevisionConcurrency({
            raw: sourceRaw,
            body: sourceBody,
            expectedRevision,
            expectedHash,
          });
          if (!revisionCheck.ok) {
            throw Object.assign(new Error(revisionCheck.message), {
              revisionMismatch: true,
              hint: revisionCheck.hint,
              currentRevision: revisionCheck.currentRevision,
              currentHash: revisionCheck.currentHash,
              check: revisionCheck.check,
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

            const body = stringifyFrontmatter(data, rewritten);
            await atomicReplaceLocked(config.vaultPath, backlinkResolved, body, config.maxFileSize);
            const rel = toRelativePath(config.vaultPath, backlinkResolved);
            tracker.recordWrite(rel);
            await recordAfter(rel, await readRevision(backlinkResolved));
            if (rel === 'index.md') {
              indexUpdated = true;
            } else {
              backlinksUpdated += 1;
            }
          }

          await fs.mkdir(path.dirname(toResolved), { recursive: true });
          await assertSafePathAsync(config.vaultPath, toResolved);
          await fs.rename(fromResolved, toResolved);
          tracker.recordRename(fromRelative, toRelative);
          await recordAfter(toRelative, await readRevision(toResolved));
          await recordAfter(fromRelative, null);

          return {
            from: fromRelative,
            to: toRelative,
            backlinksUpdated,
            indexUpdated,
            revisionWarnings: revisionCheck.warnings,
          };
        },
      });

      clearAllSearchCaches();

      const warnings = mergeJournaledWarnings(journaled.value.revisionWarnings, journaled);

      return ok(
        {
          from: journaled.value.from,
          to: journaled.value.to,
          backlinksUpdated: journaled.value.backlinksUpdated,
          indexUpdated: journaled.value.indexUpdated,
          ...(warnings ? { warnings } : {}),
        },
        {
          action: 'rename',
          changed: true,
          paths: [journaled.value.from, journaled.value.to],
          warnings,
          operationId: journaled.operationId,
          undoAvailable: journaled.undoAvailable,
        },
      );
    } catch (e) {
      if (
        e &&
        typeof e === 'object' &&
        'revisionMismatch' in e &&
        (e as { revisionMismatch: boolean }).revisionMismatch
      ) {
        const message = e instanceof Error ? e.message : String(e);
        const hint =
          'hint' in e && typeof (e as { hint: unknown }).hint === 'string'
            ? (e as { hint: string }).hint
            : undefined;
        return toolError({
          error: 'hash_mismatch',
          message,
          action: 'rename',
          retryable: true,
          sideEffects: 'none',
          path: fromPath,
          details: {
            conflictKind: 'revision',
            check:
              'check' in e && typeof (e as { check: unknown }).check === 'string'
                ? (e as { check: string }).check
                : expectedRevision
                  ? 'revision'
                  : 'content_hash',
            ...('currentRevision' in e && typeof (e as { currentRevision: unknown }).currentRevision === 'string'
              ? { currentRevision: (e as { currentRevision: string }).currentRevision }
              : {}),
            ...('currentHash' in e && typeof (e as { currentHash: unknown }).currentHash === 'string'
              ? { currentHash: (e as { currentHash: string }).currentHash }
              : {}),
          },
          recovery: { tool: 'note', arguments: { action: 'read', path: fromPath } },
          hint,
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
