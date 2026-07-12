import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AlreadyExistsError,
  atomicReplace,
  clearPathLocks,
  createExclusive,
} from '../../src/lib/vault-io.js';

describe('vault-io', () => {
  let vault = '';
  let notePath = '';

  beforeAll(async () => {
    clearPathLocks();
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-vault-io-'));
    notePath = path.join(vault, 'note.md');
  });

  afterAll(async () => {
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('createExclusive fails when the file already exists', async () => {
    await createExclusive(vault, notePath, '# first', 1024);
    await expect(createExclusive(vault, notePath, '# second', 1024)).rejects.toBeInstanceOf(
      AlreadyExistsError,
    );
    const content = await fsp.readFile(notePath, 'utf-8');
    expect(content).toBe('# first');
  });

  it('atomicReplace updates content atomically', async () => {
    await atomicReplace(vault, notePath, '# replaced', 1024);
    const content = await fsp.readFile(notePath, 'utf-8');
    expect(content).toBe('# replaced');
  });
});
