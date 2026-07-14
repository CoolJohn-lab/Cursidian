import { type Config } from '../config.js';
import { normaliseKey, type VaultIndex } from '../lib/vault-index.js';
import { getVaultSnapshot } from '../lib/vault-snapshot.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import {
  buildSearchCacheKey,
  getCachedSearchPayload,
  setCachedSearchPayload,
} from '../lib/search-cache.js';
import {
  allTokensMatchInText,
  countMatchingTokens,
  minOrMatchCount,
  prepareSearchTokens,
  tokenMatchesInText,
} from '../lib/search-tokens.js';
import { rankSearchResults, type SearchCandidate } from '../lib/search-ranking.js';
import { correctTokensAgainstVocabulary } from '../lib/edit-distance.js';
import { loadVocabulary, expandQueryTokens } from '../lib/vocabulary.js';
import { isOperationalPath } from '../lib/operational-paths.js';
import { uniqueIndexEntries } from '../lib/tags.js';
import { MAX_QUERY_LENGTH } from '../lib/limits.js';
import { paginateByPath, resolveCursorMarker, scanMetadataFromSkipped } from '../lib/pagination.js';
import { err, mapToolError, type SearchResult, type CompactSearchResult } from '../types/index.js';

type MatchMode = 'and' | 'or';
type SearchFormat = 'full' | 'compact';

/**
 * Builds a title/basename/tag vocabulary with per-word document frequencies for typo correction.
 * Aliases are intentionally excluded - they are ranking surfaces, not spelling authorities.
 */
function buildSearchVocabulary(index: VaultIndex): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const entry of uniqueIndexEntries(index)) {
    const seenInNote = new Set<string>();
    const sources = [entry.title, entry.basename, ...entry.tags];
    for (const source of sources) {
      for (const word of source.split(/[\s\-_/]+/)) {
        const w = word.toLowerCase();
        if (w.length >= 4) {
          seenInNote.add(w);
        }
      }
    }
    for (const w of seenInNote) {
      vocab.set(w, (vocab.get(w) ?? 0) + 1);
    }
  }
  return vocab;
}

/**
 * Returns body lines only (skips YAML frontmatter block).
 */
function bodyLines(content: string): string[] {
  if (!content.startsWith('---')) {
    return content.split('\n');
  }
  const end = content.indexOf('\n---', 3);
  if (end === -1) {
    return content.split('\n');
  }
  const bodyStart = content.indexOf('\n', end + 4);
  const body = bodyStart === -1 ? '' : content.slice(bodyStart + 1);
  return body.split('\n');
}

/**
 * Looks up index metadata for a vault-relative note path.
 */
function indexEntryForPath(index: VaultIndex, relativePath: string) {
  return index.get(normaliseKey(relativePath));
}

/**
 * Builds searchable text from note body plus index metadata (title, summary, aliases, tags).
 */
function buildSearchableText(content: string, index: VaultIndex, relativePath: string): string {
  const entry = index.get(normaliseKey(relativePath));
  const { data, content: body } = parseFrontmatter(content);
  const title = typeof data.title === 'string' ? data.title : '';
  const summary = typeof data.summary === 'string' ? data.summary : '';
  const aliases = entry?.aliases ?? [];
  const tags = entry?.tags ?? [];
  return [body, title, summary, aliases.join(' '), tags.join(' ')].join('\n');
}

/**
 * Collects search candidates for the given tokens and match mode.
 */
