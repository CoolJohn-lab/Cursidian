import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parseFrontmatter } from './frontmatter.js';
import { resolveOutgoingLinks } from './wikilink-resolve.js';
import { buildInboundLinkCounts } from './backlinks.js';
import { getVaultIndex, resolveWikilinkTarget, type VaultIndex } from './vault-index.js';
import { TRASH_GLOB_IGNORE } from './trash.js';
import { isHealthExcludedPath } from './operational-paths.js';

export { isHealthExcludedPath } from './operational-paths.js';

const REQUIRED_FRONTMATTER = ['title', 'category', 'tags', 'summary', 'updated'] as const;

export interface VaultHealthReport {
  generatedAt: string;
  noteCount: number;
  orphans: Array<{ path: string }>;
  brokenLinks: Array<{ path: string; raw: string }>;
  missingFrontmatter: Array<{ path: string; missing: string[] }>;
  summaryWarnings: Array<{ path: string; issue: 'missing' | 'too_long'; length?: number }>;
  indexDrift: {
    missingFromIndex: string[];
    deadIndexEntries: string[];
    summaryMismatches: Array<{ path: string; indexSummary: string; pageSummary: string }>;
  };
  stale: Array<{ path: string; updated: string; backlinkCount: number }>;
  counts: {
    orphans: number;
    brokenLinks: number;
    missingFrontmatter: number;
    summaryWarnings: number;
    indexDrift: number;
    stale: number;
  };
}

interface IndexEntryParsed {
  target: string;
  summary: string;
}

/**
 * Parses index.md body for wikilink catalog entries.
 */
export function parseIndexEntries(body: string): IndexEntryParsed[] {
  const entries: IndexEntryParsed[] = [];
  const lineRe = /^-\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*(?:—|-)\s*(.*)$/;

  for (const line of body.split('\n')) {
    const match = line.trim().match(lineRe);
    if (!match) {
      continue;
    }
    const target = match[1]!.trim();
    let summary = match[2]?.trim() ?? '';
    const tagIdx = summary.indexOf('(#');
    if (tagIdx >= 0) {
      summary = summary.slice(0, tagIdx).trim();
    }
    const parenTagIdx = summary.indexOf('( #');
    if (parenTagIdx >= 0) {
      summary = summary.slice(0, parenTagIdx).trim();
    }
    entries.push({ target, summary });
  }

  return entries;
}

function resolveIndexTarget(target: string, index: VaultIndex): string | null {
  const resolved = resolveWikilinkTarget(target, index);
  if (resolved) {
    return resolved;
  }
  const withMd = target.endsWith('.md') ? target : `${target}.md`;
  return resolveWikilinkTarget(withMd, index);
}

/**
 * Computes a structured vault health report in a single pass.
 */
