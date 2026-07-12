import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerSearch } from '../../src/tools/search.js';
import { createTestVault, seedVault, cleanupVault, callTool, parseResult, writeNote } from './helpers.js';
import type { TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestVault();
  await seedVault(ctx.vault);
  registerSearch(ctx.server, ctx.config);
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('search (content)', () => {
  it('finds notes containing query', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A' });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('returns snippets with line numbers', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A' });
    const data = parseResult(result) as { results: Array<{ snippets: Array<{ lineNumber: number }> }> };
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].snippets[0].lineNumber).toBeGreaterThan(0);
  });

  it('case-insensitive by default', async () => {
    const result1 = await callTool(ctx.server, 'search', { action: 'content', query: 'project a' });
    const result2 = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A' });
    const d1 = parseResult(result1) as { results: unknown[] };
    const d2 = parseResult(result2) as { results: unknown[] };
    expect(d1.results.length).toBe(d2.results.length);
  });

  it('returns empty results for unknown query', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'xyzzy-nonexistent-12345' });
    const data = parseResult(result) as { results: unknown[] };
    expect(data.results).toHaveLength(0);
  });

  it('returns relevanceScore and matchReasons when verbose', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A', verbose: true });
    const data = parseResult(result) as {
      results: Array<{ relevanceScore: number; matchReasons: string[] }>;
    };
    expect(data.results[0].relevanceScore).toBeGreaterThan(0);
    expect(data.results[0].matchReasons.length).toBeGreaterThan(0);
  });

  it('returns relevanceScore without matchReasons by default', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A' });
    const data = parseResult(result) as {
      results: Array<{ relevanceScore: number; matchReasons?: string[] }>;
    };
    expect(data.results[0].relevanceScore).toBeGreaterThan(0);
    expect(data.results[0].matchReasons).toBeUndefined();
  });

  it('caps snippets at 2 per hit', async () => {
    await writeNote(
      ctx.vault,
      'many-snippet-lines.md',
      '# Many\n\nline one match\nline two match\nline three match\nline four match\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'match' });
    const data = parseResult(result) as { results: Array<{ snippets: unknown[] }> };
    const hit = data.results.find((r) => r.path.includes('many-snippet-lines'));
    expect(hit?.snippets.length).toBeLessThanOrEqual(2);
  });

  it('omits match on snippets unless verbose', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A' });
    const data = parseResult(result) as { results: Array<{ snippets: Array<{ match?: string }> }> };
    expect(data.results[0].snippets[0].match).toBeUndefined();
  });

  it('includes match on snippets when verbose', async () => {
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Project A', verbose: true });
    const data = parseResult(result) as { results: Array<{ snippets: Array<{ match?: string }> }> };
    expect(data.results[0].snippets[0].match).toBeDefined();
  });

  it('excludes operational files by default', async () => {
    await writeNote(ctx.vault, 'index.md', '---\ntitle: Wiki Index\n---\n\nUniqueOperationalToken123\n');
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'UniqueOperationalToken123' });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.some((r) => r.path.replace(/\\/g, '/').endsWith('index.md'))).toBe(false);
  });

  it('includes operational files when includeOperational is true', async () => {
    await writeNote(ctx.vault, 'log.md', '---\ntitle: Log\n---\n\nUniqueLogToken456\n');
    const result = await callTool(ctx.server, 'search', { action: 'content',
      query: 'UniqueLogToken456',
      includeOperational: true,
    });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.some((r) => r.path.replace(/\\/g, '/').endsWith('log.md'))).toBe(true);
  });

  it('does not include frontmatter lines in snippets', async () => {
    await writeNote(
      ctx.vault,
      'fm-snippet-test.md',
      '---\ntitle: FM Test\ntags: [secret-tag]\n---\n\nBodyUniqueWord789 here.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'secret-tag' });
    const data = parseResult(result) as { results: Array<{ snippets: Array<{ line: string }> }> };
    for (const hit of data.results) {
      for (const snip of hit.snippets) {
        expect(snip.line).not.toMatch(/^tags:/);
        expect(snip.line).not.toMatch(/^title:/);
      }
    }
  });

  it('returns compact format with metadata only', async () => {
    await writeNote(
      ctx.vault,
      'compact-hit.md',
      '---\ntitle: Compact Hit\ntags: [x]\nsummary: Compact summary.\n---\n\nCompactBodyToken.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content',
      query: 'CompactBodyToken',
      format: 'compact',
    });
    const data = parseResult(result) as {
      results: Array<{
        path: string;
        title?: string;
        summary?: string;
        tags?: string[];
        relevanceScore?: number;
        snippets?: unknown[];
        matchCount?: number;
        matchReasons?: string[];
      }>;
    };
    const hit = data.results.find((r) => r.path.includes('compact-hit'));
    expect(hit).toBeDefined();
    expect(hit?.title).toBe('Compact Hit');
    expect(hit?.summary).toBe('Compact summary.');
    expect('snippets' in (hit ?? {})).toBe(false);
    expect('matchCount' in (hit ?? {})).toBe(false);
    expect(hit?.matchReasons).toBeUndefined();
  });

  it('finds notes by frontmatter alias', async () => {
    await writeNote(
      ctx.vault,
      'entities/gpu-server.md',
      '---\ntitle: GPU Server\naliases: [compute box, gpu server]\nsummary: Lab GPU server.\n---\n\nHardware notes.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'compute box' });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.some((r) => r.path.replace(/\\/g, '/').includes('gpu-server'))).toBe(true);
  });

  it('OR-fallbacks when AND finds fewer than 3 hits', async () => {
    await writeNote(ctx.vault, 'three-token-or.md', '# Three\n\nalpha beta together in one note.');
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'alpha beta gamma' });
    const data = parseResult(result) as { fallbackMode: 'or' | null; results: Array<{ path: string }> };
    expect(data.fallbackMode).toBe('or');
    expect(data.results.some((r) => r.path.includes('three-token-or'))).toBe(true);
  });

  it('corrects typos and returns correctedTokens', async () => {
    await writeNote(
      ctx.vault,
      'widget-flash.md',
      '---\ntitle: Widget Flash\ntags: [widget, flash]\nsummary: Device flash guide.\n---\n\nUniqueWidgetFlashMarker steps here.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'widgit flahs UniqueWidgetFlashMarker' });
    const data = parseResult(result) as {
      correctedTokens?: string[];
      results: Array<{ path: string }>;
    };
    expect(data.correctedTokens).toBeDefined();
    expect(data.correctedTokens).toEqual(
      expect.arrayContaining(['widget', 'flash', 'UniqueWidgetFlashMarker']),
    );
    expect(data.results.some((r) => r.path.includes('widget-flash'))).toBe(true);
  });

  it('does not let a misspelled alias block title-word typo correction', async () => {
    await writeNote(
      ctx.vault,
      'tunnel-setup.md',
      '---\ntitle: Proxy Tunnel\naliases: [proxie]\ntags: [tunnel]\nsummary: Tunnel setup.\n---\n\nUniqueTunnelTypoMarker here.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content',
      query: 'proxt UniqueTunnelTypoMarker',
    });
    const data = parseResult(result) as {
      correctedTokens?: string[];
      results: Array<{ path: string }>;
    };
    expect(data.correctedTokens?.some((t) => t.toLowerCase() === 'proxy')).toBe(true);
    expect(data.results.some((r) => r.path.includes('tunnel-setup'))).toBe(true);
  });

  it('returns title, summary, and tags from the vault index', async () => {
    await writeNote(
      ctx.vault,
      'meta-hit.md',
      '---\ntitle: Meta Hit\ntags: [alpha, beta]\nsummary: Indexed preview for search hits.\n---\n\n# Meta Hit\n\nUniqueTokenForMetaHit in body.\n',
    );

    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'UniqueTokenForMetaHit' });
    const data = parseResult(result) as {
      results: Array<{ path: string; title?: string; summary?: string; tags?: string[] }>;
    };
    const hit = data.results.find((r) => r.path.replace(/\\/g, '/').includes('meta-hit'));
    expect(hit).toBeDefined();
    expect(hit?.title).toBe('Meta Hit');
    expect(hit?.summary).toBe('Indexed preview for search hits.');
    expect(hit?.tags).toEqual(expect.arrayContaining(['alpha', 'beta']));
  });

  it('uses token-AND for multi-word queries', async () => {
    await writeNote(ctx.vault, 'token-and-a.md', '# A\n\nalpha only');
    await writeNote(ctx.vault, 'token-and-b.md', '# B\n\nbeta only');
    await writeNote(ctx.vault, 'token-and-both.md', '# Both\n\nalpha and beta together');

    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'alpha beta' });
    const data = parseResult(result) as { results: Array<{ path: string }>; fallbackMode: string | null };
    const paths = data.results.map((r) => r.path);
    expect(paths).toContain('token-and-both.md');
    expect(paths).not.toContain('token-and-a.md');
    expect(paths).not.toContain('token-and-b.md');
    expect(data.fallbackMode).toBeNull();
  });

  it('strips stopwords and OR-fallbacks when AND finds nothing', async () => {
    await writeNote(
      ctx.vault,
      'tunnel-ports.md',
      '---\ntitle: Tunnel Ports\ntags: [networking]\nsummary: No WAN port forwards; outbound tunnel only.\n---\n\n# Tunnel Ports\n\nOutbound tunnels only. Router port forwards are disabled. UniqueStopwordOrFallbackMarker.\n',
    );

    const result = await callTool(ctx.server, 'search', { action: 'content',
      query: 'how do I expose the database without opening ports on my router UniqueStopwordOrFallbackMarker',
    });
    const data = parseResult(result) as {
      strippedStopwords: boolean;
      contentTokens: string[];
      fallbackMode: 'or' | null;
      results: Array<{ path: string; summary?: string }>;
    };

    expect(data.strippedStopwords).toBe(true);
    expect(data.contentTokens).toContain('ports');
    expect(data.contentTokens).not.toContain('how');
    expect(data.fallbackMode).toBe('or');
    expect(data.results.some((r) => r.path.replace(/\\/g, '/').includes('tunnel-ports'))).toBe(true);
  });

  it('matches morphological variants via Porter stemming', async () => {
    await writeNote(
      ctx.vault,
      'orchestration-note.md',
      '# Orchestration and ADF\n\nMain Orchestrator pipeline deployment notes.',
    );

    const result = await callTool(ctx.server, 'search', { action: 'content',
      query: 'orchestrator deploy',
    });
    const data = parseResult(result) as { results: Array<{ path: string }> };
    expect(data.results.map((r) => r.path)).toContain('orchestration-note.md');
  });

  it('defaults to content action when action is omitted', async () => {
    const result = await callTool(ctx.server, 'search', { query: 'Project A' });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { results: unknown[] };
    expect(data.results.length).toBeGreaterThan(0);
  });

  it('verbose snippet match lists only tokens present on the line', async () => {
    await writeNote(
      ctx.vault,
      'partial-token-match.md',
      '---\ntitle: Partial Match\n---\n\nThis line mentions wikilink syntax.\nAnother line mentions backlinks here.\nThis line mentions wiki only.\n',
    );
    const result = await callTool(ctx.server, 'search', {
      action: 'content',
      query: 'wikilink backlinks',
      verbose: true,
    });
    const data = parseResult(result) as {
      results: Array<{ path: string; snippets: Array<{ line: string; match?: string }> }>;
    };
    const hit = data.results.find((r) => r.path.includes('partial-token-match'));
    expect(hit).toBeDefined();
    const wikiOnlySnippet = hit!.snippets.find((s) => s.line.includes('wiki only'));
    expect(wikiOnlySnippet).toBeUndefined();
    const wikilinkSnippet = hit!.snippets.find((s) => s.line.includes('wikilink'));
    expect(wikilinkSnippet?.match).not.toContain('backlinks');
    const backlinkSnippet = hit!.snippets.find((s) => s.line.includes('backlinks'));
    expect(backlinkSnippet?.match).not.toContain('wikilink');
  });

  it('does not correct note to home in multi-word queries', async () => {
    await writeNote(
      ctx.vault,
      'entities/workflow-note.md',
      '---\ntitle: Workflow Note\ntags: [workflow]\nsummary: Workflow automation note.\n---\n\nTemporary probe note for typo regression.\n',
    );
    const result = await callTool(ctx.server, 'search', { action: 'content', query: 'Temporary probe note' });
    const data = parseResult(result) as {
      correctedTokens?: string[];
      results: Array<{ path: string }>;
    };
    if (data.correctedTokens) {
      expect(data.correctedTokens).not.toContain('home');
    }
    expect(data.results.some((r) => r.path.includes('workflow-note'))).toBe(true);
  });
});
