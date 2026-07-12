import matter from 'gray-matter';

export interface ParsedNote {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedNote {
  const parsed = matter(raw);
  return {
    data: parsed.data as Record<string, unknown>,
    content: parsed.content,
  };
}

export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
  if (Object.keys(data).length === 0) return content;
  return matter.stringify(content, data);
}

export function mergeFrontmatter(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
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
    return raw.filter((a): a is string => typeof a === 'string').map((a) => a.trim()).filter(Boolean);
  }
  return [];
}
