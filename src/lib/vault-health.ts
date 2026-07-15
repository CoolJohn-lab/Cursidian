import path from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { resolveOutgoingLinks } from './wikilink-resolve.js';
import { buildInboundLinkCounts } from './backlinks.js';
import { getVaultIndex, resolveWikilinkTarget, getIndexKeyCollisions, type VaultIndex } from './vault-index.js';
import { listVaultMarkdownPaths } from './vault-glob.js';
import { readFileBounded } from './security.js';
import { isHealthExcludedPath } from './operational-paths.js';

export { isHealthExcludedPath } from './operational-paths.js';

const REQUIRED_FRONTMATTER = ['title', 'category', 'tags', 'summary', 'updated'] as const;

/** Matches `> Contradicts [[other-page]]` callouts. Mirrors `CONTRADICTS_RE` in context-assembler.ts. */
const CONTRADICTS_RE = /^>\s*Contradicts\s+\[\[([^\]]+)\]\]/gim;

/** Catalog line with summary: `- [[path]] - blurb` or em dash. */
const CATALOG_WITH_SUMMARY_RE =
  /^(\s*-\s*\[\[)([^\]|]+)(\|[^\]]+)?(\]\])(\s*(?:\u2014|-)\s*)(.*)$/;

/** Link-only catalog line: `- [[path]]` (optional alias). */
const CATALOG_LINK_ONLY_RE = /^(\s*-\s*\[\[)([^\]|]+)(\|[^\]]+)?(\]\])(\s*)$/;

export type IndexMode = 'flat' | 'hub';

export interface VaultHealthReport {
  generatedAt: string;
  /** Index policy from index.md frontmatter (`indexMode`); default `flat`. */
  indexMode: IndexMode;
  noteCount: number;
  orphans: Array<{ path: string }>;
  brokenLinks: Array<{ path: string; raw: string }>;
  missingFrontmatter: Array<{ path: string; missing: string[] }>;
  summaryWarnings: Array<{ path: string; issue: 'missing' | 'too_long'; length?: number }>;
  indexDrift: {
    /**
     * Flat mode: every catalog note absent from index.md.
     * Hub mode: catalog notes neither listed on index.md nor linked from a listed hub.
     */
    missingFromIndex: string[];
    deadIndexEntries: string[];
    summaryMismatches: Array<{ path: string; indexSummary: string; pageSummary: string }>;
  };
  /** Title/alias/basename keys claimed by more than one note. */
  ambiguousKeys: Array<{ key: string; paths: string[] }>;
  stale: Array<{ path: string; updated: string; backlinkCount: number }>;
  /**
   * `> Contradicts [[other-page]]` callouts found in note bodies. Detection only -
   * never auto-resolved. `counterpart` is the resolved path when the target links
   * to a known note, otherwise the raw wikilink target.
   */
  contradictions: Array<{ path: string; counterpart: string; resolved: boolean }>;
  counts: {
    orphans: number;
    brokenLinks: number;
    missingFrontmatter: number;
    summaryWarnings: number;
    indexDrift: number;
    ambiguousKeys: number;
    stale: number;
    skipped: number;
    contradictions: number;
  };
  incomplete: boolean;
  skipped: Array<{ path: string; reason: string }>;
}

export interface IndexEntryParsed {
  target: string;
  summary: string;
}

export interface IndexSyncResult {
  markdown: string;
  noteCount: number;
  categories: string[];
  indexMode: IndexMode;
}

/**
 * Reads `indexMode` from index frontmatter. Unknown / missing => `flat`.
 */
export function parseIndexMode(data: Record<string, unknown>): IndexMode {
  const raw = data.indexMode;
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'hub') {
    return 'hub';
  }
  return 'flat';
}

function stripTagSuffix(summary: string): string {
  let cleaned = summary;
  const tagIdx = cleaned.indexOf('(#');
  if (tagIdx >= 0) {
    cleaned = cleaned.slice(0, tagIdx).trim();
  }
  const parenTagIdx = cleaned.indexOf('( #');
  if (parenTagIdx >= 0) {
    cleaned = cleaned.slice(0, parenTagIdx).trim();
  }
  return cleaned;
}

/**
 * Parses index.md body for wikilink catalog entries (with or without summary).
 */
