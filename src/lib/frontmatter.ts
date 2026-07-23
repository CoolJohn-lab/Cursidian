import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { assertParseableSize, MAX_FRONTMATTER_BYTES } from './limits.js';

export interface ParsedNote {
  data: Record<string, unknown>;
  content: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

/** Keys that must never be copied from untrusted YAML/object merges. */
export const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Returns a NEW object; never mutates `existing`. Recursively strips dangerous
 * keys from `incoming` at every depth. Non-plain values (arrays, primitives,
 * Dates from YAML) are copied by reference - only plain-object nesting recurses.
 */
export function sanitizeMergeSource(value: unknown, depth = 0): unknown {
  if (depth > 32) {
    throw new Error('Frontmatter nesting too deep (possible malicious input).');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_MERGE_KEYS.has(key)) {
      continue;
    }
    out[key] = sanitizeMergeSource((value as Record<string, unknown>)[key], depth + 1);
  }
  return out;
}

function parseYamlFrontmatter(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_FRONTMATTER_BYTES) {
    throw new Error(
      `Frontmatter block exceeds ${MAX_FRONTMATTER_BYTES} bytes. Split metadata or shorten keys.`,
    );
  }
  const parsed = parseYaml(raw, { prettyErrors: false });
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Frontmatter must be a YAML mapping (key: value), not a list or scalar.');
  }
  return { ...(sanitizeMergeSource(parsed) as Record<string, unknown>) };
}

export function parseFrontmatter(raw: string): ParsedNote {
  assertParseableSize(raw, 'Note source');
  if (!raw.startsWith('---')) {
    return { data: {}, content: raw };
  }

  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { data: {}, content: raw };
  }

  const data = parseYamlFrontmatter(match[1] ?? '');
  const content = match[2] ?? '';
  return { data, content };
}

export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
  if (Object.keys(data).length === 0) {
    return content;
  }
  const yamlBlock = stringifyYaml(data, { lineWidth: 0 }).trimEnd();
  if (Buffer.byteLength(yamlBlock, 'utf8') > MAX_FRONTMATTER_BYTES) {
    throw new Error(`Frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes after serialization.`);
  }
  const body = content.startsWith('\n') ? content : `\n${content}`;
  return `---\n${yamlBlock}\n---${body}`;
}

export function mergeFrontmatter(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const safeIncoming = sanitizeMergeSource(incoming) as Record<string, unknown>;
  return { ...existing, ...safeIncoming };
}

/**
 * Parses Obsidian-style aliases from frontmatter (string or string[]).
 */
export function parseAliases(data: Record<string, unknown>): string[] {
  const raw = data.aliases;
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((a): a is string => typeof a === 'string')
      .map((a) => a.trim())
      .filter(Boolean);
  }
  return [];
}
