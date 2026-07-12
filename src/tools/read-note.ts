import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { assertSafePathAsync, assertFileSize } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash } from '../lib/content-hash.js';
import { getVaultIndex, resolveExistingNotePath } from '../lib/vault-index.js';
import { resolveOutgoingLinks } from '../lib/wikilink-resolve.js';
import { ok, mapToolError } from '../types/index.js';

export function readNoteHandler(config: Config) {
  return async ({ path: notePath }: { path: string }) => {
    try {
      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      await assertSafePathAsync(config.vaultPath, resolved);
      await assertFileSize(resolved, config.maxFileSize);

      const raw = await fs.readFile(resolved, 'utf-8');
      const stat = await fs.stat(resolved);
      const { data, content } = parseFrontmatter(raw);
      const index = await getVaultIndex(config.vaultPath);
      const outgoingLinks = resolveOutgoingLinks(content, index);

      return ok({
        path: toRelativePath(config.vaultPath, resolved),
        frontmatter: data,
        content,
        contentHash: computeContentHash(content),
        outgoingLinks,
        metadata: {
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        },
      });
    } catch (e) {
      return mapToolError(e, { path: notePath });
    }
  };
}
