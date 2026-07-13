import path from 'node:path';
import { extractWikilinks } from './wikilinks.js';
import { listVaultMarkdownPaths } from './vault-glob.js';
import { readFileBounded } from './security.js';
import { resolveWikilinkTarget, type VaultIndex } from './vault-index.js';
import type { BacklinkResult } from '../types/index.js';

interface BacklinkCacheEntry {
  signature: string;
  byTarget: Map<string, BacklinkResult[]>;
}

const backlinkCache = new Map<string, BacklinkCacheEntry>();

export function clearBacklinkCache(): void {
  backlinkCache.clear();
}

async function buildBacklinkMap(
  vaultPath: string,
  index: VaultIndex,
  maxFileSize: number,
): Promise<Map<string, BacklinkResult[]>> {
  const files = await listVaultMarkdownPaths(vaultPath);
  const byTarget = new Map<string, Map<string, BacklinkResult>>();

  for (const file of files) {
    const sourcePath = path.relative(vaultPath, file).split(path.sep).join('/');

    let content: string;
    try {
      content = await readFileBounded(file, maxFileSize);
    } catch {
      continue;
    }

    const links = extractWikilinks(content);
    for (const link of links) {
      const resolved = resolveWikilinkTarget(link, index);
      if (!resolved) {
        continue;
      }

      let perSource = byTarget.get(resolved);
      if (!perSource) {
        perSource = new Map<string, BacklinkResult>();
        byTarget.set(resolved, perSource);
      }

      let entry = perSource.get(sourcePath);
      if (!entry) {
        entry = { path: sourcePath, wikilinks: [] };
        perSource.set(sourcePath, entry);
      }
      if (!entry.wikilinks.includes(link)) {
        entry.wikilinks.push(link);
      }
    }
  }

  const result = new Map<string, BacklinkResult[]>();
  for (const [target, perSource] of byTarget) {
    const backlinks = [...perSource.values()].sort((a, b) => a.path.localeCompare(b.path));
    result.set(target, backlinks);
  }
  return result;
}

/**
 * Returns backlinks for a target note from a vault-signature-bound cache.
 */
export async function getCachedBacklinks(
  vaultPath: string,
  targetRelativePath: string,
  index: VaultIndex,
  maxFileSize: number,
  signature: string,
): Promise<BacklinkResult[]> {
  let entry = backlinkCache.get(vaultPath);
  if (!entry || entry.signature !== signature) {
    const byTarget = await buildBacklinkMap(vaultPath, index, maxFileSize);
    entry = { signature, byTarget };
    backlinkCache.set(vaultPath, entry);
  }
  return entry.byTarget.get(targetRelativePath) ?? [];
}
