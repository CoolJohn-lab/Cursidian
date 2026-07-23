import path from 'node:path';
import { listVaultMarkdownPaths } from './vault-glob.js';
import { buildVaultMarkdownSignature } from './vault-signature.js';
import { readFileBounded } from './security.js';
import type { VaultIndex, VaultIndexCollisions } from './vault-index.js';
import { buildVaultIndexFromPaths } from './vault-index.js';

export interface VaultMarkdownFile {
  relativePath: string;
  content: string;
}

export interface VaultSnapshot {
  signature: string;
  paths: string[];
  files: VaultMarkdownFile[];
  index: VaultIndex;
  collisions: VaultIndexCollisions;
  skipped: Array<{ path: string; reason: string }>;
}

interface SnapshotCacheEntry {
  builtAt: number;
  signature: string;
  snapshot: VaultSnapshot;
}

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const SNAPSHOT_TTL_MS = 60_000;

/**
 * Clears unified vault snapshot cache (tests and after writes).
 */
export function clearVaultSnapshotCache(): void {
  snapshotCache.clear();
}

async function loadBoundedFiles(
  vaultPath: string,
  paths: string[],
  maxFileSize: number,
): Promise<{ files: VaultMarkdownFile[]; skipped: Array<{ path: string; reason: string }> }> {
  const files: VaultMarkdownFile[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const absolute of paths) {
    const relativePath = path.relative(vaultPath, absolute).split(path.sep).join('/');
    try {
      const content = await readFileBounded(absolute, maxFileSize);
      files.push({ relativePath, content });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ path: relativePath, reason: message });
    }
  }

  return { files, skipped };
}

/**
 * Returns a unified vault snapshot (paths, bounded file bodies, index) keyed by signature.
 */
export async function getVaultSnapshot(
  vaultPath: string,
  maxFileSize: number,
): Promise<VaultSnapshot> {
  const paths = await listVaultMarkdownPaths(vaultPath);
  const signature = await buildVaultMarkdownSignature(paths);
  const cached = snapshotCache.get(vaultPath);

  if (cached && Date.now() - cached.builtAt < SNAPSHOT_TTL_MS && cached.signature === signature) {
    return cached.snapshot;
  }

  const { files, skipped } = await loadBoundedFiles(vaultPath, paths, maxFileSize);
  const readablePaths = files.map((f) =>
    path.join(vaultPath, f.relativePath.split('/').join(path.sep)),
  );
  const { index, collisions } = await buildVaultIndexFromPaths(vaultPath, readablePaths);

  const snapshot: VaultSnapshot = {
    signature,
    paths,
    files,
    index,
    collisions,
    skipped,
  };

  snapshotCache.set(vaultPath, { builtAt: Date.now(), signature, snapshot });
  return snapshot;
}

/**
 * Returns only the signature for cache keying without loading bodies.
 */
export async function getVaultSignature(vaultPath: string): Promise<string> {
  const paths = await listVaultMarkdownPaths(vaultPath);
  return buildVaultMarkdownSignature(paths);
}
