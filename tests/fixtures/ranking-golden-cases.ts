import type { RankOptions, SearchCandidate } from '../../src/lib/search-ranking.js';
import type { VaultIndex } from '../../src/lib/vault-index.js';

/**
 * Fixed inputs for the `scoreSearchCandidate` golden-regression fixture
 * (see `tests/fixtures/ranking-golden.json` and `tests/lib/search-ranking-golden.test.ts`).
 *
 * Shared between `scripts/generate-ranking-golden.mjs` (writes the fixture) and the
 * golden regression test (reads it) so both always score the exact same inputs.
 *
 * A couple of cases use dates computed relative to `Date.now()` (freshness) so the
 * fixture never goes stale/flaky with the passage of real time - only the *relative*
 * offset (e.g. "200 days ago") matters to the scorer.
 */

export interface RankingGoldenCase {
  name: string;
  query: string;
  caseSensitive: boolean;
  index: VaultIndex;
  candidates: SearchCandidate[];
  options?: RankOptions;
}

const sharedIndex: VaultIndex = new Map([
  [
    'widget-catalog',
    {
      path: 'projects/demo/entities/widget-catalog.md',
      basename: 'widget-catalog',
      title: 'Widget Catalog',
      tags: ['demo', 'entity'],
      summary: 'Canonical widget inventory table',
      aliases: [],
    },
  ],
  [
    'orchestration-and-pipelines',
    {
      path: 'projects/demo/concepts/orchestration-and-pipelines.md',
      basename: 'orchestration-and-pipelines',
      title: 'Orchestration and Pipelines',
      tags: ['pipelines', 'orchestration'],
      summary: 'Pipeline runners and Main Orchestrator',
      aliases: [],
    },
  ],
]);

const staleOldDate = () => new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
const staleRecentDate = () => new Date().toISOString();

