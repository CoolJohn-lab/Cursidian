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
  /** Internal: title token density 0-1 (used for focus comparisons). */
  titleDensity?: number;
}

export interface RankOptions {
  /**
   * Vocabulary-expanded tokens (lowercased) not present in the literal query -
   * see `expandQueryTokens` in `vocabulary.ts`. Scored at a reduced multiplier so a
   * literal match always outranks a page that only matches via expansion.
   */
  expandedTokens?: Set<string>;
}

interface RankContext {
  query: string;
  tokens: string[];
  caseSensitive: boolean;
  index: VaultIndex;
  expandedTokens?: Set<string>;
}

/**
 * Named, tunable scoring weights for `scoreSearchCandidate`. Grouped here instead of
 * inlined so the ranking model can be read, adjusted, and tested as one surface.
 * Values are additive score contributions unless the name says otherwise
 * (multiplier/cap/threshold/days).
 */
export interface RankWeights {
  titleExact: number;
  aliasExact: number;
  aliasTokenPerHit: number;
  titleAllTokens: number;
  titleWordMatch: number;
  titleTokenPerHit: number;
  pathAllTokens: number;
  pathTokenPerHit: number;
  compoundBasenamePerHit: number;
  compoundBasenameAllBonus: number;
  basenameTokenHit: number;
  basenamePrimaryBonus: number;
  stemAffinityPerHit: number;
  /** Multiplier applied to title-token density (0-1) for the specificity bonus. */
  titleSpecificityMultiplier: number;
  surfaceTokenPerHit: number;
  surfaceAllTokensBonus: number;
  tagsBase: number;
  tagsPerHit: number;
  summaryMatchAll: number;
  summaryTokenPerHit: number;
  tagsAllTokensNoSummary: number;
  indexSummaryMatch: number;
  headingPerHit: number;
  headingHitCap: number;
  bodySnippetCapTitleAll: number;
  bodySnippetCapTitlePartial: number;
  bodySnippetCapDefault: number;
  proximityClose: number;
  proximityMedium: number;
  proximityFar: number;
  operationalPenalty: number;
  snippetDensityPenaltyCap: number;
  hubDilutionPenaltyCap: number;
  /** Base per-hit contribution for a vocabulary-expanded (non-literal) token match. */
  expandedTokenBase: number;
  /** Multiplier applied to `expandedTokenBase` - keeps expansion hits below literal hits. */
  expandedTokenMultiplier: number;
  /** Mild boost for `lifecycle: verified` pages. */
  verifiedBoost: number;
  /** Mild penalty for pages not updated within `staleDaysDefault` days. */
  stalePenalty: number;
  /** Days since `updated` after which the stale penalty applies. */
  staleDaysDefault: number;
  /** Penalty when the only structural hit is a generic basename token (fail/error/...). */
  weakBasenamePenalty: number;
}

export const RANK_WEIGHTS: RankWeights = {
  titleExact: 120,
  aliasExact: 100,
  aliasTokenPerHit: 30,
  titleAllTokens: 110,
  titleWordMatch: 95,
  titleTokenPerHit: 35,
  pathAllTokens: 70,
  pathTokenPerHit: 30,
  compoundBasenamePerHit: 28,
  compoundBasenameAllBonus: 40,
  basenameTokenHit: 25,
  basenamePrimaryBonus: 45,
  stemAffinityPerHit: 35,
  titleSpecificityMultiplier: 50,
  surfaceTokenPerHit: 22,
  surfaceAllTokensBonus: 35,
  tagsBase: 15,
  tagsPerHit: 5,
  summaryMatchAll: 35,
  summaryTokenPerHit: 18,
  tagsAllTokensNoSummary: 28,
  indexSummaryMatch: 12,
  headingPerHit: 10,
  headingHitCap: 30,
  bodySnippetCapTitleAll: 12,
  bodySnippetCapTitlePartial: 8,
  bodySnippetCapDefault: 4,
  proximityClose: 40,
  proximityMedium: 24,
  proximityFar: 12,
  operationalPenalty: 40,
  snippetDensityPenaltyCap: 25,
  hubDilutionPenaltyCap: 30,
  expandedTokenBase: 30,
  expandedTokenMultiplier: 0.45,
  verifiedBoost: 8,
  stalePenalty: 6,
  staleDaysDefault: 90,
  /** Penalty when the only structural hit is a generic basename token (fail/error/...). */
  weakBasenamePenalty: 20,
};

