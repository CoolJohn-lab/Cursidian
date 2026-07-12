import path from 'node:path';
import { parseFrontmatter, parseAliases } from './frontmatter.js';
import {
  allTokensMatchInText,
  stemToken,
  stemGroupKey,
  tokenMatchesInText,
  tokensMorphologicallyMatch,
} from './search-tokens.js';
import { OPERATIONAL_BASENAMES } from './operational-paths.js';
import { normaliseKey, type VaultIndex } from './vault-index.js';
import type { SearchSnippet } from '../types/index.js';

export interface SearchCandidate {
  path: string;
  content: string;
  snippets: SearchSnippet[];
  matchCount: number;
}

export interface RankedSearchHit extends SearchCandidate {
  relevanceScore: number;
  matchReasons: string[];
  /** Internal: compound basename token hits (used for focus comparisons). */
  compoundCoverage?: number;
  /** Internal: title token density 0–1 (used for focus comparisons). */
  titleDensity?: number;
}

interface RankContext {
  query: string;
  tokens: string[];
  caseSensitive: boolean;
  index: VaultIndex;
}

/**
 * Returns the basename segment or substring that matched a query token.
 * Query → text only: never treat a shorter basename segment as a hit for a longer query token.
 */
function basenameMatchLabel(primary: string, basenameNorm: string, segments: string[]): string {
  const exact = segments.find(
    (seg) => seg === primary || tokensMorphologicallyMatch(primary, seg),
  );
  if (exact) {
    return exact;
  }

  if (basenameNorm.includes(primary)) {
    return primary;
  }

  const partial = segments
    .filter((seg) => seg.length >= 3 && seg.includes(primary))
    .sort((a, b) => b.length - a.length)[0];
  return partial ?? primary;
}

/**
 * Tokenises a query into non-empty search terms.
 */
export function tokeniseQuery(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/**
 * Checks whether every token appears in the provided text (stem-aware).
 */
function allTokensPresent(text: string, tokens: string[], caseSensitive: boolean): boolean {
  return allTokensMatchInText(tokens, text, caseSensitive);
}

/**
 * Splits a basename or title into normalised word segments.
 */
function splitSegments(value: string): string[] {
  return normaliseKey(value)
    .split(/[\s\-_/]+/)
    .filter(Boolean);
}

/**
 * Returns true when a query token matches a text segment (morphology or query⊆segment).
 * Never matches solely because the segment is a substring of a longer query token.
 */
function tokenMatchesSegment(token: string, segment: string): boolean {
  const tok = normaliseKey(token);
  const seg = normaliseKey(segment);
  if (tokensMorphologicallyMatch(tok, seg)) {
    return true;
  }
  if (seg.includes(tok)) {
    return true;
  }
  return false;
}

/**
 * Returns true when a query token matches any title word (stem-aware).
 */
function tokenMatchesTitleWord(token: string, titleNorm: string): boolean {
  const words = titleNorm.split(/[\s\-_/]+/).filter(Boolean);
  return words.some((word) => tokenMatchesSegment(token, word));
}

/**
 * Deduplicates query tokens that share a Porter stem.
 */
function uniqueSemanticTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokens) {
    const key = stemGroupKey(token);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(token);
  }
  return unique;
}

/**
 * Counts how many distinct stemmed query tokens hit the basename.
 */
