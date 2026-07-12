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
  responseText: string;
}

const searchResultCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 128;

/**
 * Returns true when a cache entry is older than the TTL window.
 */
function isSearchCacheExpired(builtAt: number): boolean {
  return Date.now() - builtAt >= SEARCH_CACHE_TTL_MS;
}

/**
 * Serialises ranked search output once for MCP text responses.
 */
function serializeSearchPayload(payload: CachedSearchPayload): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * Evicts the oldest cache entry when at capacity.
 */
function evictOldestSearchCacheEntry(): void {
  const oldestKey = searchResultCache.keys().next().value;
  if (oldestKey !== undefined) {
    searchResultCache.delete(oldestKey);
  }
}

/**
 * Builds a stable cache key for a vault search request.
 */
export function buildSearchCacheKey(
  vaultPath: string,
  query: string,
  caseSensitive: boolean,
  limit: number,
  tags?: string[],
  verbose = false,
  format: 'full' | 'compact' = 'full',
  includeOperational = false,
): string {
  const tagKey = tags?.length ? tags.map((tag) => tag.toLowerCase()).sort().join(',') : '';
  return `${vaultPath}\0${query}\0${caseSensitive}\0${limit}\0${tagKey}\0${verbose}\0${format}\0${includeOperational}`;
}

/**
 * Returns a pre-serialised MCP response when the ranked search is still cached.
 */
export function getCachedSearchResponse(key: string): string | null {
  const entry = searchResultCache.get(key);
  if (!entry) {
    return null;
  }
  if (isSearchCacheExpired(entry.builtAt)) {
    searchResultCache.delete(key);
    return null;
  }
  return entry.responseText;
}

/**
 * Stores ranked search results and returns the serialised MCP response text.
 */
export function setCachedSearchResponse(key: string, payload: CachedSearchPayload): string {
  const responseText = serializeSearchPayload(payload);
  if (searchResultCache.has(key)) {
    searchResultCache.delete(key);
  } else if (searchResultCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    evictOldestSearchCacheEntry();
  }
  searchResultCache.set(key, { builtAt: Date.now(), responseText });
  return responseText;
}

/**
 * Clears cached search payloads (used when vault index is reset in tests).
 */
export function clearSearchResultCache(): void {
  searchResultCache.clear();
}