export function parseIndexEntries(body: string): IndexEntryParsed[] {
  const entries: IndexEntryParsed[] = [];

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const withSummary = trimmed.match(CATALOG_WITH_SUMMARY_RE);
    if (withSummary) {
      entries.push({
        target: withSummary[2]!.trim(),
        summary: stripTagSuffix(withSummary[6]?.trim() ?? ''),
      });
      continue;
    }
    const linkOnly = trimmed.match(CATALOG_LINK_ONLY_RE);
    if (linkOnly) {
      entries.push({
        target: linkOnly[2]!.trim(),
        summary: '',
      });
    }
  }

  return entries;
}

export function resolveIndexTarget(target: string, index: VaultIndex): string | null {
  const resolved = resolveWikilinkTarget(target, index);
  if (resolved) {
    return resolved;
  }
  const withMd = target.endsWith('.md') ? target : `${target}.md`;
  return resolveWikilinkTarget(withMd, index);
}

/**
 * Hub mode: preserve curated structure. Catalog lines (including short blurbs and
 * em-dash separators) stay as written; dead targets keep their original text.
 * Flat rebuild is never used here.
 */
export async function refreshIndexMarkdown(
  vaultPath: string,
  existingBody: string,
  _maxFileSize = 10_485_760,
): Promise<{ markdown: string; noteCount: number; categories: string[] }> {
  const vaultIndex = await getVaultIndex(vaultPath);
  const categoriesSet = new Set<string>();
  let noteCount = 0;
  const lines = existingBody.replace(/\r\n/g, '\n').split('\n');

  for (const line of lines) {
    const withSummary = line.match(CATALOG_WITH_SUMMARY_RE);
    const linkOnly = !withSummary ? line.match(CATALOG_LINK_ONLY_RE) : null;
    const match = withSummary ?? linkOnly;
    if (!match) {
      continue;
    }
    noteCount += 1;
    const target = match[2]!.trim();
    const resolved = resolveIndexTarget(target, vaultIndex);
    if (resolved) {
      const cat = resolved.split('/')[0]?.replace(/\.md$/, '') ?? 'uncategorized';
      categoriesSet.add(cat);
    }
  }

  let markdown = lines.join('\n');
  if (!markdown.endsWith('\n')) {
    markdown += '\n';
  }
  return {
    markdown,
    noteCount,
    categories: [...categoriesSet].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Resolves the next index.md body for sync_index / deslop according to vault indexMode.
 */
export async function buildIndexSyncPayload(
  vaultPath: string,
  maxFileSize = 10_485_760,
): Promise<IndexSyncResult> {
  const indexPath = path.join(vaultPath, 'index.md');
  let indexMode: IndexMode = 'flat';
  let existingBody = '';

  try {
    const raw = await readFileBounded(indexPath, maxFileSize);
    const parsed = parseFrontmatter(raw);
    indexMode = parseIndexMode(parsed.data);
    existingBody = parsed.content;
  } catch {
    // Missing index => flat rebuild creates it
    indexMode = 'flat';
  }

  if (indexMode === 'hub' && existingBody.trim()) {
    const refreshed = await refreshIndexMarkdown(vaultPath, existingBody, maxFileSize);
    return { ...refreshed, indexMode };
  }

  const flat = await buildIndexMarkdown(vaultPath, maxFileSize);
  return { ...flat, indexMode: indexMode === 'hub' ? 'hub' : 'flat' };
}

/**
 * Computes a structured vault health report in a single pass.
 */
export async function computeVaultHealth(
  vaultPath: string,
  staleDays = 90,
  maxFileSize = 10_485_760,
): Promise<VaultHealthReport> {
  const files = await listVaultMarkdownPaths(vaultPath);

  const index = await getVaultIndex(vaultPath);
  const inboundCounts = await buildInboundLinkCounts(vaultPath, index, maxFileSize);
  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  const orphans: Array<{ path: string }> = [];
  const brokenLinks: Array<{ path: string; raw: string }> = [];
  const missingFrontmatter: Array<{ path: string; missing: string[] }> = [];
  const summaryWarnings: Array<{ path: string; issue: 'missing' | 'too_long'; length?: number }> = [];
  const stale: Array<{ path: string; updated: string; backlinkCount: number }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const contradictions: Array<{ path: string; counterpart: string; resolved: boolean }> = [];
  const catalogPaths = new Set<string>();
  const bodyByPath = new Map<string, string>();

  for (const file of files) {
    const relativePath = path.relative(vaultPath, file).split(path.sep).join('/');
    if (isHealthExcludedPath(relativePath)) {
      continue;
    }
    catalogPaths.add(relativePath);

    let raw: string;
    try {
      raw = await readFileBounded(file, maxFileSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      skipped.push({ path: relativePath, reason: message });
      continue;
    }
    const { data, content } = parseFrontmatter(raw);
    bodyByPath.set(relativePath, content);

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

    for (const match of content.matchAll(CONTRADICTS_RE)) {
      const target = match[1]?.trim();
      if (!target) {
        continue;
      }
      const resolved = resolveWikilinkTarget(target, index);
      contradictions.push({
        path: relativePath,
        counterpart: resolved ?? target,
        resolved: resolved !== null,
      });
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

  let indexMode: IndexMode = 'flat';
  const indexPath = path.join(vaultPath, 'index.md');
  let indexBody = '';
  try {
    const indexRaw = await readFileBounded(indexPath, maxFileSize);
    const parsed = parseFrontmatter(indexRaw);
    indexMode = parseIndexMode(parsed.data);
    indexBody = parsed.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    skipped.push({ path: 'index.md', reason: message });
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

      // Hub indexes use curated short blurbs; do not require equality with page summary.
      if (indexMode === 'flat') {
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
    }

    const covered = new Set<string>(indexedPaths);

    if (indexMode === 'hub') {
      // Depth-2 outbound from index hubs: hub -> catalog page -> leaves
      // (e.g. ADO queue -> TMS suite -> individual ticket leaves).
      let frontier = [...indexedPaths];
      for (let depth = 0; depth < 2; depth += 1) {
        const next: string[] = [];
        for (const hubPath of frontier) {
          const hubBody = bodyByPath.get(hubPath);
          if (!hubBody) {
            continue;
          }
          for (const link of resolveOutgoingLinks(hubBody, index)) {
            if (link.resolvedPath && catalogPaths.has(link.resolvedPath) && !covered.has(link.resolvedPath)) {
              covered.add(link.resolvedPath);
              next.push(link.resolvedPath);
            }
          }
        }
        frontier = next;
      }
    }

    for (const catalogPath of catalogPaths) {
      if (!covered.has(catalogPath)) {
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

  const ambiguousKeys = [...getIndexKeyCollisions(index).entries()]
    .map(([key, paths]) => ({ key, paths }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    generatedAt: new Date().toISOString(),
    indexMode,
    noteCount: catalogPaths.size,
    orphans,
    brokenLinks,
    missingFrontmatter,
    summaryWarnings,
    indexDrift,
    ambiguousKeys,
    stale,
    contradictions,
    incomplete: skipped.length > 0,
    skipped,
    counts: {
      orphans: orphans.length,
      brokenLinks: brokenLinks.length,
      missingFrontmatter: missingFrontmatter.length,
      summaryWarnings: summaryWarnings.length,
      indexDrift: indexDriftCount,
      ambiguousKeys: ambiguousKeys.length,
      stale: stale.length,
      skipped: skipped.length,
      contradictions: contradictions.length,
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
 * Builds index.md body grouped by category (flat mode).
 */
export async function buildIndexMarkdown(
  vaultPath: string,
  maxFileSize = 10_485_760,
): Promise<{ markdown: string; noteCount: number; categories: string[] }> {
  const files = await listVaultMarkdownPaths(vaultPath);

  const groups = new Map<string, Array<{ path: string; title: string; summary: string; tags: string[] }>>();

  for (const file of files) {
    const relativePath = path.relative(vaultPath, file).split(path.sep).join('/');
    if (!isCatalogNote(relativePath)) {
      continue;
    }

    let raw: string;
    try {
      raw = await readFileBounded(file, maxFileSize);
    } catch {
      continue;
    }
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
      lines.push(`- [[${note.path}]] - ${note.summary}${tagSuffix}`);
    }
    lines.push('');
  }

  const noteCount = [...groups.values()].reduce((sum, g) => sum + g.length, 0);
  return { markdown: lines.join('\n').trimEnd() + '\n', noteCount, categories };
}
