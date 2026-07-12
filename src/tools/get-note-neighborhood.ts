import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { getVaultIndex } from '../lib/vault-index.js';
import { resolveOutgoingLinks } from '../lib/wikilink-resolve.js';
import { findBacklinks } from '../lib/backlinks.js';
import { ok, mapToolError } from '../types/index.js';

export function getNoteNeighborhoodHandler(config: Config) {
  return async ({ path: notePath }: { path: string }) => {
    try {
      const resolved = resolvePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);

      const relativePath = toRelativePath(config.vaultPath, resolved);
      const raw = await fs.readFile(resolved, 'utf-8');
      const { content } = parseFrontmatter(raw);
      const index = await getVaultIndex(config.vaultPath);
      const outgoingLinks = resolveOutgoingLinks(content, index);
      const backlinks = await findBacklinks(config.vaultPath, relativePath, index);

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
