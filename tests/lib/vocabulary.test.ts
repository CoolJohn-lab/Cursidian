import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  VOCABULARY_RELATIVE_PATH,
  emptyVocabulary,
  parseVocabularyMarkdown,
  loadVocabulary,
  expandQueryTokens,
  upsertSynonymGroup,
  removeSynonymContaining,
  upsertPairing,
  removePairing,
  serializeVocabulary,
  defaultVocabularyContent,
} from '../../src/lib/vocabulary.js';

describe('parseVocabularyMarkdown', () => {
  it('returns empty vocabulary for empty/whitespace input', () => {
    expect(parseVocabularyMarkdown('')).toEqual(emptyVocabulary());
    expect(parseVocabularyMarkdown('   \n  ')).toEqual(emptyVocabulary());
  });

  it('parses synonyms and pairings from frontmatter', () => {
    const raw = `---
title: Wiki Vocabulary
synonyms:
  - [ingestion, ingest, "inbound source"]
pairings:
  integration: [ingestion, egress]
---

# Wiki Vocabulary
`;
    const vocab = parseVocabularyMarkdown(raw);
    expect(vocab.synonyms).toEqual([['ingestion', 'ingest', 'inbound source']]);
    expect(vocab.pairings).toEqual({ integration: ['ingestion', 'egress'] });
  });

  it('parses synonyms and pairings from a fenced yaml block', () => {
    const raw = `# Wiki Vocabulary

\`\`\`yaml
synonyms:
  - [egress, outbound, export]
pairings:
  orchestration: [pipeline, adf]
\`\`\`
`;
    const vocab = parseVocabularyMarkdown(raw);
    expect(vocab.synonyms).toEqual([['egress', 'outbound', 'export']]);
    expect(vocab.pairings).toEqual({ orchestration: ['pipeline', 'adf'] });
  });

  it('merges frontmatter and fenced block, deduplicating overlapping synonym groups', () => {
    const raw = `---
synonyms:
  - [ingestion, ingest]
pairings:
  integration: [ingestion]
---

\`\`\`yaml
synonyms:
  - [ingestion, ingest]
  - [egress, outbound]
pairings:
  integration: [egress]
  orchestration: [pipeline]
\`\`\`
`;
    const vocab = parseVocabularyMarkdown(raw);
    expect(vocab.synonyms).toEqual([
      ['ingestion', 'ingest'],
      ['egress', 'outbound'],
    ]);
    expect(vocab.pairings).toEqual({
      integration: ['ingestion', 'egress'],
      orchestration: ['pipeline'],
    });
  });

  it('lowercases and trims words, and drops single-member synonym groups', () => {
    const raw = `---
synonyms:
  - ["  Ingestion  ", "INGEST"]
  - [solo]
pairings:
  Integration: ["  Ingestion "]
---
`;
    const vocab = parseVocabularyMarkdown(raw);
    expect(vocab.synonyms).toEqual([['ingestion', 'ingest']]);
    expect(vocab.pairings).toEqual({ integration: ['ingestion'] });
  });

  it('ignores malformed frontmatter without throwing', () => {
    const raw = `---
title: [broken
---

body`;
    expect(() => parseVocabularyMarkdown(raw)).not.toThrow();
    expect(parseVocabularyMarkdown(raw)).toEqual(emptyVocabulary());
  });

  it('ignores malformed fenced yaml without throwing', () => {
    const raw = `# Vocab

\`\`\`yaml
synonyms: [not: valid: yaml: here
\`\`\`
`;
    expect(() => parseVocabularyMarkdown(raw)).not.toThrow();
    expect(parseVocabularyMarkdown(raw)).toEqual(emptyVocabulary());
  });

  it('drops non-array synonyms and non-object pairings', () => {
    const raw = `---
synonyms: "not an array"
pairings: "also not an object"
---
`;
    expect(parseVocabularyMarkdown(raw)).toEqual(emptyVocabulary());
  });
});

describe('loadVocabulary', () => {
  let vault: string;

  beforeAll(async () => {
    vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'cursidian-vocab-'));
  });

  afterAll(async () => {
    await fsp.rm(vault, { recursive: true, force: true });
  });

  it('returns empty vocabulary when the file is missing', async () => {
    const vocab = await loadVocabulary(vault);
    expect(vocab).toEqual(emptyVocabulary());
  });

  it('loads and parses an existing vocabulary file', async () => {
    const target = path.join(vault, VOCABULARY_RELATIVE_PATH);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(
      target,
      '---\nsynonyms:\n  - [ingestion, ingest]\npairings:\n  integration: [ingestion]\n---\n',
      'utf-8',
    );
    const vocab = await loadVocabulary(vault);
    expect(vocab.synonyms).toEqual([['ingestion', 'ingest']]);
    expect(vocab.pairings).toEqual({ integration: ['ingestion'] });
  });
});

