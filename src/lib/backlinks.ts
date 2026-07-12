import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { extractWikilinks } from './wikilinks.js';
import { wikilinkTargetsNote, resolveOutgoingLinks } from './wikilink-resolve.js';
import { TRASH_GLOB_IGNORE } from './trash.js';
import type { VaultIndex } from './vault-index.js';
import type { BacklinkResult } from '../types/index.js';

/**
 * Finds all notes that link to the target note via wikilinks.
 */
export async function findBacklinks(
  vaultPath: string,
  targetRelativePath: string,
  index: VaultIndex,
): Promise<BacklinkResult[]> {
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });

  const targetResolved = path.join(vaultPath, targetRelativePath);
  const backlinks: BacklinkResult[] = [];

  for (const file of files) {
    if (file === targetResolved) {
      continue;
    }

    const content = await fs.readFile(file, 'utf-8');
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
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const outgoing = resolveOutgoingLinks(content, index);
    for (const link of outgoing) {
      if (link.resolvedPath) {
        counts.set(link.resolvedPath, (counts.get(link.resolvedPath) ?? 0) + 1);
      }
    }
  }

  return counts;
}
