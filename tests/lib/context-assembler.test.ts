import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { type Config } from '../../src/config.js';
import {
  assembleContext,
  expandContext,
  inferIntent,
  decodeContextCursor,
  InvalidContextCursorError,
} from '../../src/lib/context-assembler.js';
import { writeNote, cleanupVault } from '../tools/helpers.js';
import { clearAllSearchCaches } from '../../src/lib/vault-index.js';

async function makeConfig(overrides: Partial<Config> = {}): Promise<Config> {
  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-context-'));
  return {
    vaultPath: vault,
    readOnly: false,
    maxFileSize: 10_485_760,
    backupEnabled: false,
    logLevel: 'error',
    ...overrides,
  };
}

describe('inferIntent', () => {
  it('infers connection intent from relational phrasing', () => {
    expect(inferIntent('how are ingestion and egress related')).toBe('connection');
  });

  it('infers onboarding intent from getting-started phrasing', () => {
    expect(inferIntent('getting started with the DLZ platform')).toBe('onboarding');
  });

  it('infers troubleshoot intent from error phrasing', () => {
    expect(inferIntent('pipeline failed with a schema error')).toBe('troubleshoot');
  });

  it('infers ingest-prep intent from ingest phrasing', () => {
    expect(inferIntent('what should I know before ingesting a new source')).toBe('ingest-prep');
  });

  it('defaults to lookup', () => {
    expect(inferIntent('bighand integration contract fields')).toBe('lookup');
  });
});

