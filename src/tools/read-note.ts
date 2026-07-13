import fs from 'node:fs/promises';
import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { readFileBounded } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { computeContentHash, computeRevisionHash } from '../lib/content-hash.js';
import { getVaultIndex, resolveExistingNotePath } from '../lib/vault-index.js';
import { resolveOutgoingLinks } from '../lib/wikilink-resolve.js';
import { ok, mapToolError } from '../types/index.js';

export function readNoteHandler(config: Config) {
  return async ({ path: notePath }: { path: string }) => {
    try {
      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);

      const raw = await readFileBounded(resolved, config.maxFileSize);
      const stat = await fs.stat(resolved);
      const { data, content } = parseFrontmatter(raw);
      const index = await getVaultIndex(config.vaultPath);
      const outgoingLinks = resolveOutgoingLinks(content, index);

      const relative = toRelativePath(config.vaultPath, resolved);
      return ok({
        path: relative,
        frontmatter: data,
        content,
        contentHash: computeContentHash(content),
        revisionHash: computeRevisionHash(raw),
        outgoingLinks,
        metadata: {
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        },
      }, { action: 'read', changed: false, paths: [relative] });
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'read',
        path: notePath,
        arguments: { action: 'read', path: notePath },
      });
    }
  };
}
