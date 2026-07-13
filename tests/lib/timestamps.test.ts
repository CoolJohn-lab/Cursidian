import { describe, it, expect } from 'vitest';
import { nowIso, withCreateTimestamps, withUpdatedTimestamp, withUpdatedTimestampUnlessProvided } from '../../src/lib/timestamps.js';

describe('timestamps', () => {
  it('nowIso returns ISO string', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('withCreateTimestamps sets missing created and updated', () => {
    const result = withCreateTimestamps({}, '2026-01-01T00:00:00.000Z');
    expect(result.created).toBe('2026-01-01T00:00:00.000Z');
    expect(result.updated).toBe('2026-01-01T00:00:00.000Z');
  });

  it('withCreateTimestamps preserves caller values', () => {
    const result = withCreateTimestamps(
      { created: '2025-01-01T00:00:00.000Z', updated: '2025-06-01T00:00:00.000Z' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.created).toBe('2025-01-01T00:00:00.000Z');
    expect(result.updated).toBe('2025-06-01T00:00:00.000Z');
  });

  it('withUpdatedTimestamp bumps updated', () => {
    const result = withUpdatedTimestamp({ title: 'X' }, '2026-01-01T00:00:00.000Z');
    expect(result.updated).toBe('2026-01-01T00:00:00.000Z');
  });

  it('withUpdatedTimestampUnlessProvided respects caller updated', () => {
    const result = withUpdatedTimestampUnlessProvided(
      { title: 'X' },
      { updated: '2025-01-01T00:00:00.000Z' },
      '2026-01-01T00:00:00.000Z',
    );
    expect(result.updated).toBeUndefined();
  });
});
