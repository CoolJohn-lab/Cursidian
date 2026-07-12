import { stemmer } from 'stemmer';

/**
 * Common English function words stripped before token-AND search.
 * Agents often pass natural-language questions; without this, AND matching returns empty.
 */
export const SEARCH_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'how',
  'what',
  'where',
  'why',
  'who',
  'which',
  'whom',
  'whose',
  'do',
  'does',
  'did',
  'doing',
  'done',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'our',
  'you',
  'your',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'as',
  'into',
  'onto',
  'over',
  'under',
  'about',
  'against',
  'between',
  'without',
  'within',
  'through',
  'during',
  'before',
  'after',
  'can',
  'could',
  'should',
  'would',
  'will',
  'shall',
  'may',
  'might',
  'must',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'not',
  'no',
  'nor',
  'so',
  'than',
  'too',
  'very',
  'just',
  'also',
  'only',
  'own',
  'same',
  'such',
  'any',
  'all',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'up',
  'out',
  'off',
  'down',
  'again',
  'further',
  'once',
  'here',
  'there',
  'both',
  'either',
  'neither',
]);

export interface PreparedSearchTokens {
  /** Original whitespace-split tokens. */
  rawTokens: string[];
  /** Tokens used for matching (stopwords removed when any content tokens remain). */
  contentTokens: string[];
  /** True when at least one stopword was removed. */
  strippedStopwords: boolean;
}

/**
 * Splits a query into non-empty whitespace tokens.
 */
export function tokeniseRawQuery(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/**
 * Removes search stopwords from a token list.
 */
export function stripSearchStopwords(tokens: string[]): string[] {
  return tokens.filter((token) => !SEARCH_STOPWORDS.has(token.toLowerCase()));
}

/**
 * Prepares query tokens for vault search: strip stopwords.
 * When the query is only stopwords, contentTokens is empty and strippedStopwords is true
 * so callers can reject with invalid_query.
 */
export function prepareSearchTokens(query: string): PreparedSearchTokens {
  const rawTokens = tokeniseRawQuery(query);
  const stripped = stripSearchStopwords(rawTokens);
  if (stripped.length === 0) {
    return {
      rawTokens,
      contentTokens: [],
      strippedStopwords: rawTokens.length > 0,
    };
  }
  return {
    rawTokens,
    contentTokens: stripped,
    strippedStopwords: stripped.length < rawTokens.length,
  };
}

/**
 * Minimum token hits required for OR fallback (at least 2, or half rounded up).
 */
export function minOrMatchCount(tokenCount: number): number {
  if (tokenCount <= 1) {
    return tokenCount;
  }
  return Math.max(2, Math.ceil(tokenCount / 2));
}

/**
 * Counts how many query tokens match in the provided text.
 */
export function countMatchingTokens(tokens: string[], text: string, caseSensitive: boolean): number {
  return tokens.filter((token) => tokenMatchesInText(token, text, caseSensitive)).length;
}

/**
 * Returns the Porter stem of a token (lowercase).
 * Used as the semantic group key so inflectional variants share one identity
 * without a hand-maintained synonym list.
 */
export function stemToken(token: string): string {
  return stemmer(token.toLowerCase());
}

/**
 * Stem group key for ranking dedupe — the Porter stem.
 */
export function stemGroupKey(token: string): string {
  return stemToken(token);
}

/**
 * Returns true when two tokens match via stem equality or natural substring overlap.
 * Substring overlap covers cases Porter splits oddly (deploy vs deployment → deploi/deploy).
 */
export function tokensMorphologicallyMatch(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) {
    return true;
  }
  if (stemToken(left) === stemToken(right)) {
    return true;
  }
  // Query → text only: query token is a prefix of the longer vault word (deploy → deployment).
  // Bidirectional overlap falsely matches wikilink ↔ wiki.
  if (left.length >= 4 && left.length <= right.length && right.startsWith(left)) {
    return true;
  }
  return false;
}

/**
 * Expands a token for matching: original form plus Porter stem.
 * Prefer tokensMorphologicallyMatch / tokenMatchesInText for comparisons —
 * stems like "holidai" are not useful as raw substrings in vault text.
 */
export function expandSearchToken(token: string): string[] {
  const lower = token.toLowerCase();
  const stem = stemToken(lower);
  return stem === lower ? [lower] : [lower, stem];
}

/**
 * Splits text into alphanumeric word tokens for stem comparison.
 */
function wordsInText(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/gi) ?? [];
}

/**
 * Returns true when a token matches any word in the text (stem or substring).
 */
export function tokenMatchesInText(token: string, text: string, caseSensitive: boolean): boolean {
  if (caseSensitive) {
    return text.includes(token);
  }

  const haystack = text.toLowerCase();
  const needle = token.toLowerCase();
  if (haystack.includes(needle)) {
    return true;
  }

  return wordsInText(haystack).some((word) => tokensMorphologicallyMatch(needle, word));
}

/**
 * Returns true when every query token matches in the provided text.
 */
export function allTokensMatchInText(tokens: string[], text: string, caseSensitive: boolean): boolean {
  return tokens.every((token) => tokenMatchesInText(token, text, caseSensitive));
}
