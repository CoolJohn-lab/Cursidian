import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  computeRevisionHash,
  checkRevisionConcurrency,
} from '../../src/lib/content-hash.js';

describe('computeContentHash', () => {
  it('returns a stable SHA-256 hex digest', () => {
    const hash = computeContentHash('# Hello\n\nWorld');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeContentHash('# Hello\n\nWorld')).toBe(hash);
  });

  it('changes when body content changes', () => {
    const a = computeContentHash('alpha');
    const b = computeContentHash('beta');
    expect(a).not.toBe(b);
  });
});

describe('computeRevisionHash', () => {
  it('hashes the full raw file including frontmatter', () => {
    const raw = '---\ntitle: Test\n---\n\n# Body\n';
    const hash = computeRevisionHash(raw);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeRevisionHash(raw)).toBe(hash);
  });

  it('changes when frontmatter changes but body is unchanged', () => {
    const body = '# Body\n';
    const a = computeRevisionHash(`---\ntitle: A\n---\n\n${body}`);
    const b = computeRevisionHash(`---\ntitle: B\n---\n\n${body}`);
    expect(a).not.toBe(b);
    expect(computeContentHash(body)).toBe(computeContentHash(body));
  });
});

describe('checkRevisionConcurrency', () => {
  const raw = '---\ntitle: Note\n---\n\nbody text\n';
  const body = 'body text\n';

  it('passes when no expected values are provided', () => {
    expect(checkRevisionConcurrency({ raw, body }).ok).toBe(true);
  });

  it('detects revision mismatch on frontmatter-only edits', () => {
    const staleRevision = computeRevisionHash('---\ntitle: Old\n---\n\nbody text\n');
    const result = checkRevisionConcurrency({
      raw,
      body,
      expectedRevision: staleRevision,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('revision mismatch');
    }
  });

  it('allows frontmatter-only stale contentHash but rejects stale revision', () => {
    const staleRevision = computeRevisionHash('---\ntitle: Old\n---\n\nbody text\n');
    const contentHash = computeContentHash(body);

    const hashOnly = checkRevisionConcurrency({ raw, body, expectedHash: contentHash });
    expect(hashOnly.ok).toBe(true);

    const revision = checkRevisionConcurrency({ raw, body, expectedRevision: staleRevision });
    expect(revision.ok).toBe(false);
  });

  it('warns when expectedHash is used', () => {
    const contentHash = computeContentHash(body);
    const result = checkRevisionConcurrency({ raw, body, expectedHash: contentHash });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings?.[0]).toContain('deprecated');
    }
  });
});
