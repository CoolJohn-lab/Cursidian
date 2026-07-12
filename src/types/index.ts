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
 * Backward-compatible error helper - emits structured JSON with a generic code.
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

    if (name === 'FileTooLargeError') {
      return toolError({
        error: 'file_too_large',
        message,
        path: pathHint,
        hint: 'Reduce note size or raise OBSIDIAN_MAX_FILE_SIZE.',
      });
    }

    if (name === 'AlreadyExistsError') {
      return toolError({
        error: 'already_exists',
        message,
        path: pathHint,
        hint: 'Use overwrite: true to replace, or choose a different path.',
      });
    }

    if (name === 'PartialUpdateError') {
      const completed =
        'completed' in e && Array.isArray((e as { completed: unknown }).completed)
          ? (e as { completed: string[] }).completed
          : [];
      const failed =
        'failed' in e && Array.isArray((e as { failed: unknown }).failed)
          ? (e as { failed: string[] }).failed
          : [];
      return toolError({
        error: 'partial_update',
        message,
        path: pathHint,
        hint: `Completed: ${completed.join(', ') || 'none'}. Failed: ${failed.join(', ') || 'none'}.`,
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

    if (name === 'PathResolveError') {
      const paths =
        'paths' in e && Array.isArray((e as { paths: unknown }).paths)
          ? ((e as { paths: string[] }).paths)
          : [];
      return toolError({
        error: 'invalid_args',
        message,
        path: pathHint,
        hint:
          paths.length > 0
            ? `Disambiguate with a vault-relative path. Candidates: ${paths.join(', ')}`
            : 'Disambiguate with a vault-relative path.',
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