function compoundBasenameCoverage(basename: string, tokens: string[]): number {
  const basenameNorm = normaliseKey(basename);
  const segments = splitSegments(basename);
  const semanticTokens = uniqueSemanticTokens(tokens);
  if (semanticTokens.length === 0 || !basenameNorm) {
    return 0;
  }

  let hits = 0;
  const usedSegments = new Set<number>();
  for (const token of semanticTokens) {
    const tok = normaliseKey(token);
    if (tok.length < 3) {
      continue;
    }

    const segIdx = segments.findIndex(
      (seg, i) => !usedSegments.has(i) && tokenMatchesSegment(token, seg),
    );
    if (segIdx >= 0) {
      usedSegments.add(segIdx);
      hits += 1;
      continue;
    }

    if (basenameNorm.includes(tok) || segments.some((seg) => tokensMorphologicallyMatch(tok, seg))) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Title token density: matched query tokens / title word count (specificity signal).
 */
function titleTokenDensity(title: string, tokens: string[]): { hits: number; density: number; wordCount: number } {
  const words = splitSegments(title);
  const titleNorm = normaliseKey(title);
  if (tokens.length === 0 || !titleNorm) {
    return { hits: 0, density: 0, wordCount: 0 };
  }

  let hits = 0;
  for (const token of tokens) {
    const tok = normaliseKey(token);
    if (tok.length < 3) {
      continue;
    }
    const wordHit = words.some((word) => tokenMatchesSegment(token, word));
    const substringHit = titleNorm.includes(tok);
    if (wordHit || substringHit) {
      hits += 1;
    }
  }
  const wordCount = Math.max(words.length, 1);
  return { hits, density: Math.min(1, hits / wordCount), wordCount };
}

/**
 * Scores how tightly query tokens cluster in note body text (smaller span = higher score).
 */
function phraseProximityScore(content: string, tokens: string[], caseSensitive: boolean): number {
  if (tokens.length < 2) {
    return 0;
  }

  const body = caseSensitive ? content : content.toLowerCase();
  const positions: number[] = [];

  for (const token of tokens) {
    const needle = caseSensitive ? token : token.toLowerCase();
    let idx = body.indexOf(needle);
    if (idx === -1 && !caseSensitive) {
      // Fall back to first word that morphologically matches.
      const words = body.match(/[a-z0-9]+/gi) ?? [];
      let offset = 0;
      for (const word of words) {
        const at = body.indexOf(word, offset);
        if (at !== -1 && tokensMorphologicallyMatch(needle, word)) {
          idx = at;
          break;
        }
        offset = at === -1 ? offset : at + word.length;
      }
    }
    if (idx === -1) {
      return 0;
    }
    positions.push(idx);
  }

  const span = Math.max(...positions) - Math.min(...positions);
  if (span <= 40) {
    return 40;
  }
  if (span <= 120) {
    return 24;
  }
  if (span <= 400) {
    return 12;
  }
  return 0;
}

/**
 * Scores a search candidate using structural signals: title, basename, aliases, tags,
 * summary, proximity, hub dilution, and the operational special-file penalty.
 */
export function scoreSearchCandidate(candidate: SearchCandidate, context: RankContext): RankedSearchHit {
  const { data, content } = parseFrontmatter(candidate.content);
  const basename = path.basename(candidate.path, '.md');
  const title = typeof data.title === 'string' ? data.title : basename;
  const summary = typeof data.summary === 'string' ? data.summary : '';
  const tags = Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const aliases = parseAliases(data);

  const reasons: string[] = [];
  let score = 0;
  const queryNorm = normaliseKey(context.query);
  const titleNorm = normaliseKey(title);
  const basenameNorm = normaliseKey(basename);
  const pathNorm = normaliseKey(candidate.path);

  if (titleNorm === queryNorm || basenameNorm === queryNorm || pathNorm.endsWith(`/${queryNorm}`)) {
    score += 120;
    reasons.push('title-exact');
  }

  const semanticTokens = uniqueSemanticTokens(context.tokens);

  const aliasesNorm = aliases.map((a) => normaliseKey(a));
  if (aliasesNorm.includes(queryNorm)) {
    score += 100;
    reasons.push('alias-exact');
  }

  let aliasTokenHits = 0;
  for (const token of semanticTokens) {
    const tok = normaliseKey(token);
    if (aliasesNorm.some((a) => a.includes(tok) || tokensMorphologicallyMatch(tok, a))) {
      aliasTokenHits += 1;
    }
  }
  if (aliasTokenHits > 0) {
    score += aliasTokenHits * 30;
    reasons.push(`alias-tokens:${aliasTokenHits}`);
  }

  let titleTokenHits = 0;
  let pathTokenHits = 0;
  let titleWordHits = 0;
  for (const token of semanticTokens) {
    const tok = normaliseKey(token);
    if (titleNorm.includes(tok) || splitSegments(title).some((w) => tokensMorphologicallyMatch(tok, w))) {
      titleTokenHits += 1;
    }
    if (tokenMatchesTitleWord(token, titleNorm)) {
      titleWordHits += 1;
    }
    if (
      basenameNorm.includes(tok) ||
      pathNorm.includes(tok) ||
      splitSegments(basename).some((w) => tokensMorphologicallyMatch(tok, w)) ||
      splitSegments(pathNorm).some((w) => tokensMorphologicallyMatch(tok, w))
    ) {
      pathTokenHits += 1;
    }
  }

  if (titleTokenHits === semanticTokens.length && titleTokenHits > 0) {
    score += 110;
    reasons.push('title-all-tokens');
  } else if (titleWordHits === semanticTokens.length && titleWordHits > 0) {
    score += 95;
    reasons.push('title-word-match');
  } else if (titleTokenHits > 0) {
    score += titleTokenHits * 35;
    reasons.push(`title-tokens:${titleTokenHits}`);
  }

  if (pathTokenHits === semanticTokens.length && pathTokenHits > 0) {
    score += 70;
    reasons.push('path-all-tokens');
  } else if (pathTokenHits > 0) {
    score += pathTokenHits * 30;
    reasons.push(`path-tokens:${pathTokenHits}`);
  }

  // Compound basename: reward pages whose hyphenated name covers distinct query tokens.
  const compoundHits = compoundBasenameCoverage(basename, context.tokens);
  if (compoundHits > 0) {
    score += compoundHits * 28;
    if (compoundHits === semanticTokens.length && semanticTokens.length >= 2) {
      score += 40;
      reasons.push('compound-basename-all');
    } else {
      reasons.push(`compound-basename:${compoundHits}`);
    }
  }

  for (const token of semanticTokens) {
    const primary = normaliseKey(token);
    if (token.length < 5) {
      continue;
    }
    const segments = splitSegments(basename);
    const matchingSegment = segments.find(
      (seg) =>
        seg === primary ||
        tokensMorphologicallyMatch(primary, seg) ||
        basenameNorm.includes(primary) ||
        (seg.length >= 3 && seg.includes(primary)),
    );
    const basenameHit = matchingSegment !== undefined;
    if (!basenameHit) {
      continue;
    }
    score += 25;
    reasons.push(`basename:${basenameMatchLabel(primary, basenameNorm, segments)}`);
    const primarySegmentHit = segments.some(
      (seg) => seg === primary || (primary.length >= 5 && seg.startsWith(primary)),
    );
    if (primarySegmentHit) {
      score += 45;
      reasons.push('basename-primary');
    }
    break;
  }

  // Stem affinity: query stem differs from surface form but matches title/basename morphology.
  let stemHits = 0;
  for (const token of semanticTokens) {
    const primary = normaliseKey(token);
    const stem = stemToken(primary);
    if (stem === primary) {
      continue;
    }
    const titleWords = splitSegments(title);
    const baseWords = splitSegments(basename);
    if (
      titleWords.some((w) => tokensMorphologicallyMatch(primary, w)) ||
      baseWords.some((w) => tokensMorphologicallyMatch(primary, w))
    ) {
      stemHits += 1;
    }
  }
  if (stemHits > 0) {
    score += stemHits * 35;
    reasons.push(`stem-affinity:${stemHits}`);
  }

  // Title specificity: high matched-token density favours focused titles over broad hubs.
  const { density: titleDensity, wordCount: titleWordCount } = titleTokenDensity(title, semanticTokens);
  if (titleDensity > 0 && titleWordCount > 0) {
    const specificityBonus = Math.round(titleDensity * 50);
    score += specificityBonus;
    reasons.push(`title-specificity:${titleDensity.toFixed(2)}`);
  }

  // Surface coverage: how many distinct semantic tokens appear in title+basename+summary+tags+aliases.
  const surfaceText = [title, basename, summary, tags.join(' '), aliases.join(' ')].join(' ');
  let surfaceHits = 0;
  for (const token of semanticTokens) {
    if (tokenMatchesInText(token, surfaceText, false)) {
      surfaceHits += 1;
    }
  }
  if (surfaceHits > 0 && semanticTokens.length >= 2) {
    score += surfaceHits * 22;
    if (surfaceHits === semanticTokens.length) {
      score += 35;
      reasons.push('surface-all-tokens');
    } else {
      reasons.push(`surface-tokens:${surfaceHits}`);
    }
  }

  const matchedTags = tags.filter((tag) =>
    context.tokens.some((token) => {
      const tagParts = normaliseKey(tag).split(/[-_/]/);
      return (
        tokensMorphologicallyMatch(token, tag) ||
        tagParts.some((part) => tokensMorphologicallyMatch(token, part))
      );
    }),
  );
  if (matchedTags.length > 0) {
    score += 15 + matchedTags.length * 5;
    reasons.push(`tags:${matchedTags.slice(0, 3).join(',')}`);
  }

  if (summary && allTokensPresent(summary, context.tokens, context.caseSensitive)) {
    score += 35;
    reasons.push('summary-match');
  } else if (summary) {
    let summaryHits = 0;
    for (const token of semanticTokens) {
      if (tokenMatchesInText(token, summary, false)) {
        summaryHits += 1;
      }
    }
    if (summaryHits > 0) {
      score += summaryHits * 18;
      reasons.push(`summary-tokens:${summaryHits}`);
    }
  } else if (tags.length > 0 && allTokensPresent(tags.join(' '), context.tokens, context.caseSensitive)) {
    score += 28;
    reasons.push('tags-all-tokens');
  }

  const headingLines = content.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  const headingHits = headingLines.filter((line) =>
    allTokensPresent(line, context.tokens, context.caseSensitive),
  ).length;
  let headingTokenHits = 0;
  for (const line of headingLines) {
    for (const token of context.tokens) {
      if (tokenMatchesInText(token, line, false)) {
        headingTokenHits += 1;
      }
    }
  }

  // Skip snippet-density / hub penalties when the page is already a focused match.
  const isFocused =
    compoundHits >= 2 ||
    titleDensity >= 0.4 ||
    headingHits > 0 ||
    headingTokenHits >= 2;

  if (
    !isFocused &&
    context.tokens.length >= 3 &&
    titleTokenHits < context.tokens.length &&
    candidate.matchCount > 6
  ) {
    score -= Math.min(25, candidate.matchCount - 6);
    reasons.push('snippet-density-penalty');
  }

  // Hub dilution: low title/basename focus + many body hits → mild penalty.
  const focusScore = Math.max(titleDensity, compoundHits / Math.max(context.tokens.length, 1));
  if (!isFocused && focusScore < 0.25 && candidate.matchCount > 8 && context.tokens.length >= 2) {
    score -= Math.min(30, candidate.matchCount - 8);
    reasons.push('hub-dilution');
  }

  const indexEntry = context.index.get(pathNorm) ?? context.index.get(basenameNorm);
  if (indexEntry?.summary && allTokensPresent(indexEntry.summary, context.tokens, context.caseSensitive)) {
    score += 12;
    reasons.push('index-summary');
  }

  if (headingHits > 0) {
    score += Math.min(headingHits * 10, 30);
    reasons.push('heading-match');
  }

  const proximity = phraseProximityScore(content, context.tokens, context.caseSensitive);
  if (proximity > 0) {
    score += proximity;
    reasons.push('phrase-proximity');
  }

  const bodyCap = titleTokenHits === context.tokens.length ? 12 : titleTokenHits > 0 ? 8 : 4;
  score += Math.min(candidate.matchCount, bodyCap);
  if (candidate.matchCount > 0) {
    reasons.push('body-snippets');
  }

  if (OPERATIONAL_BASENAMES.has(basenameNorm) && !reasons.includes('title-exact')) {
    score -= 40;
    reasons.push('operational-penalty');
  }

  return {
    ...candidate,
    relevanceScore: Math.max(score, 0),
    matchReasons: reasons,
    compoundCoverage: compoundHits,
    titleDensity,
  };
}

/**
 * Ranks search candidates by relevance score (highest first).
 */
export function rankSearchResults(
  candidates: SearchCandidate[],
  query: string,
  caseSensitive: boolean,
  index: VaultIndex,
): RankedSearchHit[] {
  const tokens = tokeniseQuery(query);
  const context: RankContext = { query, tokens, caseSensitive, index };
  const ranked = candidates.map((candidate) => scoreSearchCandidate(candidate, context));

  return ranked.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore ||
      b.matchCount - a.matchCount ||
      a.path.localeCompare(b.path),
  );
}
