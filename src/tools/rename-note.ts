import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertNotReadOnly } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { getVaultIndex, clearAllSearchCaches, resolveExistingNotePath } from '../lib/vault-index.js';
import { findBacklinks } from '../lib/backlinks.js';
import { rewriteWikilinksForRename } from '../lib/wikilinks.js';
import { ok, err, mapToolError } from '../types/index.js';

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
        ? await findBacklinks(config.vaultPath, fromRelative, index)
        : [];

      await fs.mkdir(path.dirname(toResolved), { recursive: true });
      await fs.rename(fromResolved, toResolved);

      let backlinksUpdated = 0;
      if (effectiveUpdateBacklinks) {
        for (const backlink of backlinksBeforeRename) {
          const backlinkNorm = backlink.path.replace(/\\/g, '/').toLowerCase();
          if (effectiveUpdateIndex && backlinkNorm === 'index.md') {
            continue;
          }
          const backlinkResolved = resolvePath(config.vaultPath, backlink.path);
          const raw = await fs.readFile(backlinkResolved, 'utf-8');
          const { data, content } = parseFrontmatter(raw);
          const rewritten = rewriteWikilinksForRename(content, fromRelative, toRelative);
          if (rewritten !== content) {
            await fs.writeFile(backlinkResolved, stringifyFrontmatter(data, rewritten), 'utf-8');
            backlinksUpdated += 1;
          }
        }
      }

      let indexUpdated = false;
      if (effectiveUpdateIndex) {
        const indexResolved = resolvePath(config.vaultPath, 'index.md');
        try {
          const raw = await fs.readFile(indexResolved, 'utf-8');
          const { data, content } = parseFrontmatter(raw);
          const rewritten = rewriteWikilinksForRename(content, fromRelative, toRelative);
          if (rewritten !== content) {
            await fs.writeFile(indexResolved, stringifyFrontmatter(data, rewritten), 'utf-8');
            indexUpdated = true;
          }
        } catch {
          // no index.md
        }
      }

      clearAllSearchCaches();

      return ok({
        from: fromRelative,
        to: toRelative,
        backlinksUpdated,
        indexUpdated,
      });
    } catch (e) {
      return mapToolError(e, { path: fromPath });
    }
  };
}
