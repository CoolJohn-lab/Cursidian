import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Upstream istrejo/obsidian-mcp search: exact phrase regex on each line.
 */
export async function searchUpstream(vaultPath, query, { caseSensitive = false, limit = 50 } = {}) {
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: ['**/.obsidian-mcp-trash/**'],
  });

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(query), flags);
  const results = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');
    const snippets = [];

    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      const match = regex.exec(lines[i]);
      if (match) {
        snippets.push({ lineNumber: i + 1, line: lines[i].trim(), match: match[0] });
      }
    }

    if (snippets.length > 0) {
      results.push({
        path: path.relative(vaultPath, file),
        matchCount: snippets.length,
        snippets: snippets.slice(0, 5),
      });
    }
  }

  return { query, totalMatches: results.length, results };
}

/**
 * DLZ patched search: token-AND semantics without relevance ranking.
 */
export async function searchPatched(vaultPath, query, { caseSensitive = false, limit = 50 } = {}) {
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: ['**/.obsidian-mcp-trash/**'],
  });

  const flags = caseSensitive ? 'g' : 'gi';
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const phraseRegex = tokens.length === 1 ? new RegExp(escapeRegex(tokens[0]), flags) : null;
  const results = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');

    if (tokens.length > 1) {
      const contentForMatch = caseSensitive ? content : content.toLowerCase();
      const allTokensInFile = tokens.every((token) => {
        const needle = caseSensitive ? token : token.toLowerCase();
        return contentForMatch.includes(needle);
      });
      if (!allTokensInFile) continue;
    }

    const snippets = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let matchText = '';
      if (phraseRegex) {
        phraseRegex.lastIndex = 0;
        const match = phraseRegex.exec(line);
        if (!match) continue;
        matchText = match[0];
      } else {
        const lineForMatch = caseSensitive ? line : line.toLowerCase();
        const hasTokenOnLine = tokens.some((token) => {
          const needle = caseSensitive ? token : token.toLowerCase();
          return lineForMatch.includes(needle);
        });
        if (!hasTokenOnLine) continue;
        matchText = tokens.join(' ');
      }
      snippets.push({ lineNumber: i + 1, line: line.trim(), match: matchText });
    }

    if (snippets.length > 0) {
      results.push({
        path: path.relative(vaultPath, file),
        matchCount: snippets.length,
        snippets: snippets.slice(0, 5),
      });
    }
  }

  return { query, totalMatches: results.length, results };
}

/**
 * Runs search via the current dist MCP tool handler (new baseline).
 */
export async function searchNew(repoRoot, query, { caseSensitive = false, limit = 50 } = {}) {
  const { createTestServer, callTool, parseResult, resetCaches } = await import(
    path.join(repoRoot, 'scripts/test-lib.mjs')
  );
  resetCaches();
  const { server } = createTestServer();
  const result = parseResult(
    await callTool(server, 'search_content', { query, caseSensitive, limit }),
  );
  return result;
}

/**
 * Returns top-1 path from search results, normalised.
 */
export function top1Path(searchResult) {
  const first = searchResult.results?.[0]?.path;
  return first ? first.replace(/\.md$/i, '') : null;
}
