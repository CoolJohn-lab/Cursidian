import fs from 'node:fs/promises';
import path from 'node:path';
import { type Config } from '../config.js';
import { resolvePath, toRelativePath } from '../lib/vault.js';
import { assertNotReadOnly, assertSafePathAsync, readFileBounded } from '../lib/security.js';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter.js';
import { buildIndexMarkdown } from '../lib/vault-health.js';
import { withUpdatedTimestamp } from '../lib/timestamps.js';
import { clearAllSearchCaches } from '../lib/vault-index.js';
import { atomicWrite } from '../lib/vault-io.js';
import { backupNoteIfExists } from '../lib/backup.js';
import { ok, mapToolError } from '../types/index.js';

const INDEX_PATH = 'index.md';

export function syncIndexHandler(config: Config) {
  return async ({ dryRun }: { dryRun?: boolean }) => {
    try {
      const effectiveDryRun = dryRun ?? false;
      const { markdown, noteCount, categories } = await buildIndexMarkdown(
        config.vaultPath,
        config.maxFileSize,
      );

      const resolved = resolvePath(config.vaultPath, INDEX_PATH);
      await assertSafePathAsync(config.vaultPath, resolved);

      if (effectiveDryRun) {
        let wouldWrite = true;
        try {
          const existingRaw = await readFileBounded(resolved, config.maxFileSize);
          const existingBody = parseFrontmatter(existingRaw).content.replace(/\r\n/g, '\n').trimEnd();
          const nextBody = markdown.replace(/\r\n/g, '\n').trimEnd();
          wouldWrite = existingBody !== nextBody;
        } catch {
          wouldWrite = true;
        }
        return ok({ wouldWrite, markdown, noteCount, categories });
      }

      assertNotReadOnly(config.readOnly);

      let existingFm: Record<string, unknown> = { title: 'Wiki Index' };
      try {
        const raw = await readFileBounded(resolved, config.maxFileSize);
        existingFm = parseFrontmatter(raw).data;
      } catch {
        // index.md will be created
      }

      const frontmatter = withUpdatedTimestamp({ ...existingFm, title: 'Wiki Index' });
      const body = stringifyFrontmatter(frontmatter, markdown);

      if (config.backupEnabled) {
        await backupNoteIfExists(config.vaultPath, resolved);
      }

      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await atomicWrite(config.vaultPath, resolved, body, config.maxFileSize);

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