function collectCandidates(
  vaultFiles: Array<{ relativePath: string; content: string }>,
  tokens: string[],
  caseSensitive: boolean,
  tagFilter: string[],
  matchMode: MatchMode,
  minMatches: number,
  includeOperational: boolean,
  verbose: boolean,
  index: VaultIndex,
): SearchCandidate[] {
  const flags = caseSensitive ? 'g' : 'gi';
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const phraseRegex = tokens.length === 1 ? new RegExp(escapeRegex(tokens[0]), flags) : null;
  const candidates: SearchCandidate[] = [];

  for (const file of vaultFiles) {
    if (!includeOperational && isOperationalPath(file.relativePath)) {
      continue;
    }

    const content = file.content;
    const searchableText = buildSearchableText(content, index, file.relativePath);
    if (tagFilter.length > 0) {
      const { data } = parseFrontmatter(content);
      const noteTags = Array.isArray(data.tags)
        ? data.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => normaliseKey(tag))
        : [];
      if (!tagFilter.every((tag) => noteTags.includes(tag))) {
        continue;
      }
    }

    if (tokens.length > 1) {
      if (matchMode === 'and') {
        if (!allTokensMatchInText(tokens, searchableText, caseSensitive)) {
          continue;
        }
      } else if (countMatchingTokens(tokens, searchableText, caseSensitive) < minMatches) {
        continue;
      }
    }

    const lines = bodyLines(content);
    const snippets = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matchText = '';

      if (phraseRegex) {
        phraseRegex.lastIndex = 0;
        const match = phraseRegex.exec(line);
        if (!match) continue;
        matchText = match[0];
      } else {
        const matchingTokens = tokens.filter((token) => tokenMatchesInText(token, line, caseSensitive));
        if (matchingTokens.length === 0) continue;
        matchText = matchingTokens.join(' ');
      }

      const snippet: { lineNumber: number; line: string; match?: string } = {
        lineNumber: i + 1,
        line: line.trim(),
      };
      if (verbose) {
        snippet.match = matchText;
      }
      snippets.push(snippet);
    }

    if (tokens.length === 1 && snippets.length === 0) {
      const contentForMatch = caseSensitive ? searchableText : searchableText.toLowerCase();
      const needle = caseSensitive ? tokens[0] : tokens[0].toLowerCase();
      if (!contentForMatch.includes(needle)) {
        continue;
      }
    }

    candidates.push({
      path: file.relativePath,
      content,
      matchCount: snippets.length,
      snippets: snippets.slice(0, 2),
    });
  }

  return candidates;
}

/**
 * Maps ranked hits to the response shape for full or compact format.
 */
function mapSearchResults(
  ranked: ReturnType<typeof rankSearchResults>,
  index: VaultIndex,
  verbose: boolean,
  format: SearchFormat,
): SearchResult[] | CompactSearchResult[] {
  return ranked.map((hit) => {
    const meta = indexEntryForPath(index, hit.path);
    if (format === 'compact') {
      const compact: CompactSearchResult = {
        path: hit.path,
        title: meta?.title,
        summary: meta?.summary || undefined,
        tags: meta?.tags,
        relevanceScore: hit.relevanceScore,
      };
      return compact;
    }
    const result: SearchResult = {
      path: hit.path,
      matchCount: hit.matchCount,
      snippets: hit.snippets,
      relevanceScore: hit.relevanceScore,
      title: meta?.title,
      summary: meta?.summary || undefined,
      tags: meta?.tags,
    };
    if (verbose) {
      result.matchReasons = hit.matchReasons;
    }
    return result;
  });
}