describe('assembleContext', () => {
  let config: Config;

  beforeEach(async () => {
    config = await makeConfig();
  });

  afterEach(async () => {
    await cleanupVault(config.vaultPath);
    clearAllSearchCaches();
  });

  it('returns an empty low-confidence bundle for an empty query', async () => {
    const bundle = await assembleContext(config, { query: '   ' });
    expect(bundle.items).toEqual([]);
    expect(bundle.tokensUsed).toBe(0);
    expect(bundle.bundleConfidence).toBe(0);
    expect(bundle.warnings.length).toBeGreaterThan(0);
  });

  it('returns an empty bundle with a warning when nothing matches', async () => {
    await writeNote(config.vaultPath, 'unrelated.md', '---\ntitle: Unrelated\nsummary: Nothing relevant.\n---\n\nBody.');
    const bundle = await assembleContext(config, { query: 'zzz-nonexistent-topic-marker' });
    expect(bundle.items).toEqual([]);
    expect(bundle.warnings.some((w) => w.includes('No relevant pages'))).toBe(true);
  });

  it('prefers the frontmatter summary as the cheapest representation', async () => {
    await writeNote(
      config.vaultPath,
      'ingestion-overview.md',
      '---\ntitle: Ingestion Overview\nsummary: UniqueIngestMarker summary describing ingestion.\n---\n\n# Ingestion Overview\n\nUniqueIngestMarker body text that is much longer than the summary and repeats itself many times over to pad out the length considerably beyond the summary alone.\n',
    );
    // A tight budget covers the summary but not the promotion-to-body upgrade,
    // isolating the ladder's initial representation choice from later promotion.
    const bundle = await assembleContext(config, { query: 'UniqueIngestMarker', tokenBudget: 20 });
    expect(bundle.items.length).toBeGreaterThan(0);
    const item = bundle.items.find((i) => i.path.includes('ingestion-overview'));
    expect(item).toBeDefined();
    expect(item!.kind).toBe('summary');
    expect(item!.text).toContain('UniqueIngestMarker summary');
  });

  it('falls back to the best matching section when there is no summary', async () => {
    await writeNote(
      config.vaultPath,
      'sectioned.md',
      '---\ntitle: Sectioned Page\n---\n\n# Sectioned Page\n\nIntro text.\n\n## UniqueSectionMarker Details\n\nUniqueSectionMarker specific content lives here.\n\n## Other\n\nUnrelated other content.\n',
    );
    const bundle = await assembleContext(config, { query: 'UniqueSectionMarker', tokenBudget: 25 });
    const item = bundle.items.find((i) => i.path.includes('sectioned'));
    expect(item).toBeDefined();
    expect(item!.kind).toBe('section');
    expect(item!.text).toContain('UniqueSectionMarker specific content');
  });

  it('promotes the top primary hit to full body when leftover budget allows', async () => {
    await writeNote(
      config.vaultPath,
      'promote-me.md',
      '---\ntitle: Promote Me\nsummary: UniquePromoteMarker short summary.\n---\n\n# Promote Me\n\nUniquePromoteMarker full body text that is considerably longer than the short frontmatter summary above it.\n',
    );
    const bundle = await assembleContext(config, { query: 'UniquePromoteMarker', tokenBudget: 4000 });
    const item = bundle.items.find((i) => i.path.includes('promote-me'));
    expect(item).toBeDefined();
    expect(item!.kind).toBe('body');
    expect(item!.reasons).toContain('promoted-to-body');
    expect(item!.text).toContain('full body text');
  });

  it('falls back to body when there is no summary and no matching section', async () => {
    await writeNote(
      config.vaultPath,
      'plain-body.md',
      '---\ntitle: Plain Body\n---\n\nUniquePlainBodyMarker with no headings at all in this note body.\n',
    );
    const bundle = await assembleContext(config, { query: 'UniquePlainBodyMarker', tokenBudget: 4000 });
    const item = bundle.items.find((i) => i.path.includes('plain-body'));
    expect(item).toBeDefined();
    expect(item!.kind).toBe('body');
  });

  it('never exceeds the token budget', async () => {
    for (let i = 0; i < 6; i++) {
      await writeNote(
        config.vaultPath,
        `budget-note-${i}.md`,
        `---\ntitle: Budget Note ${i}\nsummary: UniqueBudgetMarker summary number ${i} repeated to add length. UniqueBudgetMarker summary number ${i} repeated to add length again for good measure.\n---\n\nBody ${i}.`,
      );
    }
    const bundle = await assembleContext(config, { query: 'UniqueBudgetMarker', tokenBudget: 40 });
    expect(bundle.tokensUsed).toBeLessThanOrEqual(40);
    expect(bundle.coverage.droppedForBudget.length).toBeGreaterThan(0);
  });

  it('surfaces staleness and provenance warnings from frontmatter', async () => {
    await writeNote(
      config.vaultPath,
      'stale-inferred.md',
      [
        '---',
        'title: Stale Inferred Page',
        'summary: UniqueStaleMarker summary text.',
        'updated: 2000-01-01T00:00:00.000Z',
        'provenance:',
        '  extracted: 1',
        '  inferred: 9',
        '---',
        '',
        'Body content.',
      ].join('\n'),
    );
    const bundle = await assembleContext(config, { query: 'UniqueStaleMarker', tokenBudget: 4000 });
    const item = bundle.items.find((i) => i.path.includes('stale-inferred'));
    expect(item).toBeDefined();
    expect(item!.staleDays).toBeGreaterThan(90);
    expect(item!.provenance).toEqual({ extracted: 1, inferred: 9, ambiguous: undefined });
    expect(bundle.warnings.some((w) => w.includes('not updated'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('inferred'))).toBe(true);
  });

  it('never strips inferred/ambiguous inline markers from item text', async () => {
    await writeNote(
      config.vaultPath,
      'marked-body.md',
      '---\ntitle: Marked Body\n---\n\n## UniqueMarkedSection\n\nUniqueMarkedSection fact ^[inferred] and another ^[ambiguous] claim.\n',
    );
    const bundle = await assembleContext(config, { query: 'UniqueMarkedSection', tokenBudget: 4000 });
    const item = bundle.items.find((i) => i.path.includes('marked-body'));
    expect(item).toBeDefined();
    expect(item!.text).toContain('^[inferred]');
    expect(item!.text).toContain('^[ambiguous]');
  });

  it('pulls in the contradiction counterpart and warns about it', async () => {
    await writeNote(
      config.vaultPath,
      'claim-a.md',
      '---\ntitle: Claim A\nsummary: UniqueContradictMarker claim A summary.\n---\n\n> Contradicts [[claim-b]]\n\nBody of claim A.',
    );
    await writeNote(
      config.vaultPath,
      'claim-b.md',
      '---\ntitle: Claim B\nsummary: The opposing claim B summary.\n---\n\nBody of claim B.',
    );
    const bundle = await assembleContext(config, { query: 'UniqueContradictMarker', tokenBudget: 4000 });
    expect(bundle.coverage.consideredPaths.some((p) => p.includes('claim-b'))).toBe(true);
    expect(bundle.warnings.some((w) => w.includes('Contradiction callout'))).toBe(true);
  });

  it('boosts skills/ pages for the troubleshoot intent', async () => {
    await writeNote(
      config.vaultPath,
      'skills/uniquetroubleshootmarker-playbook.md',
      '---\ntitle: UniqueTroubleshootMarker Playbook\nsummary: How to fix UniqueTroubleshootMarker failures.\n---\n\nPlaybook body.',
    );
    await writeNote(
      config.vaultPath,
      'concepts/uniquetroubleshootmarker-concept.md',
      '---\ntitle: UniqueTroubleshootMarker Concept\nsummary: Background on UniqueTroubleshootMarker.\n---\n\nConcept body.',
    );
    const bundle = await assembleContext(config, {
      query: 'UniqueTroubleshootMarker',
      intent: 'troubleshoot',
      tokenBudget: 4000,
    });
    const skillsItem = bundle.items.find((i) => i.path.startsWith('skills/'));
    expect(skillsItem).toBeDefined();
    expect(skillsItem!.reasons).toContain('troubleshoot-skills-boost');
  });

  it('deduplicates near-identical sections across pages, keeping the higher score', async () => {
    const sharedBody =
      'UniqueDedupMarker one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.';
    await writeNote(
      config.vaultPath,
      'dup-primary.md',
      `---\ntitle: Dup Primary UniqueDedupMarker\n---\n\n## UniqueDedupMarker Section\n\n${sharedBody}\n`,
    );
    await writeNote(
      config.vaultPath,
      'dup-secondary.md',
      `---\ntitle: Dup Secondary\n---\n\n## UniqueDedupMarker Section\n\n${sharedBody}\n`,
    );
    const bundle = await assembleContext(config, { query: 'UniqueDedupMarker', tokenBudget: 4000 });
    const paths = bundle.items.map((i) => i.path);
    const dupCount = paths.filter((p) => p.includes('dup-primary') || p.includes('dup-secondary')).length;
    expect(dupCount).toBe(1);
  });

  it('produces citations as wikilinks without the .md extension', async () => {
    await writeNote(
      config.vaultPath,
      'citeme.md',
      '---\ntitle: Cite Me\nsummary: UniqueCiteMarker summary.\n---\n\nBody.',
    );
    const bundle = await assembleContext(config, { query: 'UniqueCiteMarker', tokenBudget: 4000 });
    expect(bundle.citations.some((c) => c === '[[citeme]]')).toBe(true);
  });

  it('encodes a nextCursor that expand can decode and continue from', async () => {
    await writeNote(
      config.vaultPath,
      'expand-a.md',
      '---\ntitle: Expand A\nsummary: UniqueExpandMarker summary A.\n---\n\nBody A.',
    );
    await writeNote(
      config.vaultPath,
      'expand-b.md',
      '---\ntitle: Expand B\nsummary: UniqueExpandMarker summary B.\n---\n\nBody B.',
    );
    const first = await assembleContext(config, { query: 'UniqueExpandMarker', tokenBudget: 4000 });
    expect(first.nextCursor).toBeDefined();

    const decoded = decodeContextCursor(first.nextCursor!);
    expect(decoded.query).toBe('UniqueExpandMarker');
    expect(decoded.excludePaths.length).toBeGreaterThan(0);

    const expanded = await expandContext(config, first.nextCursor!, 4000);
    for (const path of expanded.coverage.consideredPaths) {
      expect(first.coverage.consideredPaths).not.toContain(path);
    }
  });

  it('rejects a malformed expand cursor', async () => {
    await expect(expandContext(config, 'not-a-real-cursor', 4000)).rejects.toThrow(InvalidContextCursorError);
  });

  it('boosts manifest-touched pages for the ingest-prep intent', async () => {
    await writeNote(
      config.vaultPath,
      'uniqueingestprepmarker-touched.md',
      '---\ntitle: UniqueIngestPrepMarker Touched\nsummary: A page the manifest says was touched by ingestion.\n---\n\nBody.',
    );
    await writeNote(
      config.vaultPath,
      'uniqueingestprepmarker-untouched.md',
      '---\ntitle: UniqueIngestPrepMarker Untouched\nsummary: A same-topic page the manifest does not mention.\n---\n\nBody.',
    );
    await writeNote(
      config.vaultPath,
      '_meta/manifest.md',
      [
        '---',
        'title: Ingest Manifest',
        '---',
        '',
        '## Sources',
        '',
        '- `/tmp/source.pdf` | ingested: 2026-07-12T16:00:00Z | pages: [[uniqueingestprepmarker-touched]]',
        '',
        '## Projects',
        '',
      ].join('\n'),
    );
    const bundle = await assembleContext(config, {
      query: 'UniqueIngestPrepMarker',
      intent: 'ingest-prep',
      tokenBudget: 4000,
    });
    const touched = bundle.items.find((i) => i.path.includes('touched'));
    expect(touched).toBeDefined();
    expect(touched!.reasons).toContain('manifest-touched');
  });

  it('degrades gracefully for ingest-prep when the manifest is missing', async () => {
    await writeNote(
      config.vaultPath,
      'uniqueingestprepnomanifest.md',
      '---\ntitle: No Manifest Page\nsummary: UniqueIngestPrepNoManifest summary.\n---\n\nBody.',
    );
    const bundle = await assembleContext(config, {
      query: 'UniqueIngestPrepNoManifest',
      intent: 'ingest-prep',
      tokenBudget: 4000,
    });
    expect(bundle.items.length).toBeGreaterThan(0);
    expect(bundle.items[0]!.reasons).not.toContain('manifest-touched');
  });

  it('enriches connection-intent bundles with one-hop neighbour notes', async () => {
    await writeNote(
      config.vaultPath,
      'uniqueconnectionmarker-hub.md',
      '---\ntitle: UniqueConnectionMarker Hub\nsummary: The hub page for UniqueConnectionMarker.\n---\n\nSee also [[uniqueconnectionmarker-neighbour]].',
    );
    await writeNote(
      config.vaultPath,
      'uniqueconnectionmarker-neighbour.md',
      '---\ntitle: Neighbour Page\nsummary: A linked neighbour with unrelated wording.\n---\n\nNeighbour body.',
    );
    const bundle = await assembleContext(config, {
      query: 'UniqueConnectionMarker',
      intent: 'connection',
      tokenBudget: 4000,
    });
    const neighbour = bundle.items.find((i) => i.path.includes('uniqueconnectionmarker-neighbour'));
    expect(neighbour).toBeDefined();
    expect(neighbour!.kind).toBe('neighbor-note');
    expect(neighbour!.reasons.some((r) => r.startsWith('neighbor-of:'))).toBe(true);
  });

  it('enriches onboarding-intent bundles with one-hop neighbour notes', async () => {
    await writeNote(
      config.vaultPath,
      'uniqueonboardingmarker-hub.md',
      '---\ntitle: UniqueOnboardingMarker Hub\nsummary: The onboarding hub for UniqueOnboardingMarker.\n---\n\nStart with [[uniqueonboardingmarker-neighbour]].',
    );
    await writeNote(
      config.vaultPath,
      'uniqueonboardingmarker-neighbour.md',
      '---\ntitle: Onboarding Neighbour\nsummary: A linked onboarding neighbour.\n---\n\nNeighbour body.',
    );
    const bundle = await assembleContext(config, {
      query: 'UniqueOnboardingMarker',
      intent: 'onboarding',
      tokenBudget: 4000,
    });
    const neighbour = bundle.items.find((i) => i.path.includes('uniqueonboardingmarker-neighbour'));
    expect(neighbour).toBeDefined();
    expect(neighbour!.kind).toBe('neighbor-note');
  });

  it('reports incomplete scans as a warning', async () => {
    await writeNote(
      config.vaultPath,
      'incomplete-marker.md',
      '---\ntitle: Incomplete Marker\nsummary: UniqueIncompleteMarker summary.\n---\n\nBody.',
    );
    const tinyConfig: Config = { ...config, maxFileSize: 1 };
    const bundle = await assembleContext(tinyConfig, { query: 'UniqueIncompleteMarker', tokenBudget: 4000 });
    expect(bundle.warnings.some((w) => w.includes('incomplete'))).toBe(true);
  });
});
