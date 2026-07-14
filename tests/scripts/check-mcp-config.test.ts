import { describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { checkMcpConfig, checkToolSurface, isAbsolutePath } from '../../scripts/check-mcp-config.mjs';

describe('isAbsolutePath', () => {
  it('accepts POSIX and Windows absolute paths', () => {
    expect(isAbsolutePath('/Users/you/vault')).toBe(true);
    expect(isAbsolutePath('C:\\Users\\you\\vault')).toBe(true);
    expect(isAbsolutePath('relative/vault')).toBe(false);
  });
});

describe('checkMcpConfig', () => {
  const expectedDist = '/repo/cursidian/dist/index.js';

  it('passes a healthy local node config', () => {
    const raw = JSON.stringify({
      mcpServers: {
        cursidian: {
          command: 'node',
          args: [expectedDist],
          env: { OBSIDIAN_VAULT_PATH: '/Users/you/vault' },
        },
      },
    });
    expect(checkMcpConfig(raw, { expectedDistEntry: expectedDist })).toEqual([]);
  });

  it('flags predecessor path and missing vault', () => {
    const raw = JSON.stringify({
      mcpServers: {
        cursidian: {
          command: 'node',
          args: ['/old/Obsidian-MCP-For-Cursor/dist/index.js'],
          env: {},
        },
      },
    });
    const problems = checkMcpConfig(raw, { expectedDistEntry: expectedDist });
    expect(problems.some((p) => /Obsidian-MCP-For-Cursor/.test(p))).toBe(true);
    expect(problems.some((p) => /OBSIDIAN_VAULT_PATH/.test(p))).toBe(true);
  });

  it('flags missing cursidian server key', () => {
    const raw = JSON.stringify({ mcpServers: { obsidian: { command: 'npx' } } });
    const problems = checkMcpConfig(raw, { expectedDistEntry: expectedDist });
    expect(problems.some((p) => /cursidian entry is missing/.test(p))).toBe(true);
  });
});

describe('checkToolSurface', () => {
  it('passes when the file registers all five tools', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-toolsurface-'));
    const distPath = path.join(dir, 'index.js');
    await fsp.writeFile(
      distPath,
      "registerNote(server, config);\nregisterSearch(server, config);\nregisterGraph(server, config);\nregisterVault(server, config);\nregisterContext(server, config);\n",
      'utf8',
    );
    const result = checkToolSurface({ distPath, srcPath: path.join(dir, 'missing.ts') });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('flags a missing context tool registration', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-toolsurface-'));
    const distPath = path.join(dir, 'index.js');
    await fsp.writeFile(
      distPath,
      'registerNote(server, config);\nregisterSearch(server, config);\nregisterGraph(server, config);\nregisterVault(server, config);\n',
      'utf8',
    );
    const result = checkToolSurface({ distPath, srcPath: path.join(dir, 'missing.ts') });
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => /registerContext/.test(p))).toBe(true);
    await fsp.rm(dir, { recursive: true, force: true });
  });

  it('skips gracefully when neither dist nor src tools index exists', () => {
    const result = checkToolSurface({
      distPath: '/nonexistent/dist/tools/index.js',
      srcPath: '/nonexistent/src/tools/index.ts',
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeTruthy();
  });

  it('falls back to the src tools index when dist has not been built', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-toolsurface-'));
    const srcPath = path.join(dir, 'index.ts');
    await fsp.writeFile(
      srcPath,
      'registerNote(server, config);\nregisterSearch(server, config);\nregisterGraph(server, config);\nregisterVault(server, config);\nregisterContext(server, config);\n',
      'utf8',
    );
    const result = checkToolSurface({ distPath: path.join(dir, 'missing.js'), srcPath });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBeNull();
    await fsp.rm(dir, { recursive: true, force: true });
  });
});
