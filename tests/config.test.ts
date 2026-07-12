import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveVaultPath } from '../src/config.js';

describe('resolveVaultPath', () => {
  it('rejects relative paths', () => {
    expect(() => resolveVaultPath('relative/vault')).toThrow(/absolute/i);
  });

  it('expands ~ to the home directory', () => {
    const resolved = resolveVaultPath('~/MyVault');
    expect(resolved).toBe(path.resolve(path.join(os.homedir(), 'MyVault')));
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('accepts absolute paths', () => {
    const absolute = path.join(os.tmpdir(), 'cursidian-abs-vault');
    const resolved = resolveVaultPath(absolute);
    expect(resolved).toBe(path.resolve(absolute));
  });
});
