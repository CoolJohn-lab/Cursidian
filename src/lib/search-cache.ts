import type { SearchResult, CompactSearchResult } from '../types/index.js';

export interface CachedSearchPayload {
  query: string;
  totalMatches: number;
  results: SearchResult[] | CompactSearchResult[];
  contentTokens?: string[];
  strippedStopwords?: boolean;
  fallbackMode?: 'or' | null;
  correctedTokens?: string[];
}

interface SearchCacheEntry {
  builtAt: number;
  payload: CachedSearchPayload;
}

const searchResultCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 128;

function isSearchCacheExpired(builtAt: number): boolean {
  return Date.now() - builtAt >= SEARCH_CACHE_TTL_MS;
}

function evictOldestSearchCacheEntry(): void {
  const oldestKey = searchResultCache.keys().next().value;
  if (oldestKey !== undefined) {
    searchResultCache.delete(oldestKey);
  }
}

/**
 * Builds a stable cache key for a vault search request (full ranked result set).
 */
export function buildSearchCacheKey(
  vaultPath: string,
  vaultSignature: string,
  query: string,
  caseSensitive: boolean,
  tags?: string[],
  verbose = false,
  format: 'full' | 'compact' = 'full',
  includeOperational = false,
): string {
  const tagKey = tags?.length
    ? tags
        .map((tag) => tag.toLowerCase())
        .sort()
        .join(',')
    : '';
  return `${vaultPath}\0${vaultSignature}\0${query}\0${caseSensitive}\0${tagKey}\0${verbose}\0${format}\0${includeOperational}`;
}

export function getCachedSearchPayload(key: string): CachedSearchPayload | null {
  const entry = searchResultCache.get(key);
  if (!entry) {
    return null;
  }
  if (isSearchCacheExpired(entry.builtAt)) {
    searchResultCache.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCachedSearchPayload(key: string, payload: CachedSearchPayload): void {
  if (searchResultCache.has(key)) {
    searchResultCache.delete(key);
  } else if (searchResultCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    evictOldestSearchCacheEntry();
  }
  searchResultCache.set(key, { builtAt: Date.now(), payload });
}

export function clearSearchResultCache(): void {
  searchResultCache.clear();
}

/** @deprecated Use getCachedSearchPayload; kept for transitional callers. */
export function getCachedSearchResponse(key: string): string | null {
  const payload = getCachedSearchPayload(key);
  return payload ? JSON.stringify(payload, null, 2) : null;
}

/** @deprecated Use setCachedSearchPayload; kept for transitional callers. */
export function setCachedSearchResponse(key: string, payload: CachedSearchPayload): string {
  setCachedSearchPayload(key, payload);
  return JSON.stringify(payload, null, 2);
}
