import { prepareSearchTokens } from './search-tokens.js';
import { inferIntent } from './context-assembler.js';
import type { ContextIntent } from '../types/index.js';

export interface ParsedQuery {
  /** Trimmed original query text. */
  raw: string;
  /** Stopword-stripped, hyphenation-normalised content tokens. */
  normalisedTokens: string[];
  /** Quoted phrases extracted from the query (single or double quotes), in order. */
  quotedPhrases: string[];
  /** Intent inferred from phrasing - see `inferIntent` in `context-assembler.ts`. */
  intent: ContextIntent;
}

const QUOTED_PHRASE_RE = /"([^"]+)"|'([^']+)'/g;

/**
 * Extracts quoted phrases (double or single quoted) from a query, in order of appearance.
 */
function extractQuotedPhrases(query: string): string[] {
  const phrases: string[] = [];
  for (const match of query.matchAll(QUOTED_PHRASE_RE)) {
    const phrase = (match[1] ?? match[2] ?? '').trim();
    if (phrase) {
      phrases.push(phrase);
    }
  }
  return phrases;
}

/**
 * Normalises hyphenation on a single token: strips stray leading/trailing hyphens
 * (typos, dangling punctuation) but keeps interior hyphens intact - catalog-style
 * compounds like "unity-catalog" or "ci-cd" are meaningful vault vocabulary and
 * splitting them would lose the compound match signal used by search ranking.
 */
function normaliseHyphenation(token: string): string {
  return token.replace(/^-+/, '').replace(/-+$/, '');
}

/**
 * Parses a raw query into normalised tokens, quoted phrases, and inferred intent.
 * Quoted phrases are excluded from `normalisedTokens` tokenisation (they are
 * extracted separately) but the intent classifier still sees the full raw text.
 */
export function parseQuery(query: string): ParsedQuery {
  const raw = query.trim();
  const quotedPhrases = extractQuotedPhrases(raw);
  const withoutQuotes = raw.replace(QUOTED_PHRASE_RE, ' ');
  const prepared = prepareSearchTokens(withoutQuotes);
  const normalisedTokens = prepared.contentTokens
    .map(normaliseHyphenation)
    .filter((token) => token.length > 0);
  const intent = inferIntent(raw);

  return { raw, normalisedTokens, quotedPhrases, intent };
}

export type { ContextIntent };