/**
 * Generic troubleshoot tokens that must not alone drive basename-primary elevation.
 * A page named "failed-office-cutover" should not beat a multi-signal skills page
 * just because the query contains "failed".
 */
export const GENERIC_BASENAME_TOKENS = new Set([
  'fail',
  'failed',
  'failure',
  'error',
  'errors',
  'bug',
  'fix',
  'issue',
  'issues',
]);

/**
 * Returns the basename segment or substring that matched a query token.
 * Query -> text only: never treat a shorter basename segment as a hit for a longer query token.
 */
function basenameMatchLabel(primary: string, basenameNorm: string, segments: string[]): string {
  const exact = segments.find((seg) => seg === primary || tokensMorphologicallyMatch(primary, seg));
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

    if (
      basenameNorm.includes(tok) ||
      segments.some((seg) => tokensMorphologicallyMatch(tok, seg))
    ) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * Title token density: matched query tokens / title word count (specificity signal).
 */
function titleTokenDensity(
  title: string,
  tokens: string[],
): { hits: number; density: number; wordCount: number } {
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
    return RANK_WEIGHTS.proximityClose;
  }
  if (span <= 120) {
    return RANK_WEIGHTS.proximityMedium;
  }
  if (span <= 400) {
    return RANK_WEIGHTS.proximityFar;
  }
  return 0;
}

/**
 * Scores vocabulary-expanded token hits (title/basename/tags/summary/aliases/body)
 * at a reduced multiplier so literal matches always outrank expansion-only matches.
 * Skips any expanded token that coincides with a literal query token (already scored).
 */
function scoreExpandedTokens(
  expandedTokens: Set<string> | undefined,
  literalTokens: string[],
  surfaceText: string,
  content: string,
  caseSensitive: boolean,
): { score: number; reasons: string[] } {
  if (!expandedTokens || expandedTokens.size === 0) {
    return { score: 0, reasons: [] };
  }

  const literalSet = new Set(literalTokens.map((t) => normaliseKey(t)));
  const reasons: string[] = [];
  let score = 0;
  const perHit = Math.round(RANK_WEIGHTS.expandedTokenBase * RANK_WEIGHTS.expandedTokenMultiplier);

  for (const expandedToken of expandedTokens) {
    const tok = normaliseKey(expandedToken);
    if (!tok || literalSet.has(tok)) {
      continue;
    }
    const surfaceHit = tokenMatchesInText(expandedToken, surfaceText, false);
    const bodyHit = !surfaceHit && tokenMatchesInText(expandedToken, content, caseSensitive);
    if (surfaceHit || bodyHit) {
      score += perHit;
      reasons.push(`vocab-expand:${tok}`);
    }
  }

  return { score, reasons };
}

/**
 * Mild freshness adjustment: small boost for `lifecycle: verified`, small penalty
 * when `updated` is older than `staleDaysDefault` days. Deliberately kept small so
 * relevance signals still dominate ranking order.
 */
function scoreFreshness(data: Record<string, unknown>): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const lifecycle = typeof data.lifecycle === 'string' ? data.lifecycle : undefined;
  if (lifecycle === 'verified') {
    score += RANK_WEIGHTS.verifiedBoost;
    reasons.push('freshness-verified');
  }

  const updated = typeof data.updated === 'string' ? data.updated : undefined;
  if (updated) {
    const parsed = new Date(updated);
    if (!Number.isNaN(parsed.getTime())) {
      const staleDays = Math.floor((Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000));
      if (staleDays > RANK_WEIGHTS.staleDaysDefault) {
        score -= RANK_WEIGHTS.stalePenalty;
        reasons.push('freshness-stale');
      }
    }
  }

  return { score, reasons };
}

/** Score contribution shared by every sub-scorer below. */
interface ScoreResult {
  score: number;
  reasons: string[];
}

/**
 * Exact-identity signal: literal query equals the title, basename, or trailing path
 * segment. The strongest possible structural match.
 */
