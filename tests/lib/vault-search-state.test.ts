import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  clearVaultSearchStateCache,
  getVaultMarkdownFiles,
} from '../../src/lib/vault-search-state.js';
import { clearAllSearchCaches } from '../../src/lib/vault-index.js';

const MAX = 10_485_760;

describe('vault-search-state', () => {
  let vault: string;

  beforeEach(async () => {
    clearAllSearchCaches();
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'vault-search-state-'));
    await fsp.writeFile(path.join(vault, 'a.md'), '# A\n\nalpha', 'utf-8');
  });

  afterEach(async () => {
    clearVaultSearchStateCache();
    clearAllSearchCaches();
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('returns cached snapshot on unchanged vault within TTL', async () => {
    const first = await getVaultMarkdownFiles(vault, MAX);
    const second = await getVaultMarkdownFiles(vault, MAX);
    expect(second).toBe(first);
    expect(first[0]?.content).toContain('alpha');
  });

  it('invalidates when file content changes in place', async () => {
    const first = await getVaultMarkdownFiles(vault, MAX);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fsp.writeFile(path.join(vault, 'a.md'), '# A\n\nbeta edited', 'utf-8');
    const second = await getVaultMarkdownFiles(vault, MAX);
    expect(second).not.toBe(first);
    expect(second[0]?.content).toContain('beta edited');
  });

  it('invalidates when a new markdown file is added', async () => {
    await getVaultMarkdownFiles(vault, MAX);
    await fsp.writeFile(path.join(vault, 'b.md'), '# B\n\nnew file', 'utf-8');
    const after = await getVaultMarkdownFiles(vault, MAX);
    expect(after.map((f) => f.relativePath).sort()).toEqual(['a.md', 'b.md']);
  });
});
