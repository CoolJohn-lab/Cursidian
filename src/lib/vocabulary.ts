import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { readFileBounded } from './security.js';
import { MAX_CONTENT_BYTES } from './limits.js';

export const VOCABULARY_RELATIVE_PATH = '_meta/vocabulary.md';

/**
 * Domain vocabulary loaded from the vault: symmetric synonym groups (any member
 * expands to every other member) plus directional pairings (a key expands to its
 * listed values, but not the reverse - useful for broader/narrower relationships
 * like "integration" -> ["ingestion", "egress"]).
 */
export interface VaultVocabulary {
  synonyms: string[][];
  pairings: Record<string, string[]>;
}

export function emptyVocabulary(): VaultVocabulary {
  return { synonyms: [], pairings: {} };
}

const FENCED_YAML_RE = /```ya?ml\r?\n([\s\S]*?)```/i;

function normaliseWord(word: unknown): string | null {
  if (typeof word !== 'string') {
    return null;
  }
  const trimmed = word.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalises a `synonyms` YAML value into deduplicated, lowercased word groups.
 * Malformed entries (non-array, or fewer than two usable words) are dropped rather
 * than throwing - a broken vocabulary file must never break search.
 */
function normaliseSynonymGroups(raw: unknown): string[][] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const groups: string[][] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const words = [...new Set(entry.map(normaliseWord).filter((w): w is string => w !== null))];
    if (words.length >= 2) {
      groups.push(words);
    }
  }
  return groups;
}

/**
 * Normalises a `pairings` YAML value into a lowercased key -> value-list map.
 */
function normalisePairings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = normaliseWord(rawKey);
    if (!key || !Array.isArray(rawValue)) {
      continue;
    }
    const values = [...new Set(rawValue.map(normaliseWord).filter((w): w is string => w !== null))];
    if (values.length > 0) {
      result[key] = values;
    }
  }
  return result;
}

function synonymGroupKey(group: string[]): string {
  return [...group].sort().join('\u0000');
}

/**
 * Merges two vocabularies: synonym groups are deduplicated by their sorted member
 * set; pairing values are unioned per key.
 */
function mergeVocabularies(a: VaultVocabulary, b: VaultVocabulary): VaultVocabulary {
  const seenGroups = new Set(a.synonyms.map(synonymGroupKey));
  const synonyms = [...a.synonyms];
  for (const group of b.synonyms) {
    const key = synonymGroupKey(group);
    if (!seenGroups.has(key)) {
      seenGroups.add(key);
      synonyms.push(group);
    }
  }

  const pairings: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(a.pairings)) {
    pairings[key] = [...values];
  }
  for (const [key, values] of Object.entries(b.pairings)) {
    pairings[key] = pairings[key] ? [...new Set([...pairings[key], ...values])] : [...values];
  }

  return { synonyms, pairings };
}

/**
 * Parses vault vocabulary from either YAML frontmatter (`synonyms:` / `pairings:`
 * keys) or a fenced ```yaml block in the body - both are merged when present, so
 * hand-editors can use whichever is more convenient. Missing keys, malformed YAML,
 * or an entirely empty/missing file all resolve to `emptyVocabulary()` - never throws.
 */
export function parseVocabularyMarkdown(raw: string): VaultVocabulary {
  if (!raw || !raw.trim()) {
    return emptyVocabulary();
  }

  let result = emptyVocabulary();

  try {
    const { data, content } = parseFrontmatter(raw);
    if (Array.isArray(data.synonyms) || (data.pairings && typeof data.pairings === 'object')) {
      result = mergeVocabularies(result, {
        synonyms: normaliseSynonymGroups(data.synonyms),
        pairings: normalisePairings(data.pairings),
      });
    }

    const fencedMatch = content.match(FENCED_YAML_RE);
    if (fencedMatch) {
      try {
        const parsed = parseYaml(fencedMatch[1] ?? '', { prettyErrors: false });
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>;
          result = mergeVocabularies(result, {
            synonyms: normaliseSynonymGroups(p.synonyms),
            pairings: normalisePairings(p.pairings),
          });
        }
      } catch {
        // Malformed fenced YAML: keep whatever frontmatter already contributed.
      }
    }
  } catch {
    // Malformed frontmatter YAML: fall back to an empty vocabulary rather than throwing.
    return emptyVocabulary();
  }

  return result;
}

/**
 * Loads `_meta/vocabulary.md` from the vault. A missing file (the common case)
 * resolves to an empty vocabulary - never throws, so search degrades gracefully
 * when no vocabulary has been curated yet.
 */
export async function loadVocabulary(
  vaultPath: string,
  maxFileSize: number = MAX_CONTENT_BYTES,
): Promise<VaultVocabulary> {
  const resolved = path.resolve(vaultPath, VOCABULARY_RELATIVE_PATH);
  try {
    const raw = await readFileBounded(resolved, maxFileSize);
    return parseVocabularyMarkdown(raw);
  } catch {
    return emptyVocabulary();
  }
}

