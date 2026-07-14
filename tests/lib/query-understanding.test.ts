import { describe, it, expect } from 'vitest';
import { parseQuery } from '../../src/lib/query-understanding.js';
import { inferIntent } from '../../src/lib/context-assembler.js';

describe('parseQuery', () => {
  it('normalises tokens and strips stopwords', () => {
    const parsed = parseQuery('how do I configure the ingestion pipeline');
    expect(parsed.normalisedTokens).toContain('configure');
    expect(parsed.normalisedTokens).toContain('ingestion');
    expect(parsed.normalisedTokens).toContain('pipeline');
    expect(parsed.normalisedTokens).not.toContain('how');
    expect(parsed.normalisedTokens).not.toContain('the');
  });

  it('extracts quoted phrases and excludes them from normalisedTokens', () => {
    const parsed = parseQuery('find "unity catalog" migration notes');
    expect(parsed.quotedPhrases).toEqual(['unity catalog']);
    expect(parsed.normalisedTokens).not.toContain('unity');
    expect(parsed.normalisedTokens).not.toContain('catalog');
    expect(parsed.normalisedTokens).toContain('migration');
    expect(parsed.normalisedTokens).toContain('notes');
  });

  it('extracts single-quoted phrases too', () => {
    const parsed = parseQuery("show me 'fact public holiday' entity");
    expect(parsed.quotedPhrases).toEqual(['fact public holiday']);
  });

  it('extracts multiple quoted phrases in order', () => {
    const parsed = parseQuery('"alpha beta" and "gamma delta"');
    expect(parsed.quotedPhrases).toEqual(['alpha beta', 'gamma delta']);
  });

  it('keeps meaningful interior hyphens on compound tokens', () => {
    const parsed = parseQuery('unity-catalog ci-cd pipeline');
    expect(parsed.normalisedTokens).toContain('unity-catalog');
    expect(parsed.normalisedTokens).toContain('ci-cd');
  });

  it('strips stray leading/trailing hyphens but keeps the token', () => {
    const parsed = parseQuery('-ingestion- notes');
    expect(parsed.normalisedTokens).toContain('ingestion');
    expect(parsed.normalisedTokens).not.toContain('-ingestion-');
  });

  it('infers intent consistently with context-assembler.inferIntent', () => {
    const query = 'how are ingestion and egress related?';
    const parsed = parseQuery(query);
    expect(parsed.intent).toBe(inferIntent(query));
    expect(parsed.intent).toBe('connection');
  });

  it('infers troubleshoot intent for error-flavoured queries', () => {
    const parsed = parseQuery('the pipeline failed with an error');
    expect(parsed.intent).toBe('troubleshoot');
  });

  it('defaults to lookup intent for plain queries', () => {
    const parsed = parseQuery('widget catalog schema');
    expect(parsed.intent).toBe('lookup');
  });

  it('trims the raw query and handles empty input', () => {
    const parsed = parseQuery('   ');
    expect(parsed.raw).toBe('');
    expect(parsed.normalisedTokens).toEqual([]);
    expect(parsed.quotedPhrases).toEqual([]);
  });

  it('rejects stopword-only queries down to an empty token list', () => {
    const parsed = parseQuery('the and of');
    expect(parsed.normalisedTokens).toEqual([]);
  });
});