function scoreExactIdentity(
  queryNorm: string,
  titleNorm: string,
  basenameNorm: string,
  pathNorm: string,
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  if (titleNorm === queryNorm || basenameNorm === queryNorm || pathNorm.endsWith(`/${queryNorm}`)) {
    score += RANK_WEIGHTS.titleExact;
    reasons.push('title-exact');
  }

  return { score, reasons };
}

/**
 * Alias frontmatter signals: exact query-to-alias match, plus per-token alias hits.
 */
function scoreAliasSignals(
  aliases: string[],
  queryNorm: string,
  semanticTokens: string[],
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  const aliasesNorm = aliases.map((a) => normaliseKey(a));

  if (aliasesNorm.includes(queryNorm)) {
    score += RANK_WEIGHTS.aliasExact;
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
    score += aliasTokenHits * RANK_WEIGHTS.aliasTokenPerHit;
    reasons.push(`alias-tokens:${aliasTokenHits}`);
  }

  return { score, reasons };
}

interface TitleAndPathTokenResult extends ScoreResult {
  titleTokenHits: number;
  pathTokenHits: number;
}

/**
 * Title and path token coverage: rewards full-title/full-path matches above partial
 * per-token hits.
 */
function scoreTitleAndPathTokens(
  title: string,
  basename: string,
  pathNorm: string,
  titleNorm: string,
  basenameNorm: string,
  semanticTokens: string[],
): TitleAndPathTokenResult {
  const reasons: string[] = [];
  let score = 0;

  let titleTokenHits = 0;
  let pathTokenHits = 0;
  let titleWordHits = 0;
  for (const token of semanticTokens) {
    const tok = normaliseKey(token);
    if (
      titleNorm.includes(tok) ||
      splitSegments(title).some((w) => tokensMorphologicallyMatch(tok, w))
    ) {
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
    score += RANK_WEIGHTS.titleAllTokens;
    reasons.push('title-all-tokens');
  } else if (titleWordHits === semanticTokens.length && titleWordHits > 0) {
    score += RANK_WEIGHTS.titleWordMatch;
    reasons.push('title-word-match');
  } else if (titleTokenHits > 0) {
    score += titleTokenHits * RANK_WEIGHTS.titleTokenPerHit;
    reasons.push(`title-tokens:${titleTokenHits}`);
  }

  if (pathTokenHits === semanticTokens.length && pathTokenHits > 0) {
    score += RANK_WEIGHTS.pathAllTokens;
    reasons.push('path-all-tokens');
  } else if (pathTokenHits > 0) {
    score += pathTokenHits * RANK_WEIGHTS.pathTokenPerHit;
    reasons.push(`path-tokens:${pathTokenHits}`);
  }

  return { score, reasons, titleTokenHits, pathTokenHits };
}

interface CompoundBasenameResult extends ScoreResult {
  compoundHits: number;
}

/**
 * Compound-basename coverage (hyphenated basename segments covering distinct query
 * tokens) plus the single strongest basename-token hit, with a reduced, no-primary-bonus
 * path for generic troubleshoot tokens (see `GENERIC_BASENAME_TOKENS`) that aren't backed
 * by any other surface signal.
 */
function scoreCompoundBasename(
  basename: string,
  basenameNorm: string,
  title: string,
  titleNorm: string,
  summary: string,
  tags: string[],
  queryTokens: string[],
  semanticTokens: string[],
): CompoundBasenameResult {
  const reasons: string[] = [];
  let score = 0;

  // Compound basename: reward pages whose hyphenated name covers distinct query tokens.
  const compoundHits = compoundBasenameCoverage(basename, queryTokens);
  if (compoundHits > 0) {
    score += compoundHits * RANK_WEIGHTS.compoundBasenamePerHit;
    if (compoundHits === semanticTokens.length && semanticTokens.length >= 2) {
      score += RANK_WEIGHTS.compoundBasenameAllBonus;
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

    const isGeneric = GENERIC_BASENAME_TOKENS.has(primary);
    const otherSurfaceCoverage = semanticTokens.some((other) => {
      const tok = normaliseKey(other);
      if (tok === primary) {
        return false;
      }
      return (
        titleNorm.includes(tok) ||
        splitSegments(title).some((w) => tokensMorphologicallyMatch(tok, w)) ||
        (summary.length > 0 && tokenMatchesInText(other, summary, false)) ||
        tags.some(
          (tag) =>
            tokensMorphologicallyMatch(tok, tag) ||
            normaliseKey(tag)
              .split(/[-_/]/)
              .some((part) => tokensMorphologicallyMatch(tok, part)),
        )
      );
    });

    const primarySegmentHit = segments.some(
      (seg) => seg === primary || (primary.length >= 5 && seg.startsWith(primary)),
    );

    if (isGeneric && !otherSurfaceCoverage) {
      // Generic tokens alone get a reduced basename hit - no primary bonus.
      score += Math.round(RANK_WEIGHTS.basenameTokenHit * 0.4);
      reasons.push(`basename-generic:${basenameMatchLabel(primary, basenameNorm, segments)}`);
    } else {
      score += RANK_WEIGHTS.basenameTokenHit;
      reasons.push(`basename:${basenameMatchLabel(primary, basenameNorm, segments)}`);
      if (primarySegmentHit && (!isGeneric || otherSurfaceCoverage)) {
        score += RANK_WEIGHTS.basenamePrimaryBonus;
        reasons.push('basename-primary');
      }
    }
    break;
  }

  return { score, reasons, compoundHits };
}

/**
 * Stem affinity: query stem differs from surface form but matches title/basename
 * morphology (e.g. "orchestrator" query vs. "Orchestration" title).
 */
function scoreStemAffinity(title: string, basename: string, semanticTokens: string[]): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

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
    score += stemHits * RANK_WEIGHTS.stemAffinityPerHit;
    reasons.push(`stem-affinity:${stemHits}`);
  }

  return { score, reasons };
}

