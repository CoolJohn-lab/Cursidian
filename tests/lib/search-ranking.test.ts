import { describe, it, expect } from 'vitest';
import { rankSearchResults } from '../../src/lib/search-ranking.js';
import type { VaultIndex } from '../../src/lib/vault-index.js';

describe('rankSearchResults', () => {
  const index: VaultIndex = new Map([
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
    [
      'pipeline-inventory',
      {
        path: 'projects/demo/concepts/pipeline-inventory.md',
        basename: 'pipeline-inventory',
        title: 'Pipeline Inventory',
        tags: ['pipelines'],
        summary: 'Full pipeline inventory',
        aliases: [],
      },
    ],
  ]);

  it('ranks title match above body-only mention', () => {
    const ranked = rankSearchResults(
      [
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
          snippets: [{ lineNumber: 3, line: 'Mentions Widget Catalog in passing', match: 'Widget Catalog' }],
        },
      ],
      'Widget Catalog',
      false,
      index,
    );

    expect(ranked[0].path).toContain('widget-catalog');
    expect(ranked[0].relevanceScore).toBeGreaterThan(ranked[1].relevanceScore);
    expect(ranked[0].matchReasons).toContain('title-exact');
  });

  it('prefers orchestration page for pipeline orchestrator query via stem affinity', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/concepts/orchestration-and-pipelines.md',
          content:
            '---\ntitle: Orchestration and Pipelines\ntags: [pipelines, orchestration]\nsummary: Pipeline runners and Main Orchestrator\n---\n\nMain Orchestrator pipeline',
          matchCount: 4,
          snippets: [{ lineNumber: 5, line: 'Main Orchestrator pipeline', match: 'pipeline orchestrator' }],
        },
        {
          path: 'projects/demo/concepts/pipeline-inventory.md',
          content:
            '---\ntitle: Pipeline Inventory\ntags: [pipelines]\n---\n\nPipeline inventory with many pipeline mentions pipeline pipeline',
          matchCount: 12,
          snippets: [{ lineNumber: 5, line: 'Pipeline inventory', match: 'pipeline orchestrator' }],
        },
      ],
      'pipeline orchestrator',
      false,
      index,
    );

    expect(ranked[0].path).toContain('orchestration-and-pipelines');
  });

  it('prefers basename token hits over tag-only matches for multi-word queries', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/concepts/metastore-schema-evolution.md',
          content:
            '---\ntitle: Metastore Tables and Schema Evolution\ntags: [demo]\nsummary: Unity Catalog metastore tables\n---\n\nUnity Catalog metastore tables',
          matchCount: 10,
          snippets: [{ lineNumber: 5, line: 'Unity Catalog metastore tables', match: 'Unity Catalog metastore' }],
        },
        {
          path: 'projects/demo/concepts/naming.md',
          content: '---\ntitle: Naming\ntags: [unity-catalog]\n---\n\nunity catalog notes',
          matchCount: 4,
          snippets: [{ lineNumber: 5, line: 'unity catalog notes', match: 'Unity Catalog metastore' }],
        },
      ],
      'Unity Catalog metastore',
      false,
      index,
    );

    expect(ranked[0].path).toContain('metastore-schema-evolution');
  });

  it('boosts tag and summary matches for multi-word queries', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/skills/deployment-and-ci-cd.md',
          content:
            '---\ntitle: Deployment and CI/CD\ntags: [demo, deployment]\nsummary: Azure DevOps deployment pipelines\n---\n\nDeployment details',
          matchCount: 3,
          snippets: [{ lineNumber: 5, line: 'Deployment details', match: 'deployment ci' }],
        },
        {
          path: 'projects/demo/concepts/random.md',
          content: '---\ntitle: Random\n---\n\ndeployment and ci cd notes without summary',
          matchCount: 2,
          snippets: [{ lineNumber: 3, line: 'deployment and ci cd notes', match: 'deployment ci' }],
        },
      ],
      'deployment CI CD',
      false,
      index,
    );

    expect(ranked[0].path).toContain('deployment-and-ci-cd');
  });

  it('penalises operational hot.md unless title exact', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'hot.md',
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
      'acme',
      false,
      index,
    );

    expect(ranked[0].path).toContain('acme-data-product');
  });

  it('keeps focused compound-basename page above dilute hubs without a specificity floor', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/entities/office-coverage-matrix.md',
          content:
            '---\ntitle: Office Coverage Matrix\n---\n\n# Office Coverage Matrix\n\nOffice coverage Alpha Beta gaps documented here.',
          matchCount: 42,
          snippets: [],
        },
        {
          path: 'hot.md',
          content: '---\ntitle: Recent\n---\n\noffice coverage Alpha Beta scattered mentions',
          matchCount: 10,
          snippets: [],
        },
      ],
      'office coverage Alpha Beta',
      false,
      index,
    );

    expect(ranked[0].path).toContain('office-coverage-matrix');
    expect(ranked[0].relevanceScore).toBeGreaterThan(0);
    expect(ranked[0].matchReasons).not.toContain('specificity-floor');
    expect(ranked[0].matchReasons).not.toContain('entity-path');
  });

  it('prefers compound-basename entity over broad hub for multi-token product query', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/entities/fact-public-holiday.md',
          content:
            '---\ntitle: Fact Public Holiday\n---\n\n# Fact Public Holiday\n\npublic holiday Acme office coverage',
          matchCount: 8,
          snippets: [],
        },
        {
          path: 'projects/demo/concepts/acme-data-product.md',
          content:
            '---\ntitle: Acme Data Product\n---\n\n# Acme\n\npublic holiday integration overview with many incidental mentions public holiday public holiday',
          matchCount: 12,
          snippets: [],
        },
      ],
      'public holiday Acme',
      false,
      index,
    );

    expect(ranked[0].path).toContain('fact-public-holiday');
    expect(ranked[0].matchReasons).not.toContain('entity-path');
    expect(ranked[0].matchReasons).not.toContain('concept-path');
  });

  it('does not emit domain-specific or removed workaround match reason strings', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/entities/widget-catalog.md',
          content:
            '---\ntitle: Widget Catalog\n---\n\n# Widget Catalog\n\nAcme public holiday entity',
          matchCount: 5,
          snippets: [],
        },
      ],
      'Acme public holiday',
      false,
      index,
    );

    const forbiddenReasons = [
      'non-widget-penalty',
      'widget-intent',
      'holiday-widget-entity-boost',
      'public-holidays-intent',
      'orchestrator-intent',
      'entity-operational-floor',
      'entity-path',
      'concept-path',
      'skill-path',
      'specificity-floor',
    ];
    for (const reason of forbiddenReasons) {
      expect(ranked[0].matchReasons).not.toContain(reason);
    }
  });

  it('does not claim basename:wiki for a longer query token wikilink', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/cursidian/skills/extending-wiki-skills.md',
          content: '---\ntitle: Extending Wiki Skills\n---\n\nBody about skills.',
          matchCount: 1,
          snippets: [{ lineNumber: 3, line: 'Body about skills.', match: 'wiki' }],
        },
      ],
      'wikilink backlinks',
      false,
      index,
    );

    expect(ranked[0].matchReasons.some((r) => r === 'basename:wiki')).toBe(false);
    expect(ranked[0].matchReasons.some((r) => r.startsWith('basename:'))).toBe(false);
    expect(ranked[0].matchReasons.some((r) => r.startsWith('compound-basename'))).toBe(false);
    expect(ranked[0].matchReasons).not.toContain('title-word-match');
  });

  it('reports basename segment when the query token honestly matches', () => {
    const ranked = rankSearchResults(
      [
        {
          path: 'projects/demo/concepts/deployment-pipeline.md',
          content: '---\ntitle: Deployment Pipeline\n---\n\nBody about deployment.',
          matchCount: 1,
          snippets: [{ lineNumber: 3, line: 'Body about deployment.', match: 'deployment' }],
        },
      ],
      'deployment',
      false,
      index,
    );

    expect(ranked[0].matchReasons.some((r) => r === 'basename:deployment')).toBe(true);
  });
});
