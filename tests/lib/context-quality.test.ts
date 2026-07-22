import { describe, expect, it } from 'vitest';
import { buildContextQualitySnapshot, compactContextItems } from '../../src/lib/context-quality.js';
import type { ContextBundle } from '../../src/types/index.js';

function sampleBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    query: 'test',
    intent: 'lookup',
    tokenBudget: 4000,
    tokensUsed: 2000,
    items: [
      {
        path: 'concepts/a.md',
        title: 'A',
        kind: 'body',
        text: 'body',
        score: 100,
        reasons: ['title-tokens:1'],
        tokens: 1600,
      },
      {
        path: 'concepts/b.md',
        title: 'B',
        kind: 'summary',
        text: 'sum',
        score: 50,
        reasons: ['summary-tokens:1'],
        tokens: 400,
      },
    ],
    coverage: { includedPaths: ['concepts/a.md'], consideredPaths: ['concepts/a', 'concepts/b'], droppedForBudget: [] },
    warnings: [],
    citations: ['[[concepts/a]]'],
    bundleConfidence: 0.95,
    focus: ['concepts/a.md', 'concepts/b.md'],
    guidance: { nextStep: 'sufficient', reason: 'ok' },
    ...overrides,
  };
}

describe('context-quality', () => {
  it('computes sufficiency, confidence, tokens, and depth share', () => {
    const q = buildContextQualitySnapshot(sampleBundle());
    expect(q.sufficiency).toBe(true);
    expect(q.nextStep).toBe('sufficient');
    expect(q.confidence).toBe(0.95);
    expect(q.tokensUsed).toBe(2000);
    expect(q.tokenBudget).toBe(4000);
    expect(q.fillRatio).toBe(0.5);
    expect(q.depthShare).toBe(0.8);
    expect(q.tokensByKind).toEqual({ body: 1600, summary: 400 });
    expect(q.itemCountsByKind).toEqual({ body: 1, summary: 1 });
    expect(q.cleanBundle).toBe(true);
    expect(q.focusTop1).toBe('concepts/a.md');
    expect(q.strongHit).toBe(true);
  });

  it('marks expand bundles as not sufficient / not strong', () => {
    const q = buildContextQualitySnapshot(
      sampleBundle({
        bundleConfidence: 0.83,
        guidance: { nextStep: 'expand', reason: 'dropped', suggestedTokenBudget: 6000 },
      }),
    );
    expect(q.sufficiency).toBe(false);
    expect(q.strongHit).toBe(false);
  });

  it('compacts items without passage text', () => {
    const compact = compactContextItems(sampleBundle().items);
    expect(compact).toHaveLength(2);
    expect(compact[0]).toMatchObject({ path: 'concepts/a.md', kind: 'body', tokens: 1600 });
    expect(compact[0]).not.toHaveProperty('text');
  });
});
