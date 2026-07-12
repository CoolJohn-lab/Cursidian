import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parseFrontmatter, parseAliases } from './frontmatter.js';
import { clearSearchResultCache } from './search-cache.js';
import { TRASH_GLOB_IGNORE } from './trash.js';
import { buildVaultMarkdownSignature } from './vault-signature.js';
import { clearVaultSearchStateCache } from './vault-search-state.js';

export interface VaultNoteEntry {
  path: string;
  basename: string;
  title: string;
  tags: string[];
  summary: string;
  aliases: string[];
}

export type VaultIndex = Map<string, VaultNoteEntry>;

interface VaultIndexCacheEntry {
  builtAt: number;
  signature: string;
  index: VaultIndex;
}

const indexCache = new Map<string, VaultIndexCacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Clears the in-memory vault index cache (used in tests).
 */
export function clearVaultIndexCache(): void {
  indexCache.clear();
}

/**
 * Clears all search-related caches (index, file snapshot, ranked results).
 * Call after any vault mutation so search/index results stay consistent.
 */
export function clearAllSearchCaches(): void {
  indexCache.clear();
  clearVaultSearchStateCache();
  clearSearchResultCache();
}

async function listVaultMarkdownPaths(vaultPath: string): Promise<string[]> {
  return fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: [TRASH_GLOB_IGNORE],
  });
}

/**
 * Returns a cached vault index when fresh, otherwise rebuilds it.
 * Invalidates when the path/mtime/size fingerprint changes (not merely after TTL).
 */
export async function getVaultIndex(vaultPath: string): Promise<VaultIndex> {
  const currentPaths = await listVaultMarkdownPaths(vaultPath);
  const signature = await buildVaultMarkdownSignature(currentPaths);
  const cached = indexCache.get(vaultPath);

  if (
    cached &&
    Date.now() - cached.builtAt < CACHE_TTL_MS &&
    cached.signature === signature
  ) {
    return cached.index;
  }

  const index = await buildVaultIndexFromPaths(vaultPath, currentPaths);
  indexCache.set(vaultPath, { builtAt: Date.now(), signature, index });
  return index;
}

/**
 * Normalises a string for case-insensitive path/title matching.
 */
export function normaliseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\\/g, '/').replace(/\.md$/i, '');
}

/**
 * Strips Obsidian heading anchors from a wikilink target.
 */
export function stripWikilinkAnchor(link: string): string {
  return link.split('#')[0]?.trim() ?? link.trim();
}

/**
 * Registers short aliases for notes under projects/<name>/<category>/<page>.
 */
function registerProjectAliases(relativePath: string, keys: Set<string>): void {
  const parts = relativePath.replace(/\.md$/i, '').split(/[/\\]/);
  if (parts[0] !== 'projects' || parts.length < 4) {
    return;
  }
  keys.add(normaliseKey(parts.slice(2).join('/')));
  keys.add(normaliseKey(parts[parts.length - 1]!));
}

/**
 * Builds a lookup index from wikilink keys to vault-relative note paths.
 */
export async function buildVaultIndex(vaultPath: string): Promise<VaultIndex> {
  const files = await listVaultMarkdownPaths(vaultPath);
  return buildVaultIndexFromPaths(vaultPath, files);
}

async function buildVaultIndexFromPaths(
  vaultPath: string,
  files: string[],
): Promise<VaultIndex> {
  const index: VaultIndex = new Map();

  for (const file of files) {
    const relativePath = path.relative(vaultPath, file).split(path.sep).join('/');
    const basename = path.basename(relativePath, '.md');
    const raw = await fs.readFile(file, 'utf-8');
    const { data } = parseFrontmatter(raw);
    const title = typeof data.title === 'string' ? data.title : basename;
    const summary = typeof data.summary === 'string' ? data.summary : '';
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLowerCase())
      : [];
    const aliases = parseAliases(data);

    const entry: VaultNoteEntry = {
      path: relativePath,
      basename,
      title,
      tags,
      summary,
      aliases,
    };

    const keys = new Set<string>([
      normaliseKey(basename),
      normaliseKey(relativePath),
      normaliseKey(title),
      normaliseKey(relativePath.replace(/\.md$/i, '')),
    ]);

    for (const alias of aliases) {
      keys.add(normaliseKey(alias));
    }

    registerProjectAliases(relativePath, keys);

    for (const key of keys) {
      if (!index.has(key)) {
        index.set(key, entry);
      }
    }
  }

  return index;
}

/**
 * Resolves a wikilink target string to a vault-relative note path when possible.
 */
export function resolveWikilinkTarget(link: string, index: VaultIndex): string | null {
  const pathOnly = stripWikilinkAnchor(link);
  const trimmed = pathOnly.trim();

  const direct = index.get(normaliseKey(trimmed));
  if (direct) {
    return direct.path;
  }

  const slug = normaliseKey(trimmed).replace(/\s+/g, '-');
  const slugHit = index.get(slug);
  if (slugHit) {
    return slugHit.path;
  }

  for (const [key, entry] of index) {
    if (key.endsWith(`/${slug}`) || key.endsWith(`/${normaliseKey(trimmed)}`)) {
      return entry.path;
    }
  }

  return null;
}
