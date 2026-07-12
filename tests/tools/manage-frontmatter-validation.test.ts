import { describe, it, expect } from 'vitest';
import { validateFrontmatterOperation } from '../../src/tools/manage-frontmatter.js';

describe('validateFrontmatterOperation', () => {
  const cases: Array<{
    operation: 'set' | 'merge' | 'delete';
    data?: Record<string, unknown>;
    keys?: string[];
    error: string | null;
  }> = [
    { operation: 'set', data: { title: 'x' }, error: null },
    { operation: 'set', error: 'operation "set" requires frontmatter with at least one field (e.g. { title: "...", updated: "..." })' },
    { operation: 'set', data: {}, error: 'operation "set" requires frontmatter with at least one field (e.g. { title: "...", updated: "..." })' },
    { operation: 'merge', data: { status: 'active' }, error: null },
    { operation: 'merge', error: 'operation "merge" requires frontmatter with at least one field' },
    { operation: 'merge', data: {}, error: 'operation "merge" requires frontmatter with at least one field' },
    { operation: 'delete', keys: ['draft'], error: null },
    { operation: 'delete', error: 'operation "delete" requires a non-empty keys array' },
    { operation: 'delete', keys: [], error: 'operation "delete" requires a non-empty keys array' },
  ];

  it.each(cases)('$operation returns expected validation result', ({ operation, data, keys, error }) => {
    expect(validateFrontmatterOperation(operation, data, keys)).toBe(error);
  });
});
