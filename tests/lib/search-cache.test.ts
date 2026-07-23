import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSearchCacheKey,
  clearSearchResultCache,
  getCachedSearchResponse,
  setCachedSearchResponse,
} from '../../src/lib/search-cache.js';

const SIG = 'vault-signature-test';
const samplePayload = {
  query: 'ADF pipeline',
  totalMatches: 2,
  results: [
    {
      path: 'concepts/orchestration.md',
      matchCount: 3,
      snippets: [{ lineNumber: 1, line: 'ADF pipeline', match: 'ADF pipeline' }],
      relevanceScore: 100,
      matchReasons: ['title-match'],
    },
  ],
};

describe('search-cache', () => {
  beforeEach(() => {
    clearSearchResultCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearSearchResultCache();
  });

  it('buildSearchCacheKey is stable for tag order', () => {
    const keyA = buildSearchCacheKey(
      '/vault',
      SIG,
      'query',
      false,
      ['dlz', 'cdf'],
      false,
      'full',
      false,
    );
    const keyB = buildSearchCacheKey(
      '/vault',
      SIG,
      'query',
      false,
      ['cdf', 'dlz'],
      false,
      'full',
      false,
    );
    expect(keyA).toBe(keyB);
  });

  it('buildSearchCacheKey differs for verbose/format/includeOperational', () => {
    const base = buildSearchCacheKey('/vault', SIG, 'query', false);
    const verbose = buildSearchCacheKey('/vault', SIG, 'query', false, undefined, true);
    const compact = buildSearchCacheKey('/vault', SIG, 'query', false, undefined, false, 'compact');
    const operational = buildSearchCacheKey(
      '/vault',
      SIG,
      'query',
      false,
      undefined,
      false,
      'full',
      true,
    );
    expect(base).not.toBe(verbose);
    expect(base).not.toBe(compact);
    expect(base).not.toBe(operational);
  });

  it('returns null on cache miss', () => {
    expect(getCachedSearchResponse('missing')).toBeNull();
  });

  it('returns pre-serialised JSON on cache hit', () => {
    const key = buildSearchCacheKey('/vault', SIG, 'ADF pipeline', false);
    const stored = setCachedSearchResponse(key, samplePayload);
    const cached = getCachedSearchResponse(key);
    expect(cached).toBe(stored);
    expect(JSON.parse(cached!)).toEqual(samplePayload);
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    const key = buildSearchCacheKey('/vault', SIG, 'ADF pipeline', false);
    setCachedSearchResponse(key, samplePayload);
    vi.advanceTimersByTime(60_001);
    expect(getCachedSearchResponse(key)).toBeNull();
  });

  it('evicts oldest entry when max capacity is reached', () => {
    for (let i = 0; i < 129; i += 1) {
      setCachedSearchResponse(`key-${i}`, { ...samplePayload, query: `q-${i}` });
    }
    expect(getCachedSearchResponse('key-0')).toBeNull();
    expect(getCachedSearchResponse('key-128')).not.toBeNull();
  });
});
