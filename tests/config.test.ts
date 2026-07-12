import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { resolveVaultPath, parsePositiveInt, DEFAULT_MAX_FILE_SIZE } from '../src/config.js';

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

describe('parsePositiveInt', () => {
  it('returns the default for undefined or blank', () => {
    expect(parsePositiveInt(undefined, DEFAULT_MAX_FILE_SIZE)).toBe(DEFAULT_MAX_FILE_SIZE);
    expect(parsePositiveInt('   ', DEFAULT_MAX_FILE_SIZE)).toBe(DEFAULT_MAX_FILE_SIZE);
  });

  it('accepts valid positive integers', () => {
    expect(parsePositiveInt('1048576', DEFAULT_MAX_FILE_SIZE)).toBe(1_048_576);
  });

  it('rejects zero, negative, and non-numeric values', () => {
    expect(() => parsePositiveInt('0', DEFAULT_MAX_FILE_SIZE)).toThrow(/positive integer/i);
    expect(() => parsePositiveInt('-1', DEFAULT_MAX_FILE_SIZE)).toThrow(/positive integer/i);
    expect(() => parsePositiveInt('NaN', DEFAULT_MAX_FILE_SIZE)).toThrow(/positive integer/i);
    expect(() => parsePositiveInt('abc', DEFAULT_MAX_FILE_SIZE)).toThrow(/positive integer/i);
  });
});
