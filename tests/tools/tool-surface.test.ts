import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerAllTools } from '../../src/tools/index.js';
import { createTestVault, cleanupVault } from './helpers.js';
import type { TestContext } from './helpers.js';

/**
 * Locks the consolidated MCP tool surface: note|search|graph|vault, plus
 * context when src/tools/context.ts is present, with retired per-noun tools
 * never re-registered and each dispatcher's action enum matching the
 * documented contract.
 */

let ctx: TestContext;
let toolNames: string[];
let toolByName: Map<string, { inputSchema?: { properties?: Record<string, unknown> } }>;

const RETIRED_TOOL_DENYLIST = ['read_note', 'search_content', 'list_notes', 'get_backlinks'];
const CORE_TOOL_NAMES = ['graph', 'note', 'search', 'vault'];
const EXPECTED_TOOL_NAMES = [...CORE_TOOL_NAMES, 'context'].sort();

function actionEnum(
  tool: { inputSchema?: { properties?: Record<string, unknown> } } | undefined,
): string[] {
  const actionSchema = tool?.inputSchema?.properties?.action as { enum?: string[] } | undefined;
  return actionSchema?.enum ?? [];
}

beforeAll(async () => {
  ctx = await createTestVault((server, config) => {
    registerAllTools(server, config);
  });
  const { tools } = await ctx.client.listTools();
  toolNames = tools.map((t) => t.name).sort();
  toolByName = new Map(tools.map((t) => [t.name, t]));
});

afterAll(async () => {
  await cleanupVault(ctx.vault);
});

describe('tool surface', () => {
  it('registers exactly the consolidated tool set', () => {
    expect(toolNames).toEqual(EXPECTED_TOOL_NAMES);
  });

  it('always registers the four core tools', () => {
    for (const name of CORE_TOOL_NAMES) {
      expect(toolNames).toContain(name);
    }
  });

  it('does not register any retired per-noun tool', () => {
    for (const retired of RETIRED_TOOL_DENYLIST) {
      expect(toolNames).not.toContain(retired);
    }
  });

  it('search action enum matches content/by_tags/list/recent/tags', () => {
    const actions = actionEnum(toolByName.get('search')).slice().sort();
    expect(actions).toEqual(['by_tags', 'content', 'list', 'recent', 'tags'].sort());
  });

  it('note action enum matches read/create/update/delete/rename/frontmatter', () => {
    const actions = actionEnum(toolByName.get('note')).slice().sort();
    expect(actions).toEqual(
      ['create', 'delete', 'frontmatter', 'read', 'rename', 'update'].sort(),
    );
  });

  it('graph has no action enum (single-purpose neighborhood tool)', () => {
    const graph = toolByName.get('graph');
    expect(graph?.inputSchema?.properties?.action).toBeUndefined();
    expect(graph?.inputSchema?.properties?.path).toBeDefined();
  });

  it('vault action enum covers maintenance operations', () => {
    const actions = actionEnum(toolByName.get('vault')).slice().sort();
    expect(actions).toEqual(
      [
        'health',
        'sync_index',
        'slop_check',
        'deslop',
        'create_folder',
        'list_folders',
        'delete_folder',
        'log',
        'history',
        'undo',
        'manifest',
        'vocabulary',
      ].sort(),
    );
  });

  it('every tool exposes a non-empty description', () => {
    for (const name of toolNames) {
      const tool = toolByName.get(name) as { description?: string };
      expect(typeof tool.description).toBe('string');
      expect((tool.description ?? '').length).toBeGreaterThan(0);
    }
  });
});