interface TitleSpecificityResult extends ScoreResult {
  titleDensity: number;
}

/**
 * Title specificity: high matched-token density favours focused titles over broad hubs.
 */
function scoreTitleSpecificity(title: string, semanticTokens: string[]): TitleSpecificityResult {
  const reasons: string[] = [];
  let score = 0;

  const { density: titleDensity, wordCount: titleWordCount } = titleTokenDensity(
    title,
    semanticTokens,
  );
  if (titleDensity > 0 && titleWordCount > 0) {
    const specificityBonus = Math.round(titleDensity * RANK_WEIGHTS.titleSpecificityMultiplier);
    score += specificityBonus;
    reasons.push(`title-specificity:${titleDensity.toFixed(2)}`);
  }

  return { score, reasons, titleDensity };
}

interface SurfaceCoverageResult extends ScoreResult {
  surfaceHits: number;
  surfaceText: string;
}

/**
 * Surface coverage: how many distinct semantic tokens appear anywhere across
 * title+basename+summary+tags+aliases. Also returns the combined `surfaceText`, reused by
 * `scoreExpandedTokens` for vocabulary-expansion hits.
 */
function scoreSurfaceCoverage(
  title: string,
  basename: string,
  summary: string,
  tags: string[],
  aliases: string[],
  semanticTokens: string[],
): SurfaceCoverageResult {
  const reasons: string[] = [];
  let score = 0;

  const surfaceText = [title, basename, summary, tags.join(' '), aliases.join(' ')].join(' ');
  let surfaceHits = 0;
  for (const token of semanticTokens) {
    if (tokenMatchesInText(token, surfaceText, false)) {
      surfaceHits += 1;
    }
  }
  if (surfaceHits > 0 && semanticTokens.length >= 2) {
    score += surfaceHits * RANK_WEIGHTS.surfaceTokenPerHit;
    if (surfaceHits === semanticTokens.length) {
      score += RANK_WEIGHTS.surfaceAllTokensBonus;
      reasons.push('surface-all-tokens');
    } else {
      reasons.push(`surface-tokens:${surfaceHits}`);
    }
  }

  return { score, reasons, surfaceHits, surfaceText };
}

/**
 * Generic basename-only hits without real surface focus are distractors (e.g. ticket
 * pages named "failed-..."). Reads the accumulated `reasons` so far (from the exact
 * identity through surface-coverage sub-scorers) to detect that case and apply a mild
 * penalty so multi-signal pages win.
 */
