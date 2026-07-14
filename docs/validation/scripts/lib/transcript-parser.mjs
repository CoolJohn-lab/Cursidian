import fs from 'node:fs/promises';
import path from 'node:path';

const TIMESTAMP_RE =
  /<timestamp>([^<]+)<\/timestamp>|"timestamp":"([^"]+)"/;

const MONTHS = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

/**
 * Parses human-readable Cursor transcript timestamps into ISO strings.
 */
export function parseTranscriptTimestamp(text) {
  const match = text.match(TIMESTAMP_RE);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;

  const human = raw.match(
    /(\w+),\s+(\w+)\s+(\d{1,2}),\s+(\d{4}),\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (human) {
    const [, , monthName, day, year, hour12, minute, ampm] = human;
    const month = MONTHS[monthName.toLowerCase()];
    if (month === undefined) return null;
    let hour = Number(hour12) % 12;
    if (ampm.toUpperCase() === 'PM') hour += 12;
    const date = new Date(Date.UTC(Number(year), month, Number(day), hour - 1, Number(minute)));
    return date.toISOString();
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Normalises note paths from MCP arguments for comparison.
 */
export function normaliseNotePath(notePath) {
  if (!notePath) return '';
  return notePath.replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase();
}

/**
 * Walks DLZ agent transcript folders and yields parsed JSONL records.
 */
export async function* walkTranscriptFiles(transcriptsRoot) {
  const entries = await fs.readdir(transcriptsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    const mainFile = path.join(transcriptsRoot, sessionId, `${sessionId}.jsonl`);
    try {
      const stat = await fs.stat(mainFile);
      yield { sessionId, filePath: mainFile, mtime: stat.mtime.toISOString(), kind: 'main' };
    } catch {
      // skip sessions without a main transcript
    }

    const subDir = path.join(transcriptsRoot, sessionId, 'subagents');
    try {
      const subEntries = await fs.readdir(subDir, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isFile() || !sub.name.endsWith('.jsonl')) continue;
        const subPath = path.join(subDir, sub.name);
        const stat = await fs.stat(subPath);
        yield {
          sessionId,
          subagentId: sub.name.replace(/\.jsonl$/, ''),
          filePath: subPath,
          mtime: stat.mtime.toISOString(),
          kind: 'subagent',
        };
      }
    } catch {
      // no subagents folder
    }
  }
}

/**
 * Extracts Obsidian MCP tool calls from a single transcript JSONL file.
 */
export async function extractMcpCallsFromFile(meta, sinceIso) {
  const raw = await fs.readFile(meta.filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const calls = [];
  let lineIndex = 0;
  let sessionTimestamp = meta.mtime;

  for (const line of lines) {
    lineIndex += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const textParts = [];
    const content = record.message?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'text' && typeof part.text === 'string') {
          textParts.push(part.text);
        }
      }
    } else if (typeof record.message?.content === 'string') {
      textParts.push(record.message.content);
    }

    const joined = textParts.join('\n');
    const ts = parseTranscriptTimestamp(joined);
    if (ts) sessionTimestamp = ts;

    if (sinceIso && sessionTimestamp < sinceIso) continue;

    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (part.type !== 'tool_use' || part.name !== 'CallMcpTool') continue;
      const input = part.input ?? {};
      if (input.server !== 'user-obsidian') continue;

      calls.push({
        sessionId: meta.sessionId,
        subagentId: meta.subagentId ?? null,
        transcriptKind: meta.kind,
        lineIndex,
        timestamp: sessionTimestamp,
        toolName: input.toolName,
        arguments: input.arguments ?? {},
        description: input.description ?? null,
      });
    }
  }

  return calls;
}

/**
 * Collects all Obsidian MCP calls from transcripts since a cutoff date.
 */
export async function extractCorpus(transcriptsRoot, sinceDate) {
  const sinceIso = sinceDate.toISOString();
  const allCalls = [];

  for await (const meta of walkTranscriptFiles(transcriptsRoot)) {
    const calls = await extractMcpCallsFromFile(meta, sinceIso);
    allCalls.push(...calls);
  }

  allCalls.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return allCalls;
}