export const RANKING_GOLDEN_CASES: RankingGoldenCase[] = [
  {
    name: 'title-exact-vs-body-mention',
    query: 'Widget Catalog',
    caseSensitive: false,
    index: sharedIndex,
    candidates: [
      {
        path: 'projects/demo/entities/widget-catalog.md',
        content: '---\ntitle: Widget Catalog\ntags: [demo]\n---\n\n# Widget Catalog\n\nDetails',
        matchCount: 2,
        snippets: [{ lineNumber: 3, line: '# Widget Catalog', match: 'Widget Catalog' }],
      },
      {
        path: 'projects/demo/concepts/other.md',
        content: '---\ntitle: Other\n---\n\nMentions Widget Catalog in passing',
        matchCount: 1,
        snippets: [
          { lineNumber: 3, line: 'Mentions Widget Catalog in passing', match: 'Widget Catalog' },
        ],
      },
    ],
  },
  {
    name: 'alias-and-stem-affinity',
    query: 'pipeline orchestrator',
    caseSensitive: false,
    index: sharedIndex,
    candidates: [
      {
        path: 'projects/demo/concepts/orchestration-and-pipelines.md',
        content:
          '---\ntitle: Orchestration and Pipelines\ntags: [pipelines, orchestration]\nsummary: Pipeline runners and Main Orchestrator\naliases: [Pipeline Orchestrator]\n---\n\nMain Orchestrator pipeline',
        matchCount: 4,
        snippets: [
          { lineNumber: 5, line: 'Main Orchestrator pipeline', match: 'pipeline orchestrator' },
        ],
      },
      {
        path: 'projects/demo/concepts/pipeline-inventory.md',
        content:
          '---\ntitle: Pipeline Inventory\ntags: [pipelines]\n---\n\nPipeline inventory with many pipeline mentions pipeline pipeline',
        matchCount: 12,
        snippets: [{ lineNumber: 5, line: 'Pipeline inventory', match: 'pipeline orchestrator' }],
      },
    ],
  },
  {
    name: 'compound-basename-vs-tag-only',
    query: 'Unity Catalog metastore',
    caseSensitive: false,
    index: sharedIndex,
    candidates: [
      {
        path: 'projects/demo/concepts/metastore-schema-evolution.md',
        content:
          '---\ntitle: Metastore Tables and Schema Evolution\ntags: [demo]\nsummary: Unity Catalog metastore tables\n---\n\nUnity Catalog metastore tables',
        matchCount: 10,
        snippets: [
          {
            lineNumber: 5,
            line: 'Unity Catalog metastore tables',
            match: 'Unity Catalog metastore',
          },
        ],
      },
      {
        path: 'projects/demo/concepts/naming.md',
        content: '---\ntitle: Naming\ntags: [unity-catalog]\n---\n\nunity catalog notes',
        matchCount: 4,
        snippets: [
          { lineNumber: 5, line: 'unity catalog notes', match: 'Unity Catalog metastore' },
        ],
      },
    ],
  },
  {
    name: 'operational-penalty-vs-focused-page',
    query: 'acme',
    caseSensitive: false,
    index: sharedIndex,
    candidates: [
      {
        path: 'index.md',
        content: '---\ntitle: Recent Activity\n---\n\nacme mentions everywhere acme acme',
        matchCount: 20,
        snippets: [{ lineNumber: 3, line: 'acme mentions', match: 'acme' }],
      },
      {
        path: 'projects/demo/concepts/acme-data-product.md',
        content: '---\ntitle: Acme Data Product\n---\n\n# Acme Data Product',
        matchCount: 3,
        snippets: [{ lineNumber: 3, line: '# Acme Data Product', match: 'acme' }],
      },
    ],
  },
  {
    name: 'generic-basename-penalty-vs-multi-signal',
    query: 'Main Orchestrator debug run failed for BigHand',
    caseSensitive: false,
    index: new Map(),
    candidates: [
      {
        path: 'journal/failed-office-cutover.md',
        content:
          '---\ntitle: Failed Office Cutover\ncategory: journal\ntags: [ticket]\nsummary: Unrelated ticket about an office move.\n---\n\nOffice cutover notes. Failed once.',
        matchCount: 2,
        snippets: [{ lineNumber: 5, line: 'Office cutover notes. Failed once.', match: 'failed' }],
      },
      {
        path: 'skills/troubleshooting-failed-loads.md',
        content:
          '---\ntitle: Troubleshooting Failed Loads\ncategory: skills\ntags: [troubleshoot, bighand]\nsummary: How to debug BigHand failed loads and Main Orchestrator errors.\n---\n\n# Troubleshooting Failed Loads\n\nBigHand feed failure runbook.',
        matchCount: 6,
        snippets: [
          { lineNumber: 6, line: 'BigHand feed failure runbook.', match: 'failed BigHand' },
        ],
      },
    ],
  },
  {
    name: 'vocab-expansion-ranks-below-literal',
    query: 'integration',
    caseSensitive: false,
    index: new Map(),
    candidates: [
      {
        path: 'projects/demo/concepts/integration-guide.md',
        content: '---\ntitle: Integration Guide\n---\n\n# Integration Guide\n\nIntegration steps.',
        matchCount: 2,
        snippets: [],
      },
      {
        path: 'projects/demo/concepts/ingestion-overview.md',
        content:
          '---\ntitle: Ingestion Overview\n---\n\n# Ingestion Overview\n\nIngestion details here.',
        matchCount: 2,
        snippets: [],
      },
    ],
    options: { expandedTokens: new Set(['ingestion']) },
  },
  {
    name: 'heading-and-proximity',
    query: 'deploy pipeline',
    caseSensitive: false,
    index: new Map(),
    candidates: [
      {
        path: 'projects/demo/concepts/deploy-notes.md',
        content:
          '---\ntitle: Random Notes\n---\n\n## Deploy pipeline\n\nDeploy pipeline steps happen quickly, right next to each other.',
        matchCount: 3,
        snippets: [],
      },
    ],
  },
  {
    name: 'hub-dilution-and-snippet-density',
    query: 'contract schema drift review',
    caseSensitive: false,
    index: new Map(),
    candidates: [
      {
        path: 'index.md',
        content:
          '---\ntitle: Recent Activity\n---\n\nContract schema drift review notes scattered contract schema drift review contract schema drift review contract schema drift review.',
        matchCount: 15,
        snippets: [],
      },
    ],
  },
  {
    name: 'freshness-verified-and-stale',
    query: 'widget',
    caseSensitive: false,
    index: new Map(),
    candidates: [
      {
        path: 'projects/demo/concepts/widget-verified.md',
        content: `---\ntitle: Widget Verified\nlifecycle: verified\nupdated: ${staleRecentDate()}\n---\n\nWidget details.`,
        matchCount: 1,
        snippets: [],
      },
      {
        path: 'projects/demo/concepts/widget-old.md',
        content: `---\ntitle: Widget Old\nupdated: ${staleOldDate()}\n---\n\nWidget details.`,
        matchCount: 1,
        snippets: [],
      },
      {
        path: 'projects/demo/concepts/widget-bare.md',
        content: '---\ntitle: Widget Bare\n---\n\nWidget details.',
        matchCount: 1,
        snippets: [],
      },
    ],
  },
];