function scoreWeakBasenamePenalty(
  reasonsSoFar: string[],
  titleDensity: number,
  surfaceHits: number,
): ScoreResult {
  if (
    reasonsSoFar.some((r) => r.startsWith('basename-generic:')) &&
    !reasonsSoFar.includes('basename-primary') &&
    titleDensity < 0.15 &&
    surfaceHits <= 1
  ) {
    return { score: -RANK_WEIGHTS.weakBasenamePenalty, reasons: ['weak-basename'] };
  }
  return { score: 0, reasons: [] };
}

/**
 * Tag and summary signals: matched frontmatter tags, plus summary-match tiers (all
 * tokens / per-token hits), with an all-tokens-in-tags fallback when there is no summary.
 */
function scoreTagAndSummary(
  tags: string[],
  queryTokens: string[],
  semanticTokens: string[],
  summary: string,
  caseSensitive: boolean,
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

  const matchedTags = tags.filter((tag) =>
    queryTokens.some((token) => {
      const tagParts = normaliseKey(tag).split(/[-_/]/);
      return (
        tokensMorphologicallyMatch(token, tag) ||
        tagParts.some((part) => tokensMorphologicallyMatch(token, part))
      );
    }),
  );
  if (matchedTags.length > 0) {
    score += RANK_WEIGHTS.tagsBase + matchedTags.length * RANK_WEIGHTS.tagsPerHit;
    reasons.push(`tags:${matchedTags.slice(0, 3).join(',')}`);
  }

  if (summary && allTokensPresent(summary, queryTokens, caseSensitive)) {
    score += RANK_WEIGHTS.summaryMatchAll;
    reasons.push('summary-match');
  } else if (summary) {
    let summaryHits = 0;
    for (const token of semanticTokens) {
      if (tokenMatchesInText(token, summary, false)) {
        summaryHits += 1;
      }
    }
    if (summaryHits > 0) {
      score += summaryHits * RANK_WEIGHTS.summaryTokenPerHit;
      reasons.push(`summary-tokens:${summaryHits}`);
    }
  } else if (tags.length > 0 && allTokensPresent(tags.join(' '), queryTokens, caseSensitive)) {
    score += RANK_WEIGHTS.tagsAllTokensNoSummary;
    reasons.push('tags-all-tokens');
  }

  return { score, reasons };
}

/**
 * Body and proximity signals: heading matches, the snippet-density and hub-dilution
 * dilution penalties (skipped once the page is already a focused match), the vault-index
 * summary match, phrase proximity, and the capped body-snippet contribution.
 */
function scoreBodyAndProximity(
  candidate: SearchCandidate,
  context: RankContext,
  content: string,
  pathNorm: string,
  basenameNorm: string,
  compoundHits: number,
  titleDensity: number,
  titleTokenHits: number,
): ScoreResult {
  const reasons: string[] = [];
  let score = 0;

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
    compoundHits >= 2 || titleDensity >= 0.4 || headingHits > 0 || headingTokenHits >= 2;

  if (
    !isFocused &&
    context.tokens.length >= 3 &&
    titleTokenHits < context.tokens.length &&
    candidate.matchCount > 6
  ) {
    score -= Math.min(RANK_WEIGHTS.snippetDensityPenaltyCap, candidate.matchCount - 6);
    reasons.push('snippet-density-penalty');
  }

  // Hub dilution: low title/basename focus + many body hits -> mild penalty.
  const focusScore = Math.max(titleDensity, compoundHits / Math.max(context.tokens.length, 1));
  if (!isFocused && focusScore < 0.25 && candidate.matchCount > 8 && context.tokens.length >= 2) {
    score -= Math.min(RANK_WEIGHTS.hubDilutionPenaltyCap, candidate.matchCount - 8);
    reasons.push('hub-dilution');
  }

  const indexEntry = context.index.get(pathNorm) ?? context.index.get(basenameNorm);
  if (
    indexEntry?.summary &&
    allTokensPresent(indexEntry.summary, context.tokens, context.caseSensitive)
  ) {
    score += RANK_WEIGHTS.indexSummaryMatch;
    reasons.push('index-summary');
  }

  if (headingHits > 0) {
    score += Math.min(headingHits * RANK_WEIGHTS.headingPerHit, RANK_WEIGHTS.headingHitCap);
    reasons.push('heading-match');
  }

  const proximity = phraseProximityScore(content, context.tokens, context.caseSensitive);
  if (proximity > 0) {
    score += proximity;
    reasons.push('phrase-proximity');
  }

  const bodyCap =
    titleTokenHits === context.tokens.length
      ? RANK_WEIGHTS.bodySnippetCapTitleAll
      : titleTokenHits > 0
        ? RANK_WEIGHTS.bodySnippetCapTitlePartial
        : RANK_WEIGHTS.bodySnippetCapDefault;
  score += Math.min(candidate.matchCount, bodyCap);
  if (candidate.matchCount > 0) {
    reasons.push('body-snippets');
  }

  return { score, reasons };
}

