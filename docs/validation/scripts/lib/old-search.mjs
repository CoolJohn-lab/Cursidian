import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

/**
 * Old-upstream search: substring match on full query string (no token-AND, no ranking).
 */
export async function searchOldUpstream(vaultPath, query, limit = 50) {
  const started = performance.now();
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: ['**/.obsidian-mcp-trash/**'],
  });

  const needle = query.toLowerCase();
  const results = [];

  for (const file of files) {
    if (results.length >= limit) break;
    const content = await fs.readFile(file, 'utf-8');
    if (!content.toLowerCase().includes(needle)) continue;

    const lines = content.split('\n');
    const snippets = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      snippets.push({ lineNumber: i + 1, line: lines[i].trim(), match: query });
      if (snippets.length >= 5) break;
    }

    results.push({
      path: path.relative(vaultPath, file),
      matchCount: snippets.length,
      snippets,
    });
  }

  return {
    query,
    totalMatches: results.length,
    results,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

/**
 * Old-patched search: token-AND semantics from DLZ obsidian-mcp-patch (no ranking).
 */
export async function searchOldPatched(vaultPath, query, limit = 50, caseSensitive = false) {
  const started = performance.now();
  const files = await fg('**/*.md', {
    cwd: vaultPath,
    absolute: true,
    dot: false,
    ignore: ['**/.obsidian-mcp-trash/**'],
  });

  const flags = caseSensitive ? 'g' : 'gi';
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const tokenNeedle = caseSensitive ? token : token.toLowerCase();
        return contentForMatch.includes(tokenNeedle);
      });
      if (!allTokensInFile) continue;
    }

    const snippets = [];
    for (let i = 0; i < lines.length; i += 1) {
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
          const tokenNeedle = caseSensitive ? token : token.toLowerCase();
          return lineForMatch.includes(tokenNeedle);
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

  return {
    query,
    totalMatches: results.length,
    results,
    latencyMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

/**
 * Computes p50 and p95 from an array of millisecond samples.
 */
export function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