export function searchContentHandler(config: Config) {
  return async ({
    query,
    caseSensitive,
    limit,
    tags,
    verbose,
    includeOperational,
    format,
    cursor,
  }: {
    query: string;
    caseSensitive?: boolean;
    limit?: number;
    tags?: string[];
    verbose?: boolean;
    includeOperational?: boolean;
    format?: SearchFormat;
    cursor?: string;
  }) => {
    try {
      const effectiveCaseSensitive = caseSensitive ?? false;
      const effectiveLimit = limit ?? 10;
      const effectiveVerbose = verbose ?? false;
      const effectiveIncludeOperational = includeOperational ?? false;
      const effectiveFormat = format ?? 'full';

      if (query.length > MAX_QUERY_LENGTH) {
        return err(`query exceeds ${MAX_QUERY_LENGTH} characters`, 'invalid_query');
      }

      const snapshot = await getVaultSnapshot(config.vaultPath, config.maxFileSize);
      const scan = scanMetadataFromSkipped(snapshot.skipped);
      const marker = resolveCursorMarker(cursor, snapshot.signature, {
        vaultPath: config.vaultPath,
      });

      const cacheKey = buildSearchCacheKey(
        config.vaultPath,
        snapshot.signature,
        query,
        effectiveCaseSensitive,
        tags,
        effectiveVerbose,
        effectiveFormat,
        effectiveIncludeOperational,
      );

      let basePayload = getCachedSearchPayload(cacheKey);

      if (basePayload === null) {
        const prepared = prepareSearchTokens(query);
        if (prepared.contentTokens.length === 0) {
          if (prepared.strippedStopwords) {
            return err(
              'query contains only stopwords; add at least one content keyword',
              'invalid_query',
            );
          }
          return err('query must contain at least one non-whitespace token', 'invalid_query');
        }

        let tokens = prepared.contentTokens;
        const vaultFiles = snapshot.files;
        const index = snapshot.index;
        const tagFilter = tags?.map((tag) => normaliseKey(tag)) ?? [];

        let matchMode: MatchMode = 'and';
        let candidates = collectCandidates(
          vaultFiles,
          tokens,
          effectiveCaseSensitive,
          tagFilter,
          'and',
          tokens.length,
          effectiveIncludeOperational,
          effectiveVerbose,
          index,
        );

        const shouldOrFallback =
          tokens.length >= 2 && (candidates.length === 0 || candidates.length < 3);
        if (shouldOrFallback) {
          const minMatches = minOrMatchCount(tokens.length);
          const orCandidates = collectCandidates(
            vaultFiles,
            tokens,
            effectiveCaseSensitive,
            tagFilter,
            'or',
            minMatches,
            effectiveIncludeOperational,
            effectiveVerbose,
            index,
          );
          if (orCandidates.length > candidates.length) {
            candidates = orCandidates;
            matchMode = 'or';
          }
        }

        let correctedTokens: string[] | undefined;
        if (candidates.length === 0 && !effectiveCaseSensitive) {
          const vocab = buildSearchVocabulary(index);
          const correction = correctTokensAgainstVocabulary(tokens, vocab, 2);
          if (correction.didCorrect) {
            tokens = correction.corrected;
            correctedTokens = correction.corrected;
            candidates = collectCandidates(
              vaultFiles,
              tokens,
              effectiveCaseSensitive,
              tagFilter,
              'and',
              tokens.length,
              effectiveIncludeOperational,
              effectiveVerbose,
              index,
            );
            if (candidates.length === 0 && tokens.length >= 2) {
              const minMatches = minOrMatchCount(tokens.length);
              const orCandidates = collectCandidates(
                vaultFiles,
                tokens,
                effectiveCaseSensitive,
                tagFilter,
                'or',
                minMatches,
                effectiveIncludeOperational,
                effectiveVerbose,
                index,
              );
              if (orCandidates.length > candidates.length) {
                candidates = orCandidates;
                matchMode = 'or';
              }
            }
          }
        }

        // Vocabulary expansion: OR-extra candidate discovery so a synonym/pairing (e.g.
        // "integration" -> "ingestion") finds pages the literal query would miss, without
        // weakening the literal AND/OR result set already computed above. Ranking scores
        // expansion-only hits at a reduced weight (see RANK_WEIGHTS.expandedTokenMultiplier).
        let expandedTokens: Set<string> | undefined;
        const vocabulary = await loadVocabulary(config.vaultPath, config.maxFileSize);
        const expansion = expandQueryTokens(tokens, vocabulary);
        if (expansion.expandedFrom.size > 0) {
          const expansionTokens = [...expansion.expandedFrom.keys()];
          const expansionCandidates = collectCandidates(
            vaultFiles,
            expansionTokens,
            effectiveCaseSensitive,
            tagFilter,
            'or',
            1,
            effectiveIncludeOperational,
            effectiveVerbose,
            index,
          );
          if (expansionCandidates.length > 0) {
            const existingPaths = new Set(candidates.map((c) => normaliseKey(c.path)));
            for (const candidate of expansionCandidates) {
              const key = normaliseKey(candidate.path);
              if (!existingPaths.has(key)) {
                candidates.push(candidate);
                existingPaths.add(key);
              }
            }
            expandedTokens = new Set(expansionTokens.map((t) => t.toLowerCase()));
          }
        }

        const rankingQuery = tokens.join(' ');
        const ranked = rankSearchResults(candidates, rankingQuery, effectiveCaseSensitive, index, {
          expandedTokens,
        });
        const allResults = mapSearchResults(ranked, index, effectiveVerbose, effectiveFormat);

        basePayload = {
          query,
          contentTokens: tokens,
          strippedStopwords: prepared.strippedStopwords,
          fallbackMode: matchMode === 'or' ? ('or' as const) : null,
          totalMatches: allResults.length,
          results: allResults,
          ...(correctedTokens ? { correctedTokens } : {}),
        };
        setCachedSearchPayload(cacheKey, basePayload);
      }

      const paged = paginateByPath(
        basePayload.results as Array<{ path: string }>,
        effectiveLimit,
        marker,
        snapshot.signature,
      );

      const payload = {
        ...basePayload,
        results: paged.page,
        totalMatches: paged.totalMatches,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        effectiveLimit,
        includeOperational: effectiveIncludeOperational,
        ...scan,
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    } catch (e) {
      return mapToolError(e, {
        tool: 'search',
        action: 'content',
        arguments: {
          action: 'content',
          query,
          limit: limit ?? 10,
          includeOperational: includeOperational ?? false,
        },
      });
    }
  };
}