export interface ExpandedQueryTokens {
  /** Original tokens followed by newly-added expansion tokens (deduplicated). */
  tokens: string[];
  /** Maps each expansion token (lowercased) to the original token that introduced it. */
  expandedFrom: Map<string, string>;
}

/**
 * Expands query tokens using vault vocabulary: synonym groups expand symmetrically
 * (any member present pulls in every other member); pairings expand directionally
 * (a key present pulls in its values, not the reverse). Expansions are additive and
 * flagged in `expandedFrom` so callers can score them separately from literal hits.
 */
export function expandQueryTokens(tokens: string[], vocab: VaultVocabulary): ExpandedQueryTokens {
  const seen = new Set(tokens.map((t) => t.toLowerCase()));
  const resultTokens = [...tokens];
  const expandedFrom = new Map<string, string>();

  const addExpansion = (candidate: string, source: string): void => {
    const norm = candidate.trim().toLowerCase();
    if (!norm || seen.has(norm)) {
      return;
    }
    seen.add(norm);
    resultTokens.push(norm);
    expandedFrom.set(norm, source);
  };

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();

    for (const group of vocab.synonyms) {
      if (!group.includes(token)) {
        continue;
      }
      for (const member of group) {
        if (member !== token) {
          addExpansion(member, rawToken);
        }
      }
    }

    const paired = vocab.pairings[token];
    if (paired) {
      for (const value of paired) {
        addExpansion(value, rawToken);
      }
    }
  }

  return { tokens: resultTokens, expandedFrom };
}

export function defaultVocabularyContent(): string {
  const frontmatter = {
    title: 'Wiki Vocabulary',
    synonyms: [] as string[][],
    pairings: {} as Record<string, string[]>,
  };
  const body = `# Wiki Vocabulary

Domain synonyms and word pairings used to expand \`search\` queries. Edit via \`vault\` \`vocabulary\`
(\`vocabularyOperation\`: \`read\` / \`upsert\` / \`remove\`) rather than hand-editing this file.

- \`synonyms\`: groups of interchangeable terms, e.g. \`[ingestion, ingest, "inbound source"]\`.
- \`pairings\`: a term that should also pull in related-but-distinct terms, e.g. \`integration: [ingestion, egress]\`.
`;
  return stringifyFrontmatter(frontmatter, body);
}

/**
 * Adds or replaces a synonym group. Matching is by exact member set (order-insensitive);
 * a group sharing at least one member with `words` is replaced rather than duplicated.
 */
export function upsertSynonymGroup(vocab: VaultVocabulary, words: string[]): VaultVocabulary {
  const normalised = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  if (normalised.length < 2) {
    throw new Error('Synonym group requires at least two distinct words.');
  }
  const overlaps = (group: string[]) => group.some((w) => normalised.includes(w));
  const synonyms = [...vocab.synonyms.filter((g) => !overlaps(g)), normalised];
  return { ...vocab, synonyms };
}

/**
 * Removes any synonym group containing `term`.
 */
export function removeSynonymContaining(vocab: VaultVocabulary, term: string): VaultVocabulary {
  const target = term.trim().toLowerCase();
  return { ...vocab, synonyms: vocab.synonyms.filter((g) => !g.includes(target)) };
}

/**
 * Adds or replaces a pairing (key -> values).
 */
export function upsertPairing(
  vocab: VaultVocabulary,
  key: string,
  values: string[],
): VaultVocabulary {
  const normalisedKey = key.trim().toLowerCase();
  const normalisedValues = [...new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean))];
  if (!normalisedKey) {
    throw new Error('Pairing requires a non-empty key.');
  }
  if (normalisedValues.length === 0) {
    throw new Error('Pairing requires at least one value.');
  }
  return { ...vocab, pairings: { ...vocab.pairings, [normalisedKey]: normalisedValues } };
}

/**
 * Removes a pairing by key.
 */
export function removePairing(vocab: VaultVocabulary, key: string): VaultVocabulary {
  const normalisedKey = key.trim().toLowerCase();
  const pairings = { ...vocab.pairings };
  delete pairings[normalisedKey];
  return { ...vocab, pairings };
}

/**
 * Serializes vocabulary into `_meta/vocabulary.md`, preserving the body of an
 * existing file (`priorRaw`) so hand-written notes below the frontmatter survive.
 */
export function serializeVocabulary(vocab: VaultVocabulary, priorRaw?: string): string {
  const frontmatter = {
    title: 'Wiki Vocabulary',
    synonyms: vocab.synonyms,
    pairings: vocab.pairings,
  };
  if (priorRaw) {
    const { content } = parseFrontmatter(priorRaw);
    if (content.trim()) {
      return stringifyFrontmatter(frontmatter, content);
    }
  }
  const { content } = parseFrontmatter(defaultVocabularyContent());
  return stringifyFrontmatter(frontmatter, content);
}
