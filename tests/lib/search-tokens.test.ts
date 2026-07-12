import { describe, it, expect } from 'vitest';
import {
  allTokensMatchInText,
  countMatchingTokens,
  expandSearchToken,
  minOrMatchCount,
  prepareSearchTokens,
  stemToken,
  stripSearchStopwords,
  stemGroupKey,
  tokenMatchesInText,
  tokensMorphologicallyMatch,
} from '../../src/lib/search-tokens.js';

describe('search-tokens', () => {
  it('stems inflectional variants to the same key', () => {
    expect(stemToken('holidays')).toBe(stemToken('holiday'));
    expect(stemToken('pipelines')).toBe(stemToken('pipeline'));
    expect(stemToken('orchestrator')).toBe(stemToken('orchestration'));
    expect(stemGroupKey('deployment')).toBe(stemGroupKey('deployments'));
  });

  it('matches deploy and deployment via morphological overlap', () => {
    expect(tokensMorphologicallyMatch('deploy', 'deployment')).toBe(true);
    expect(tokenMatchesInText('deploy', 'CI/CD deployment pipeline', false)).toBe(true);
    expect(tokenMatchesInText('orchestrator', 'Main Orchestration page', false)).toBe(true);
  });

  it('does not match longer query tokens against shorter text words', () => {
    expect(tokensMorphologicallyMatch('wikilink', 'wiki')).toBe(false);
    expect(tokenMatchesInText('wikilink', 'Fred is offline in the wiki inventory', false)).toBe(
      false,
    );
  });

  it('does not treat unrelated words as morphological matches', () => {
    expect(tokensMorphologicallyMatch('integration', 'ingestion')).toBe(false);
    expect(tokenMatchesInText('integration', 'API ingestion only', false)).toBe(false);
  });

  it('expandSearchToken returns original plus stem when they differ', () => {
    const terms = expandSearchToken('holidays');
    expect(terms).toContain('holidays');
    expect(terms).toContain(stemToken('holidays'));
  });

  it('requires all tokens with stem-aware matching', () => {
    const text = 'ADF pipelines and Main Orchestrator deployment';
    expect(allTokensMatchInText(['pipeline', 'orchestrator', 'deploy'], text, false)).toBe(true);
    expect(allTokensMatchInText(['pipeline', 'orchestrator', 'falcon'], text, false)).toBe(false);
  });

  it('strips common stopwords from natural-language queries', () => {
    const prepared = prepareSearchTokens(
      'how do I expose the database without opening ports on my router',
    );
    expect(prepared.strippedStopwords).toBe(true);
    expect(prepared.contentTokens).toEqual([
      'expose',
      'database',
      'opening',
      'ports',
      'router',
    ]);
    expect(stripSearchStopwords(['how', 'port', 'forward'])).toEqual(['port', 'forward']);
  });

  it('keeps raw tokens when the query is only stopwords', () => {
    const prepared = prepareSearchTokens('how do I');
    expect(prepared.contentTokens).toEqual(['how', 'do', 'I']);
    expect(prepared.strippedStopwords).toBe(false);
  });

  it('counts matching tokens and computes OR thresholds', () => {
    const text = 'database ports on the server';
    expect(countMatchingTokens(['database', 'expose', 'ports', 'router'], text, false)).toBe(2);
    expect(minOrMatchCount(3)).toBe(2);
    expect(minOrMatchCount(5)).toBe(3);
    expect(minOrMatchCount(1)).toBe(1);
  });
});
