import { MAX_CORRECTION_TOKENS, MAX_TOKEN_LEN, MAX_TYPO_VOCAB_SIZE } from './limits.js';

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[n]!;
}

/**
 * Optimal string alignment (restricted Damerau-Levenshtein):
 * insert / delete / substitute cost 1; adjacent transposition cost 1.
 * Returns maxDistance+1 early when length delta or token length exceeds the budget.
 */
export function damerauLevenshtein(a: string, b: string, maxDistance = Infinity): number {
  if (Math.abs(a.length - b.length) > maxDistance) {
    return maxDistance + 1;
  }
  if (a.length > MAX_TOKEN_LEN || b.length > MAX_TOKEN_LEN) {
    return maxDistance + 1;
  }
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  for (let i = 0; i <= m; i += 1) {
    d[i]![0] = i;
  }
  for (let j = 0; j <= n; j += 1) {
    d[0]![j] = j;
  }

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

export interface TokenCorrectionResult {
  corrected: string[];
  didCorrect: boolean;
  corrections: Record<string, string>;
}

export type VocabularyFrequencies = Map<string, number> | Iterable<string>;

/**
 * Normalises vocabulary input to a frequency map (missing counts default to 1).
 */
function toFrequencyMap(vocabulary: VocabularyFrequencies): Map<string, number> {
  if (vocabulary instanceof Map) {
    return vocabulary;
  }
  const map = new Map<string, number>();
  for (const word of vocabulary) {
    map.set(word, (map.get(word) ?? 0) + 1);
  }
  return map;
}

/**
 * Caps edit distance for short tokens to reduce false positives (e.g. note -> home at distance 2).
 */
function maxDistanceForToken(token: string, globalMax: number): number {
  if (token.length === 4) {
    return Math.min(globalMax, 1);
  }
  return globalMax;
}

/**
 * Corrects query tokens against a vocabulary using Damerau-Levenshtein (OSA).
 * Only tokens with length >= 4 are corrected.
 * Ties at equal distance prefer higher vault doc frequency; equal frequency leaves unchanged.
 */
export function correctTokensAgainstVocabulary(
  tokens: string[],
  vocabulary: VocabularyFrequencies,
  maxDistance = 2,
): TokenCorrectionResult {
  const freqMap = toFrequencyMap(vocabulary);
  if (freqMap.size > MAX_TYPO_VOCAB_SIZE) {
    return { corrected: tokens, didCorrect: false, corrections: {} };
  }
  const capped = tokens.slice(0, MAX_CORRECTION_TOKENS);
  const corrections: Record<string, string> = {};
  const correctedHead = capped.map((token) => {
    if (token.length < 4 || token.length > MAX_TOKEN_LEN) {
      return token;
    }
    const lower = token.toLowerCase();
    const tokenMaxDistance = maxDistanceForToken(token, maxDistance);
    let bestWord: string | null = null;
    let bestDist = tokenMaxDistance + 1;
    let bestFreq = -1;
    let tied = false;

    for (const [word, freq] of freqMap) {
      const dist = damerauLevenshtein(lower, word, tokenMaxDistance);
      if (dist > tokenMaxDistance) {
        continue;
      }
      if (dist < bestDist || (dist === bestDist && freq > bestFreq)) {
        bestDist = dist;
        bestWord = word;
        bestFreq = freq;
        tied = false;
      } else if (dist === bestDist && freq === bestFreq && bestWord !== null && bestWord !== word) {
        tied = true;
      }
    }

    if (!tied && bestWord !== null && bestWord !== lower) {
      corrections[token] = bestWord;
      return bestWord;
    }
    return token;
  });

  const corrected = [...correctedHead, ...tokens.slice(MAX_CORRECTION_TOKENS)];
  const didCorrect = Object.keys(corrections).length > 0;
  return { corrected, didCorrect, corrections };
}
