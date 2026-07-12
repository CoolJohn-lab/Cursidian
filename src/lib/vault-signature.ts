import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Builds a fingerprint of the vault markdown set from path, mtime, size, and
 * a partial content hash so same-size edits with preserved mtimes still invalidate.
 */
export async function buildVaultMarkdownSignature(absolutePaths: string[]): Promise<string> {
  const sorted = [...absolutePaths].sort();
  const parts: string[] = [];
  for (const absolute of sorted) {
    const stats = await fs.stat(absolute);
    let contentHash = '';
    if (stats.size > 0) {
      const handle = await fs.open(absolute, 'r');
      try {
        const sampleLen = Math.min(stats.size, 4096);
        const buf = Buffer.alloc(sampleLen);
        await handle.read(buf, 0, sampleLen, 0);
        contentHash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
      } finally {
        await handle.close();
      }
    }
    parts.push(`${absolute}\0${stats.mtimeMs}\0${stats.size}\0${contentHash}`);
  }
  return parts.join('\n');
}
