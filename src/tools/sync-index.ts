import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertNotReadOnly } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { buildIndexMarkdown } from '../lib/vault-health.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { ok, mapToolError } from '../types/index.js';

const INDEX_PATH = 'index.md';

export function syncIndexHandler(config: Config) {
  return async ({ dryRun }: { dryRun?: boolean }) => {
    try {
      const effectiveDryRun = dryRun ?? false;
      const { markdown, noteCount, categories } = await buildIndexMarkdown(config.vaultPath);

      if (effectiveDryRun) {
        let wouldWrite = true;
        try {
          const existingRaw = await fs.readFile(resolvePath(config.vaultPath, INDEX_PATH), 'utf-8');
          const existingBody = parseFrontmatter(existingRaw).content.replace(/\r\n/g, '\n').trimEnd();
          const nextBody = markdown.replace(/\r\n/g, '\n').trimEnd();
          wouldWrite = existingBody !== nextBody;
        } catch {
          // index.md missing — a real sync would create it
          wouldWrite = true;
        }
        return ok({ wouldWrite, markdown, noteCount, categories });
      }

      assertNotReadOnly(config.readOnly);

      const resolved = resolvePath(config.vaultPath, INDEX_PATH);
      let existingFm: Record<string, unknown> = { title: 'Wiki Index' };

      try {
        const raw = await fs.readFile(resolved, 'utf-8');
        existingFm = parseFrontmatter(raw).data;
      } catch {
        // index.md will be created
      }

      const frontmatter = withUpdatedTimestamp({ ...existingFm, title: 'Wiki Index' });
      const body = stringifyFrontmatter(frontmatter, markdown);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, body, 'utf-8');

      clearAllSearchCaches();

      return ok({
        updated: toRelativePath(config.vaultPath, resolved),
        noteCount,
        categories,
      });
    } catch (e) {
      return mapToolError(e);
    }
  };
}