describe('expandQueryTokens', () => {
  it('returns tokens unchanged when vocabulary is empty', () => {
    const result = expandQueryTokens(['integration'], emptyVocabulary());
    expect(result.tokens).toEqual(['integration']);
    expect(result.expandedFrom.size).toBe(0);
  });

  it('expands via a directional pairing', () => {
    const vocab = { synonyms: [], pairings: { integration: ['ingestion', 'egress'] } };
    const result = expandQueryTokens(['integration'], vocab);
    expect(result.tokens).toEqual(['integration', 'ingestion', 'egress']);
    expect(result.expandedFrom.get('ingestion')).toBe('integration');
    expect(result.expandedFrom.get('egress')).toBe('integration');
  });

  it('does not expand in reverse for a pairing (directional only)', () => {
    const vocab = { synonyms: [], pairings: { integration: ['ingestion'] } };
    const result = expandQueryTokens(['ingestion'], vocab);
    expect(result.tokens).toEqual(['ingestion']);
    expect(result.expandedFrom.size).toBe(0);
  });

  it('expands symmetrically via a synonym group', () => {
    const vocab = { synonyms: [['ingestion', 'ingest', 'inbound source']], pairings: {} };
    const result = expandQueryTokens(['ingest'], vocab);
    expect(result.tokens).toEqual(['ingest', 'ingestion', 'inbound source']);
    expect(result.expandedFrom.get('ingestion')).toBe('ingest');
    expect(result.expandedFrom.get('inbound source')).toBe('ingest');
  });

  it('does not mark an expansion as expanded when it duplicates a literal token', () => {
    const vocab = { synonyms: [['integration', 'ingestion']], pairings: {} };
    const result = expandQueryTokens(['integration', 'ingestion'], vocab);
    expect(result.tokens).toEqual(['integration', 'ingestion']);
    expect(result.expandedFrom.size).toBe(0);
  });

  it('is case-insensitive on both tokens and vocabulary', () => {
    const vocab = { synonyms: [], pairings: { integration: ['Ingestion'] } };
    const result = expandQueryTokens(['Integration'], vocab);
    expect(result.tokens).toContain('ingestion');
  });
});

describe('vocabulary mutation helpers', () => {
  it('upserts a synonym group, replacing any group that overlaps', () => {
    let vocab = emptyVocabulary();
    vocab = upsertSynonymGroup(vocab, ['ingestion', 'ingest']);
    expect(vocab.synonyms).toEqual([['ingestion', 'ingest']]);

    vocab = upsertSynonymGroup(vocab, ['ingest', 'inbound source']);
    expect(vocab.synonyms).toEqual([['ingest', 'inbound source']]);
  });

  it('throws when a synonym group has fewer than two distinct words', () => {
    expect(() => upsertSynonymGroup(emptyVocabulary(), ['solo'])).toThrow();
    expect(() => upsertSynonymGroup(emptyVocabulary(), ['same', 'same'])).toThrow();
  });

  it('removes a synonym group containing a term', () => {
    let vocab = upsertSynonymGroup(emptyVocabulary(), ['ingestion', 'ingest']);
    vocab = removeSynonymContaining(vocab, 'ingest');
    expect(vocab.synonyms).toEqual([]);
  });

  it('upserts and removes a pairing', () => {
    let vocab = upsertPairing(emptyVocabulary(), 'Integration', ['Ingestion', 'Egress']);
    expect(vocab.pairings).toEqual({ integration: ['ingestion', 'egress'] });

    vocab = removePairing(vocab, 'INTEGRATION');
    expect(vocab.pairings).toEqual({});
  });

  it('throws on empty pairing key or values', () => {
    expect(() => upsertPairing(emptyVocabulary(), '', ['x'])).toThrow();
    expect(() => upsertPairing(emptyVocabulary(), 'x', [])).toThrow();
  });
});

describe('serializeVocabulary', () => {
  it('round-trips through parseVocabularyMarkdown', () => {
    let vocab = emptyVocabulary();
    vocab = upsertSynonymGroup(vocab, ['ingestion', 'ingest']);
    vocab = upsertPairing(vocab, 'integration', ['ingestion', 'egress']);

    const serialized = serializeVocabulary(vocab);
    const reparsed = parseVocabularyMarkdown(serialized);
    expect(reparsed).toEqual(vocab);
  });

  it('preserves body content from a prior file', () => {
    const prior = defaultVocabularyContent();
    const vocab = upsertSynonymGroup(emptyVocabulary(), ['a', 'b']);
    const serialized = serializeVocabulary(vocab, prior);
    expect(serialized).toContain('Domain synonyms and word pairings');
  });
});
