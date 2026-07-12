import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { TRASH_GLOB_IGNORE } from './trash.js';
import { buildVaultMarkdownSignature } from './vault-signature.js';

export interface VaultMarkdownFile {
  relativePath: string;
  content: string;
}

interface VaultSearchStateEntry {
  builtAt: number;
  /** Stable fingerprint of path + mtime + size so in-place edits invalidate the snapshot. */
  signature: string;
  files: VaultMarkdownFile[];
}

const vaultFileCache = new Map<string, VaultSearchStateEntry>();
const VAULT_FILE_CACHE_TTL_MS = 60_000;

/**
 * Clears cached vault markdown snapshots (used in tests and after vault writes).
 */
export function clearVaultSearchStateCache(): void {
  vaultFileCache.clear();
}

/**
 * Loads all vault markdown bodies once per TTL window to avoid repeat disk reads.
 * Invalidates when the path/mtime/size fingerprint changes (not merely file count).
 */
export async function getVaultMarkdownFiles(vaultPath: string): Promise<VaultMarkdownFile[]> {
  const currentPaths = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });

  // Fingerprint the current vault so in-place edits bust a still-TTL-fresh cache.
  const signature = await buildVaultMarkdownSignature(currentPaths);
  const cached = vaultFileCache.get(vaultPath);

  if (
    cached &&
    Date.now() - cached.builtAt < VAULT_FILE_CACHE_TTL_MS &&
    cached.signature === signature
  ) {
    return cached.files;
  }

  const files: VaultMarkdownFile[] = [];
  for (const absolute of currentPaths) {
    // Read each markdown body into the snapshot used by search_content.
    const content = await fs.readFile(absolute, 'utf-8');
    files.push({
      relativePath: path.relative(vaultPath, absolute).split(path.sep).join('/'),
      content,
    });
  }

  vaultFileCache.set(vaultPath, { builtAt: Date.now(), signature, files });
  return files;
}
