import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { parseFrontmatter, parseAliases } from './frontmatter.js';
import { clearSearchResultCache } from './search-cache.js';
import { TRASH_GLOB_IGNORE } from './trash.js';
import { buildVaultMarkdownSignature } from './vault-signature.js';
import { clearVaultSearchStateCache } from './vault-search-state.js';
import { resolvePath } from './vault.js';
import { assertSafePath } from './security.js';

export interface VaultNoteEntry {
  path: string;
  basename: string;
  title: string;
  tags: string[];
  summary: string;
  aliases: string[];
}

export type VaultIndex = Map<string, VaultNoteEntry>;

/** Normalised key -> vault-relative paths that claim it (size ≥ 2 means ambiguous). */
export type VaultIndexCollisions = Map<string, string[]>;

/**
 * Thrown when a path/title/alias key matches more than one note.
 * Callers must use an unambiguous vault-relative path.
 */
export class PathResolveError extends Error {
  readonly code = 'invalid_args';
  readonly paths: string[];

  constructor(userPath: string, paths: string[]) {
    const listed = paths.join(', ');
    super(
      `Path "${userPath}" is ambiguous (matches ${paths.length} notes); use a vault-relative path. Candidates: ${listed}`,
    );
    this.name = 'PathResolveError';
    this.paths = paths;
  }
}

interface VaultIndexCacheEntry {
  builtAt: number;
  signature: string;
  index: VaultIndex;
  collisions: VaultIndexCollisions;
}

const indexCache = new Map<string, VaultIndexCacheEntry>();
/** Collisions keyed by the index Map instance returned to callers. */
const collisionsByIndex = new WeakMap<VaultIndex, VaultIndexCollisions>();
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

/**
 * Returns collision map for a vault index (empty when none / unknown).
 */
export function getIndexKeyCollisions(index: VaultIndex): VaultIndexCollisions {
  return collisionsByIndex.get(index) ?? new Map();
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

  const { index, collisions } = await buildVaultIndexFromPaths(vaultPath, currentPaths);
  collisionsByIndex.set(index, collisions);
  indexCache.set(vaultPath, { builtAt: Date.now(), signature, index, collisions });
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
  const { index, collisions } = await buildVaultIndexFromPaths(vaultPath, files);
  collisionsByIndex.set(index, collisions);
  return index;
}

async function buildVaultIndexFromPaths(
  vaultPath: string,
  files: string[],
): Promise<{ index: VaultIndex; collisions: VaultIndexCollisions }> {
  const index: VaultIndex = new Map();
  const claimants = new Map<string, Set<string>>();

  const registerKey = (key: string, entry: VaultNoteEntry): void => {
    let paths = claimants.get(key);
    if (!paths) {
      paths = new Set();
      claimants.set(key, paths);
    }
    paths.add(entry.path);
    if (!index.has(key)) {
      index.set(key, entry);
    }
  };

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
      registerKey(key, entry);
    }
  }

  const collisions: VaultIndexCollisions = new Map();
  for (const [key, paths] of claimants) {
    if (paths.size > 1) {
      collisions.set(key, [...paths].sort((a, b) => a.localeCompare(b)));
    }
  }

  return { index, collisions };
}

/**
 * Resolves a wikilink target string to a vault-relative note path when possible.
 * Returns null when unresolved or when the key is claimed by multiple notes.
 */
export function resolveWikilinkTarget(link: string, index: VaultIndex): string | null {
  const collisions = getIndexKeyCollisions(index);
  const pathOnly = stripWikilinkAnchor(link);
  const trimmed = pathOnly.trim();
  const key = normaliseKey(trimmed);

  if (collisions.has(key)) {
    return null;
  }

  const direct = index.get(key);
  if (direct) {
    return direct.path;
  }

  const slug = key.replace(/\s+/g, '-');
  if (collisions.has(slug)) {
    return null;
  }

  const slugHit = index.get(slug);
  if (slugHit) {
    return slugHit.path;
  }

  const suffixHits = new Set<string>();
  for (const [indexKey, entry] of index) {
    if (indexKey.endsWith(`/${slug}`) || indexKey.endsWith(`/${key}`)) {
      suffixHits.add(entry.path);
    }
  }
  if (suffixHits.size === 1) {
    return [...suffixHits][0]!;
  }

  return null;
}

function throwNoteNotFound(userPath: string): never {
  const err = new Error(`ENOENT: no such file or directory, open '${userPath}'`) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  throw err;
}

/**
 * Resolves a user path (vault-relative path, title, or frontmatter alias) to an
 * absolute filesystem path for an existing note. Tries the literal path first,
 * then the vault index. Throws ENOENT when nothing matches, or PathResolveError
 * when the key is claimed by multiple notes.
 */
export async function resolveExistingNotePath(
  vaultPath: string,
  userPath: string,
): Promise<string> {
  const direct = resolvePath(vaultPath, userPath);
  assertSafePath(vaultPath, direct);

  try {
    await fs.access(direct);
    return direct;
  } catch {
    // Fall through to index lookup (titles / aliases).
  }

  const index = await getVaultIndex(vaultPath);
  const collisions = getIndexKeyCollisions(index);
  const key = normaliseKey(userPath);

  if (collisions.has(key)) {
    throw new PathResolveError(userPath, collisions.get(key)!);
  }

  const entry = index.get(key);
  if (!entry) {
    throwNoteNotFound(userPath);
  }

  const resolved = resolvePath(vaultPath, entry.path);
  assertSafePath(vaultPath, resolved);

  try {
    await fs.access(resolved);
  } catch {
    throwNoteNotFound(userPath);
  }

  return resolved;
}