/**
 * Operational special-file penalty: demotes hub/index-style pages (see
 * `OPERATIONAL_BASENAMES`) unless the query was an exact title/basename/path match.
 */
function scoreOperationalPenalty(basenameNorm: string, reasonsSoFar: string[]): ScoreResult {
  if (OPERATIONAL_BASENAMES.has(basenameNorm) && !reasonsSoFar.includes('title-exact')) {
    return { score: -RANK_WEIGHTS.operationalPenalty, reasons: ['operational-penalty'] };
  }
  return { score: 0, reasons: [] };
}

/**
 * Scores a search candidate using structural signals: title, basename, aliases, tags,
 * summary, proximity, hub dilution, and the operational special-file penalty.
 *
 * Thin orchestrator: parses frontmatter/derived fields once, then sums the named
 * sub-scorers above in the same order the monolithic scorer used to compute them, so
 * scores and `matchReasons` ordering are unchanged (see `tests/lib/search-ranking-golden.test.ts`).
 */
export function scoreSearchCandidate(
  candidate: SearchCandidate,
  context: RankContext,
): RankedSearchHit {
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
  const semanticTokens = uniqueSemanticTokens(context.tokens);

  const apply = (result: ScoreResult): void => {
    score += result.score;
    reasons.push(...result.reasons);
  };

  apply(scoreExactIdentity(queryNorm, titleNorm, basenameNorm, pathNorm));
  apply(scoreAliasSignals(aliases, queryNorm, semanticTokens));

  const titleAndPath = scoreTitleAndPathTokens(
    title,
    basename,
    pathNorm,
    titleNorm,
    basenameNorm,
    semanticTokens,
  );
  apply(titleAndPath);

  const compound = scoreCompoundBasename(
    basename,
    basenameNorm,
    title,
    titleNorm,
    summary,
    tags,
    context.tokens,
    semanticTokens,
  );
  apply(compound);

  apply(scoreStemAffinity(title, basename, semanticTokens));

  const specificity = scoreTitleSpecificity(title, semanticTokens);
  apply(specificity);

  const surface = scoreSurfaceCoverage(title, basename, summary, tags, aliases, semanticTokens);
  apply(surface);

  apply(scoreWeakBasenamePenalty(reasons, specificity.titleDensity, surface.surfaceHits));

  apply(scoreTagAndSummary(tags, context.tokens, semanticTokens, summary, context.caseSensitive));

  apply(
    scoreBodyAndProximity(
      candidate,
      context,
      content,
      pathNorm,
      basenameNorm,
      compound.compoundHits,
      specificity.titleDensity,
      titleAndPath.titleTokenHits,
    ),
  );

  apply(
    scoreExpandedTokens(
      context.expandedTokens,
      context.tokens,
      surface.surfaceText,
      content,
      context.caseSensitive,
    ),
  );

  apply(scoreFreshness(data));

  apply(scoreOperationalPenalty(basenameNorm, reasons));

  return {
    ...candidate,
    relevanceScore: Math.max(score, 0),
    matchReasons: reasons,
    compoundCoverage: compound.compoundHits,
    titleDensity: specificity.titleDensity,
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
  options?: RankOptions,
): RankedSearchHit[] {
  const tokens = tokeniseQuery(query);
  const context: RankContext = {
    query,
    tokens,
    caseSensitive,
    index,
    expandedTokens: options?.expandedTokens,
  };
  const ranked = candidates.map((candidate) => scoreSearchCandidate(candidate, context));

  return ranked.sort(
    (a, b) =>
      b.relevanceScore - a.relevanceScore ||
      b.matchCount - a.matchCount ||
      a.path.localeCompare(b.path),
  );
}
