import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearSlopRulesCache,
  loadSlopRules,
  planFileDeslop,
} from '../../src/lib/slop.js';

const CLEAN_NOTE = `---
title: Clean
category: concepts
tags: [wiki]
summary: Already clean summary.
updated: 2026-01-01T00:00:00.000Z
---

# Clean

Body with no slop.
`;

describe('planFileDeslop', () => {
  beforeEach(() => {
    clearSlopRulesCache();
  });

  it('does not mark a clean LF note as changed', () => {
    const rules = loadSlopRules();
    const plan = planFileDeslop('/vault/clean.md', '/vault', CLEAN_NOTE, rules);
    expect(plan.changed).toBe(false);
    expect(plan.cleaned).toBe(CLEAN_NOTE);
    expect(plan.bodyCharFixes + plan.frontmatterCharFixes + plan.emojiRemovals).toBe(0);
  });

  it('does not mark a clean CRLF note as changed', () => {
    const rules = loadSlopRules();
    const raw = CLEAN_NOTE.replace(/\n/g, '\r\n');
    const plan = planFileDeslop('/vault/clean.md', '/vault', raw, rules);
    expect(plan.changed).toBe(false);
    expect(plan.cleaned).toBe(raw);
  });

  it('preserves blank line after fence when fixing body only', () => {
    const rules = loadSlopRules();
    const raw = `---
title: Dirty
category: concepts
tags: [wiki]
summary: Clean summary.
updated: 2026-01-01T00:00:00.000Z
---

# Dirty

Body with an em dash — here.
`;
    const plan = planFileDeslop('/vault/dirty.md', '/vault', raw, rules);
    expect(plan.changed).toBe(true);
    expect(plan.bodyCharFixes).toBeGreaterThan(0);
    expect(plan.cleaned.startsWith('---\ntitle: Dirty\n')).toBe(true);
    expect(plan.cleaned).toContain('---\n\n# Dirty\n');
    expect(plan.cleaned).not.toContain('—');
  });

  it('fixes frontmatter summary and strips emoji', () => {
    const rules = loadSlopRules();
    const rocket = String.fromCodePoint(0x1f680);
    const raw = `---
title: Dirty
category: concepts
tags: [wiki]
summary: A deep dive — with emoji ${rocket} here.
updated: 2026-01-01T00:00:00.000Z
---

# Dirty

Clean body.
`;
    const plan = planFileDeslop('/vault/fm.md', '/vault', raw, rules);
    expect(plan.changed).toBe(true);
    expect(plan.summaryChanged).toBe(true);
    expect(plan.frontmatterCharFixes).toBeGreaterThan(0);
    expect(plan.emojiRemovals).toBeGreaterThan(0);
    expect(plan.cleaned).not.toContain('—');
    expect(plan.cleaned).not.toContain(rocket);
    expect(plan.phraseFindings.some((f) => /deep dive/i.test(f.matchText))).toBe(true);
  });
});
