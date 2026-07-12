import fs from 'node:fs/promises';

/**
 * Builds a fingerprint of the vault markdown set from path, mtime, and size.
 */
export async function buildVaultMarkdownSignature(absolutePaths: string[]): Promise<string> {
  const sorted = [...absolutePaths].sort();
  const parts: string[] = [];
  for (const absolute of sorted) {
    // Stat each file so content edits change the signature even when file count is unchanged.
    const stats = await fs.stat(absolute);
    parts.push(`${absolute}\0${stats.mtimeMs}\0${stats.size}`);
  }
  return parts.join('\n');
}
