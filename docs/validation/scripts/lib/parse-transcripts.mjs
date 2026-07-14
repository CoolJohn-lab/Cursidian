import fs from 'node:fs/promises';
import path from 'node:path';

const TIMESTAMP_RE = /<timestamp>([^<]+)<\/timestamp>/;

/**
 * Parses a Cursor transcript timestamp string into a Date.
 */
export function parseTranscriptTimestamp(raw) {
  const match = raw.match(TIMESTAMP_RE);
  if (!match) return null;
  const parsed = Date.parse(match[1].trim());
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Recursively walks transcript JSON content blocks for tool_use entries.
 */
function collectToolUses(node, out) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectToolUses(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  if (node.type === 'tool_use' && node.name) {
    out.push(node);
    return;
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectToolUses(value, out);
  }
}

/**
 * Extracts the first user message timestamp from a transcript file.
 */
export async function getSessionStartDate(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.role !== 'user') continue;
    const text = row.message?.content?.find((c) => c.type === 'text')?.text ?? '';
    const date = parseTranscriptTimestamp(text);
    if (date) return date;
  }
  return null;
}

/**
 * Lists eligible DLZ transcript jsonl files within the date window.
 */
export async function listTranscriptFiles(transcriptsDir, sinceDate) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      if (full.includes('Obsidian-MCP-For-Cursor')) continue;
      const sessionStart = await getSessionStartDate(full);
      if (!sessionStart || sessionStart < sinceDate) continue;
      files.push(full);
    }
  }
  await walk(transcriptsDir);
  return files.sort();
}

/**
 * Parses one transcript into ordered MCP call records with follow-up context.
 */
export async function parseTranscriptCalls(filePath) {
  const transcriptId = path.basename(filePath, '.jsonl');
  const raw = await fs.readFile(filePath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  const records = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    let row;
    try {
      row = JSON.parse(lines[lineIdx]);
    } catch {
      continue;
    }
    if (row.role !== 'assistant') continue;

    const toolUses = [];
    collectToolUses(row.message?.content, toolUses);

    for (const tool of toolUses) {
      if (tool.name !== 'CallMcpTool') continue;
      const input = tool.input ?? {};
      if (input.server !== 'user-obsidian') continue;

      const followUp = extractFollowUp(lines, lineIdx);
      records.push({
        transcript_id: transcriptId,
        transcript_path: filePath,
        line_number: lineIdx + 1,
        toolName: input.toolName,
        arguments: input.arguments ?? {},
        description: input.description ?? null,
        line_context: followUp,
      });
    }
  }

  return records;
}

/**
 * Captures the next assistant/user actions after an MCP call for golden-label inference.
 */
function extractFollowUp(lines, startLineIdx) {
  const context = {
    next_mcp_calls: [],
    next_read_paths: [],
    same_turn_read_paths: [],
    next_tools: [],
    assistant_text_snippet: null,
  };

  // Same assistant turn may include parallel read_note after search_content.
  const sameRow = JSON.parse(lines[startLineIdx]);
  const sameTurnTools = [];
  collectToolUses(sameRow.message?.content, sameTurnTools);
  for (const tool of sameTurnTools) {
    if (tool.name === 'CallMcpTool' && tool.input?.server === 'user-obsidian') {
      if (tool.input.toolName === 'read_note' && tool.input.arguments?.path) {
        context.same_turn_read_paths.push(normaliseNotePath(tool.input.arguments.path));
      }
    }
  }

  for (let i = startLineIdx; i < Math.min(lines.length, startLineIdx + 12); i += 1) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (row.role === 'assistant') {
      const textBlock = row.message?.content?.find((c) => c.type === 'text')?.text;
      if (textBlock && !context.assistant_text_snippet) {
        context.assistant_text_snippet = textBlock.slice(0, 300).replace(/\s+/g, ' ');
      }
    }

    const toolUses = [];
    collectToolUses(row.message?.content, toolUses);
    for (const tool of toolUses) {
      if (tool.name === 'CallMcpTool' && tool.input?.server === 'user-obsidian') {
        context.next_mcp_calls.push({
          toolName: tool.input.toolName,
          arguments: tool.input.arguments ?? {},
        });
        if (tool.input.toolName === 'read_note' && tool.input.arguments?.path) {
          context.next_read_paths.push(normaliseNotePath(tool.input.arguments.path));
        }
      } else if (tool.name) {
        context.next_tools.push(tool.name);
      }
    }
    if (context.next_mcp_calls.length >= 3) break;
  }

  return context;
}

/**
 * Normalises vault-relative note paths for comparison.
 */
export function normaliseNotePath(notePath) {
  return String(notePath).replace(/\.md$/i, '').replace(/\\/g, '/').toLowerCase();
}

/**
 * Token overlap ratio between two search queries.
 */
export function queryTokenOverlap(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) shared += 1;
  }
  return shared / Math.min(tokensA.size, tokensB.size);
}
