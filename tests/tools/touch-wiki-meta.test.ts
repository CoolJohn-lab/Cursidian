import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerVault } from '../../src/tools/vault.js';
import { registerNote } from '../../src/tools/note.js';
import {
  createTestVault,
  cleanupVault,
  callTool,
  parseResult,
  writeNote,
} from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await writeNote(
    ctx.vault,
    'log.md',
    '---\ntitle: Wiki Log\n---\n\n# Wiki Log\n\n- [2026-01-01T00:00:00Z] INIT\n',
  );
  await writeNote(
    ctx.vault,
    'hot.md',
    '---\ntitle: Hot Cache\nupdated: 2026-01-01T00:00:00Z\n---\n\n# Hot Cache\n\n## Recent Activity\n\n- [2026-01-01T00:00:00Z] INIT\n\n## Active Threads\n\n- none\n',
  );
  registerVault(ctx.server, ctx.config);
  registerNote(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('vault (log)', () => {
  it('appends a normalised log line', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'log',
      logLine: 'CAPTURE page="concepts/demo" title="Demo"',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      log: { path: string; line: string; contentHash: string };
      hot?: unknown;
    };
    expect(data.log.path).toBe('log.md');
    expect(data.log.line).toMatch(/^- \[\d{4}-/);
    expect(data.log.line).toContain('CAPTURE page="concepts/demo"');
    expect(data.hot).toBeUndefined();

    const log = parseResult(
      await callTool(ctx.server, 'note', { action: 'read', path: 'log.md' }),
    ) as { content: string };
    expect(log.content).toContain('CAPTURE page="concepts/demo"');
  });

  it('updates hot.md Recent Activity and keeps three bullets', async () => {
    await callTool(ctx.server, 'vault', {
      action: 'log',
      logLine: 'INGEST mode=append pages_created=1',
      hotActivity: 'INGEST - added [[concepts/demo]]',
    });
    await callTool(ctx.server, 'vault', {
      action: 'log',
      logLine: 'LINT orphans=0',
      hotActivity: 'LINT - clean',
    });
    const result = await callTool(ctx.server, 'vault', {
      action: 'log',
      logLine: 'WIKI_UPDATE project=demo',
      hotActivity: 'WIKI_UPDATE - demo synced',
    });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { hot: { path: string; contentHash: string } };
    expect(data.hot.path).toBe('hot.md');

    const hot = parseResult(
      await callTool(ctx.server, 'note', { action: 'read', path: 'hot.md' }),
    ) as { content: string; frontmatter: { updated?: string } };
    expect(hot.frontmatter.updated).toBeTruthy();
    const activitySection = hot.content.split('## Active Threads')[0] ?? '';
    const bullets = activitySection.split('\n').filter((line) => line.trim().startsWith('- '));
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toContain('WIKI_UPDATE');
  });

  it('returns structured hash_mismatch for stale expectedLogHash', async () => {
    const result = await callTool(ctx.server, 'vault', {
      action: 'log',
      logLine: 'SHOULD_FAIL',
      expectedLogHash: 'deadbeef',
    });
    expect(result.isError).toBe(true);
    const data = parseResult(result) as { error: string; path?: string };
    expect(data.error).toBe('hash_mismatch');
    expect(data.path).toBe('log.md');
  });
});
