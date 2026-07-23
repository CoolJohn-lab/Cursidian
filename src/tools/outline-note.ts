import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { readFileBounded } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { resolveExistingNotePath } from '../lib/vault-index.js';
import { buildNoteOutline } from '../lib/outline.js';
import { ok, mapToolError } from '../types/index.js';

export function outlineNoteHandler(config: Config) {
  return async ({ path: notePath, maxDepth }: { path: string; maxDepth?: number }) => {
    try {
      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      const raw = await readFileBounded(resolved, config.maxFileSize);
      const { content } = parseFrontmatter(raw);
      const outline = buildNoteOutline(content, { maxDepth });
      const relative = toRelativePath(config.vaultPath, resolved);

      return ok(
        {
          path: relative,
          outline,
          headingCount: outline.length,
          maxDepth: maxDepth ?? 6,
        },
        { action: 'outline', changed: false, paths: [relative] },
      );
    } catch (e) {
      return mapToolError(e, {
        tool: 'note',
        action: 'outline',
        path: notePath,
        arguments: { action: 'outline', path: notePath },
      });
    }
  };
}