export async function computeVaultHealth(
  vaultPath: string,
  staleDays = 90,
): Promise<VaultHealthReport> {
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });

  const index = await getVaultIndex(vaultPath);
  const inboundCounts = await buildInboundLinkCounts(vaultPath, index);
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const orphans: Array<{ path: string }> = [];
  const brokenLinks: Array<{ path: string; raw: string }> = [];
  const missingFrontmatter: Array<{ path: string; missing: string[] }> = [];
  const summaryWarnings: Array<{ path: string; issue: 'missing' | 'too_long'; length?: number }> = [];
  const stale: Array<{ path: string; updated: string; backlinkCount: number }> = [];
  const catalogPaths = new Set<string>();

  for (const file of files) {
    const relativePath = path.relative(vaultPath, file).split(path.sep).join('/');
    if (isHealthExcludedPath(relativePath)) {
      continue;
    }
    catalogPaths.add(relativePath);

    const raw = await fs.readFile(file, 'utf-8');
    const { data, content } = parseFrontmatter(raw);

    const missing: string[] = [];
    for (const key of REQUIRED_FRONTMATTER) {
      const val = data[key];
      if (val === undefined || val === null || val === '') {
        missing.push(key);
      } else if (key === 'tags' && (!Array.isArray(val) || val.length === 0)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      missingFrontmatter.push({ path: relativePath, missing });
    }

    const summary = typeof data.summary === 'string' ? data.summary : '';
    if (!summary) {
      summaryWarnings.push({ path: relativePath, issue: 'missing' });
    } else if (summary.length > 200) {
      summaryWarnings.push({ path: relativePath, issue: 'too_long', length: summary.length });
    }

    const outgoing = resolveOutgoingLinks(content, index);
    for (const link of outgoing) {
      if (link.resolvedPath === null) {
        brokenLinks.push({ path: relativePath, raw: link.raw });
      }
    }

    const backlinkCount = inboundCounts.get(relativePath) ?? 0;
    if (backlinkCount === 0) {
      orphans.push({ path: relativePath });
    }

    const updated = typeof data.updated === 'string' ? data.updated : '';
    if (updated && backlinkCount >= 3) {
      const updatedMs = Date.parse(updated);
      if (!Number.isNaN(updatedMs) && updatedMs < staleCutoff) {
        stale.push({ path: relativePath, updated, backlinkCount });
      }
    }
  }

  const indexDrift = {
    missingFromIndex: [] as string[],
    deadIndexEntries: [] as string[],
    summaryMismatches: [] as Array<{ path: string; indexSummary: string; pageSummary: string }>,
  };

  const indexPath = path.join(vaultPath, 'index.md');
  let indexBody = '';
  try {
    const indexRaw = await fs.readFile(indexPath, 'utf-8');
    indexBody = parseFrontmatter(indexRaw).content;
  } catch {
    indexDrift.missingFromIndex = [...catalogPaths].sort();
  }

  if (indexBody) {
    const parsed = parseIndexEntries(indexBody);
    const indexedPaths = new Set<string>();

    for (const entry of parsed) {
      const resolved = resolveIndexTarget(entry.target, index);
      if (!resolved) {
        indexDrift.deadIndexEntries.push(entry.target);
        continue;
      }
      indexedPaths.add(resolved);

      const indexEntry = [...index.values()].find((e) => e.path === resolved);
      const pageSummary = indexEntry?.summary ?? '';
      if (entry.summary && pageSummary && entry.summary !== pageSummary) {
        indexDrift.summaryMismatches.push({
          path: resolved,
          indexSummary: entry.summary,
          pageSummary,
        });
      }
    }

    for (const catalogPath of catalogPaths) {
      if (!indexedPaths.has(catalogPath)) {
        indexDrift.missingFromIndex.push(catalogPath);
      }
    }

    indexDrift.missingFromIndex.sort();
    indexDrift.deadIndexEntries.sort();
  }

  const indexDriftCount =
    indexDrift.missingFromIndex.length +
    indexDrift.deadIndexEntries.length +
    indexDrift.summaryMismatches.length;

  return {
    generatedAt: new Date().toISOString(),
    noteCount: catalogPaths.size,
    orphans,
    brokenLinks,
    missingFrontmatter,
    summaryWarnings,
    indexDrift,
    stale,
    counts: {
      orphans: orphans.length,
      brokenLinks: brokenLinks.length,
      missingFrontmatter: missingFrontmatter.length,
      summaryWarnings: summaryWarnings.length,
      indexDrift: indexDriftCount,
      stale: stale.length,
    },
  };
}

/**
 * Returns true when a note belongs in the wiki catalog (index.md).
 */
export function isCatalogNote(relativePath: string): boolean {
  return !isHealthExcludedPath(relativePath);
}

/**
 * Builds index.md body grouped by category.
 */
export async function buildIndexMarkdown(vaultPath: string): Promise<{ markdown: string; noteCount: number; categories: string[] }> {
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });

  const groups = new Map<string, Array<{ path: string; title: string; summary: string; tags: string[] }>>();

  for (const file of files) {
    const relativePath = path.relative(vaultPath, file).split(path.sep).join('/');
    if (!isCatalogNote(relativePath)) {
      continue;
    }

    const raw = await fs.readFile(file, 'utf-8');
    const { data } = parseFrontmatter(raw);
    const basename = path.basename(relativePath, '.md');
    const title = typeof data.title === 'string' ? data.title : basename;
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const category =
      typeof data.category === 'string' && data.category.trim()
        ? data.category.trim()
        : relativePath.split('/')[0]?.replace(/\.md$/, '') ?? 'uncategorized';
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((t): t is string => typeof t === 'string')
      : [];

    const linkPath = relativePath.replace(/\.md$/, '');
    const list = groups.get(category) ?? [];
    list.push({ path: linkPath, title, summary, tags });
    groups.set(category, list);
  }

  const categories = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const lines = ['# Wiki Index', ''];

  for (const category of categories) {
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    lines.push(`## ${label}`);
    const notes = groups.get(category)!.sort((a, b) => a.title.localeCompare(b.title));
    for (const note of notes) {
      const tagSuffix =
        note.tags.length > 0 ? ` ( ${note.tags.map((t) => `#${t}`).join(' ')})` : '';
      lines.push(`- [[${note.path}]] — ${note.summary}${tagSuffix}`);
    }
    lines.push('');
  }

  const noteCount = [...groups.values()].reduce((sum, g) => sum + g.length, 0);
  return { markdown: lines.join('\n').trimEnd() + '\n', noteCount, categories };
}
