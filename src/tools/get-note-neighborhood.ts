import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { readFileBounded } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { getVaultIndex, resolveExistingNotePath } from '../lib/vault-index.js';
import { resolveOutgoingLinks } from '../lib/wikilink-resolve.js';
import { findBacklinks } from '../lib/backlinks.js';
import { ok, mapToolError } from '../types/index.js';

export function getNoteNeighborhoodHandler(config: Config) {
  return async ({ path: notePath }: { path: string }) => {
    try {
      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);

      const relativePath = toRelativePath(config.vaultPath, resolved);
      const raw = await readFileBounded(resolved, config.maxFileSize);
      const { content } = parseFrontmatter(raw);
      const index = await getVaultIndex(config.vaultPath);
      const outgoingLinks = resolveOutgoingLinks(content, index);
      const backlinks = await findBacklinks(
        config.vaultPath,
        relativePath,
        index,
        config.maxFileSize,
      );

      return ok({
        note: relativePath,
        depth: 1,
        outgoingLinks,
        backlinkCount: backlinks.length,
        backlinks,
      });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
