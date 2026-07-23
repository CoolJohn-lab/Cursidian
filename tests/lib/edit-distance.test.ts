import { describe, it, expect } from 'vitest';
import {
  levenshtein,
  damerauLevenshtein,
  correctTokensAgainstVocabulary,
} from '../../src/lib/edit-distance.js';

describe('edit-distance', () => {
  it('computes levenshtein distance', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('kindel', 'kindle')).toBe(2);
    expect(levenshtein('jailbrake', 'jailbreak')).toBe(2);
  });

  it('treats adjacent transposition as distance 1 (OSA)', () => {
    expect(damerauLevenshtein('kindel', 'kindle')).toBe(1);
    expect(damerauLevenshtein('kindel', 'index')).toBe(2);
  });

  it('corrects tokens against vocabulary', () => {
    const vocab = new Set(['kindle', 'jailbreak', 'server', 'tunnel']);
    const result = correctTokensAgainstVocabulary(['kindel', 'jailbrake'], vocab, 2);
    expect(result.didCorrect).toBe(true);
    expect(result.corrected).toEqual(['kindle', 'jailbreak']);
  });

  it('prefers transposition match over equal-distance unrelated words', () => {
    const vocab = new Map([
      ['kindle', 1],
      ['index', 1],
    ]);
    const result = correctTokensAgainstVocabulary(['kindel'], vocab, 2);
    expect(result.corrected).toEqual(['kindle']);
    expect(result.corrections).toEqual({ kindel: 'kindle' });
  });

  it('breaks equal-distance ties by vault document frequency', () => {
    const vocab = new Map([
      ['abcx', 1],
      ['abcy', 5],
    ]);
    const result = correctTokensAgainstVocabulary(['abcd'], vocab, 2);
    expect(result.corrected).toEqual(['abcy']);
  });

  it('leaves tokens unchanged when distance and frequency both tie', () => {
    const vocab = new Map([
      ['abcx', 2],
      ['abcy', 2],
    ]);
    const result = correctTokensAgainstVocabulary(['abcd'], vocab, 2);
    expect(result.didCorrect).toBe(false);
    expect(result.corrected).toEqual(['abcd']);
  });

  it('leaves tokens unchanged when no close match', () => {
    const vocab = new Set(['abcdef']);
    const result = correctTokensAgainstVocabulary(['zzzzzz'], vocab, 1);
    expect(result.didCorrect).toBe(false);
    expect(result.corrected).toEqual(['zzzzzz']);
  });

  it('skips short tokens', () => {
    const vocab = new Set(['abcd']);
    const result = correctTokensAgainstVocabulary(['abc'], vocab, 2);
    expect(result.didCorrect).toBe(false);
  });

  it('does not correct 4-char tokens at distance 2 (note vs home)', () => {
    const vocab = new Map([
      ['home', 50],
      ['note', 10],
    ]);
    const result = correctTokensAgainstVocabulary(['note'], vocab, 2);
    expect(result.didCorrect).toBe(false);
    expect(result.corrected).toEqual(['note']);
  });

  it('still corrects longer tokens at distance 2', () => {
    const vocab = new Map([['cursidian', 5]]);
    const result = correctTokensAgainstVocabulary(['cursidan'], vocab, 2);
    expect(result.didCorrect).toBe(true);
    expect(result.corrected).toEqual(['cursidian']);
  });

  it('does not attempt correction on pathologically long token lists', () => {
    const tokens = Array.from({ length: 5000 }, (_, i) => `tok${i}`);
    const smallVocab = new Map([['hello', 1]]);
    const t0 = performance.now();
    correctTokensAgainstVocabulary(tokens, smallVocab);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
