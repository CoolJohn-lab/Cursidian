export interface NoteMetadata {
  path: string;
  name: string;
  size: number;
  mtime: string;
}

export interface NoteContent extends NoteMetadata {
  frontmatter: Record<string, unknown>;
  content: string;
}

export interface SearchSnippet {
  line: string;
  lineNumber: number;
  match?: string;
}

export interface SearchResult {
  path: string;
  matchCount?: number;
  snippets?: SearchSnippet[];
  relevanceScore?: number;
  matchReasons?: string[];
  title?: string;
  summary?: string;
  tags?: string[];
}

export interface CompactSearchResult {
  path: string;
  title?: string;
  summary?: string;
  tags?: string[];
  relevanceScore?: number;
}

export interface GraphNode {
  id: string;
  title: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface BacklinkResult {
  path: string;
  wikilinks: string[];
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/** Structured error payload returned by MCP tools (JSON text). */
export interface ToolErrorPayload {
  error: string;
  message: string;
  path?: string;
  hint?: string;
}

export function ok(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Returns a structured tool error as JSON text (preferred for agent consumption).
 */
export function toolError(payload: ToolErrorPayload): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
  };
}

/**
 * Backward-compatible error helper — emits structured JSON with a generic code.
 */
export function err(message: string, code = 'error', extras?: Omit<ToolErrorPayload, 'error' | 'message'>): ToolResult {
  return toolError({ error: code, message, ...extras });
}

/**
 * Maps thrown/caught exceptions to structured tool errors.
 */
export function mapToolError(e: unknown, context?: { path?: string }): ToolResult {
  const pathHint = context?.path;

  if (e && typeof e === 'object' && 'name' in e) {
    const name = (e as { name: string }).name;
    const message = e instanceof Error ? e.message : String(e);

    if (name === 'SecurityError') {
      return toolError({
        error: 'path_traversal',
        message,
        path: pathHint,
        hint: 'Use a vault-relative path that stays inside OBSIDIAN_VAULT_PATH.',
      });
    }

    if (name === 'ReadOnlyError') {
      return toolError({
        error: 'read_only',
        message,
        hint: 'Set OBSIDIAN_READ_ONLY=false (or omit it) to allow writes.',
      });
    }

    if (name === 'SectionEditError') {
      const code =
        'code' in e && typeof (e as { code: unknown }).code === 'string'
          ? (e as { code: string }).code
          : 'internal_error';
      return toolError({
        error: code,
        message,
        path: pathHint,
      });
    }
  }

  if (e && typeof e === 'object' && 'code' in e && (e as { code: unknown }).code === 'ENOENT') {
    const message = e instanceof Error ? e.message : String(e);
    return toolError({
      error: 'note_not_found',
      message: pathHint ? `Note not found: ${pathHint}` : message,
      path: pathHint,
      hint: 'Check the path with search (action list or content), then retry.',
    });
  }

  const message = e instanceof Error ? e.message : String(e);
  return toolError({
    error: 'internal_error',
    message,
    path: pathHint,
  });
}
