import { describe, expect, it } from 'vitest';
import { checkMcpConfig, isAbsolutePath } from '../../scripts/check-mcp-config.mjs';

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
