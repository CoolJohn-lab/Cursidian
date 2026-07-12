import path from 'node:path';
import { extractWikilinks } from './wikilinks.js';
import { wikilinkTargetsNote, resolveOutgoingLinks } from './wikilink-resolve.js';
import { listVaultMarkdownPaths } from './vault-glob.js';
import { readFileBounded } from './security.js';
import type { VaultIndex } from './vault-index.js';
import type { BacklinkResult } from '../types/index.js';

/**
 * Finds all notes that link to the target note via wikilinks.
 */
export async function findBacklinks(
  vaultPath: string,
  targetRelativePath: string,
  index: VaultIndex,
  maxFileSize: number,
): Promise<BacklinkResult[]> {
  const files = await listVaultMarkdownPaths(vaultPath);
  const targetResolved = path.join(vaultPath, targetRelativePath);
  const backlinks: BacklinkResult[] = [];

  for (const file of files) {
    if (file === targetResolved) {
      continue;
    }

    let content: string;
    try {
      content = await readFileBounded(file, maxFileSize);
    } catch {
      continue;
    }

    const links = extractWikilinks(content);
    const matching = links.filter((link) => wikilinkTargetsNote(link, targetRelativePath, index));

    if (matching.length > 0) {
      backlinks.push({
        path: path.relative(vaultPath, file).split(path.sep).join('/'),
        wikilinks: matching,
      });
    }
  }

  backlinks.sort((a, b) => a.path.localeCompare(b.path));
  return backlinks;
}

/**
 * Builds inbound link counts for all notes in one vault pass.
 */
export async function buildInboundLinkCounts(
  vaultPath: string,
  index: VaultIndex,
  maxFileSize: number,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const files = await listVaultMarkdownPaths(vaultPath);

  for (const file of files) {
    let content: string;
    try {
      content = await readFileBounded(file, maxFileSize);
    } catch {
      continue;
    }

    const outgoing = resolveOutgoingLinks(content, index);
    for (const link of outgoing) {
      if (link.resolvedPath) {
        counts.set(link.resolvedPath, (counts.get(link.resolvedPath) ?? 0) + 1);
      }
    }
  }

  return counts;
}
