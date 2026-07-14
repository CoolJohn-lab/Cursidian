#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseNotePath } from './lib/transcript-parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CORPUS = path.join(REPO_ROOT, 'docs/validation/corpus/mcp-calls-30d.jsonl');
const OUT = path.join(REPO_ROOT, 'docs/validation/corpus/pattern-classification.json');
const DEEP_SESSION = 'f681a293-0729-4f69-93e9-cd5da9b4572a';

const FRICTION_RULES = [
  {
    id: 'replace_accident',
    match: (c) => c.toolName === 'update_note' && (c.arguments.mode ?? 'replace') === 'replace',
    severity: 'P0',
    note: 'Full-body replace; historical sessions show accidental truncation risk',
  },
  {
    id: 'replace_tiny_fragment',
    match: (c) =>
      c.toolName === 'update_note' &&
      (c.arguments.mode ?? 'replace') === 'replace' &&
      typeof c.arguments.content === 'string' &&
      c.arguments.content.length < 500,
    severity: 'P0',
    note: 'Short replace payload likely partial-edit mistake',
  },
  {
    id: 'multi_word_search',
    match: (c) => c.toolName === 'search_content' && /\s/.test(c.arguments.query ?? ''),
    severity: 'P1',
    note: 'Multi-word query; upstream phrase search often returns zero',
  },
  {
    id: 'search_then_read',
    match: (c) => c.toolName === 'search_content',
    severity: 'info',
    note: 'Search→read chain candidate for replay labelling',
  },
  {
    id: 'read_before_write',
    match: (c) => c.toolName === 'read_note',
    severity: 'info',
    note: 'Read before write pattern',
  },
  {
    id: 'frontmatter_merge',
    match: (c) => c.toolName === 'manage_frontmatter',
    severity: 'info',
    note: 'Frontmatter merge (safe partial update)',
  },
  {
    id: 'get_backlinks',
    match: (c) => c.toolName === 'get_backlinks',
    severity: 'info',
    note: 'Graph traversal',
  },
];

/**
 * Loads corpus JSONL into memory.
 */
async function loadCorpus() {
  const raw = await fs.readFile(CORPUS, 'utf-8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Classifies friction patterns across the corpus and deep-reads key sessions.
 */
async function main() {
  const calls = await loadCorpus();
  const tagged = [];
  const frictionCounts = {};
  const sessionMcpCounts = {};

  for (const call of calls) {
    sessionMcpCounts[call.sessionId] = (sessionMcpCounts[call.sessionId] ?? 0) + 1;
    const tags = [];
    for (const rule of FRICTION_RULES) {
      if (rule.match(call)) {
        tags.push({ id: rule.id, severity: rule.severity, note: rule.note });
        frictionCounts[rule.id] = (frictionCounts[rule.id] ?? 0) + 1;
      }
    }
    tagged.push({ ...call, frictionTags: tags });
  }

  const topSessions = Object.entries(sessionMcpCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sessionId, count]) => ({ sessionId, mcpCallCount: count }));

  const deepCalls = calls.filter((c) => c.sessionId === DEEP_SESSION);
  const deepAnalysis = {
    sessionId: DEEP_SESSION,
    totalCalls: deepCalls.length,
    byTool: deepCalls.reduce((acc, c) => {
      acc[c.toolName] = (acc[c.toolName] ?? 0) + 1;
      return acc;
    }, {}),
    replaceAccidents: deepCalls.filter(
      (c) =>
        c.toolName === 'update_note' &&
        (c.arguments.mode ?? 'replace') === 'replace' &&
        typeof c.arguments.content === 'string' &&
        c.arguments.content.length < 2000,
    ).length,
    multiWordSearches: deepCalls
      .filter((c) => c.toolName === 'search_content' && /\s/.test(c.arguments.query ?? ''))
      .map((c) => c.arguments.query),
    narrative:
      'BigHand public holidays session: agent used replace for partial edits 4+ times, ' +
      'recovered from read_note/transcript. Multi-word searches (e.g. "bighand FactPublicHoliday public holidays") ' +
      'would fail on upstream phrase search.',
  };

  const searchReadChains = [];
  for (let i = 0; i < calls.length - 1; i++) {
    const cur = calls[i];
    const next = calls[i + 1];
    if (cur.toolName !== 'search_content' || next.toolName !== 'read_note') continue;
    if (cur.sessionId !== next.sessionId) continue;
    searchReadChains.push({
      sessionId: cur.sessionId,
      query: cur.arguments.query,
      goldenPath: normaliseNotePath(next.arguments.path),
      limit: cur.arguments.limit ?? 50,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    corpusSize: calls.length,
    frictionCounts,
    topMcpSessions: topSessions,
    deepSessionAnalysis: deepAnalysis,
    searchReadChainCount: searchReadChains.length,
    taggedSample: tagged.slice(0, 5),
  };

  await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
  await fs.writeFile(
    path.join(REPO_ROOT, 'docs/validation/corpus/search-read-chains.json'),
    `${JSON.stringify(searchReadChains, null, 2)}\n`,
    'utf-8',
  );

  console.log(`Classified ${calls.length} calls → ${OUT}`);
  console.log('Friction counts:', frictionCounts);
  console.log('Top MCP sessions:', topSessions.slice(0, 5));
  console.log(`Deep session ${DEEP_SESSION}:`, deepAnalysis.byTool);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
