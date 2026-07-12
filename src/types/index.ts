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

export type ToolName = 'note' | 'search' | 'graph' | 'vault';
export type ToolSideEffects = 'none' | 'rolled_back' | 'partial';

export interface ToolRecovery {
  tool: ToolName;
  arguments: Record<string, unknown>;
}

export interface ToolSuccessMetadata {
  action: string;
  changed: boolean;
  paths?: string[];
  warnings?: string[];
  operationId?: string;
  undoAvailable?: boolean;
}

/** Structured error payload returned by MCP tools (JSON text). */
export interface ToolErrorPayload {
  error: string;
  code?: string;
  message: string;
  action?: string;
  retryable?: boolean;
  sideEffects?: ToolSideEffects;
  path?: string;
  details?: Record<string, unknown>;
  recovery?: ToolRecovery;
  hint?: string;
}

export interface ToolErrorContext {
  tool: ToolName;
  action: string;
  path?: string;
  arguments?: Record<string, unknown>;
}

export function ok(data: unknown, metadata?: ToolSuccessMetadata): ToolResult {
  const payload =
    metadata === undefined
      ? data
      : {
          action: metadata.action,
          status: 'success',
          changed: metadata.changed,
          paths: metadata.paths ?? [],
          warnings: metadata.warnings ?? [],
          ...(metadata.operationId !== undefined ? { operationId: metadata.operationId } : {}),
          ...(metadata.undoAvailable !== undefined ? { undoAvailable: metadata.undoAvailable } : {}),
          ...(data as Record<string, unknown>),
        };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Returns a structured tool error as JSON text (preferred for agent consumption).
 */
export function toolError(payload: ToolErrorPayload): ToolResult {
  const normalized = {
    ...payload,
    code: payload.code ?? payload.error,
    action: payload.action ?? 'unknown',
    retryable: payload.retryable ?? false,
    sideEffects: payload.sideEffects ?? 'none',
    details: payload.details ?? {},
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(normalized, null, 2) }],
    isError: true,
  };
}

/**
 * Backward-compatible error helper - emits structured JSON with a generic code.
 */
export function err(message: string, code = 'error', extras?: Omit<ToolErrorPayload, 'error' | 'message'>): ToolResult {
  return toolError({ error: code, message, ...extras });
}

export function invalidArgsError(options: {
  tool: ToolName;
  action: string;
  message: string;
  required?: string[];
  missing?: string[];
  rejected?: string[];
  path?: string;
  arguments: Record<string, unknown>;
}): ToolResult {
  const required = options.required ?? [];
  const missing = options.missing ?? [];
  const rejected = options.rejected ?? [];
  return toolError({
    error: 'invalid_args',
    message: options.message,
    action: options.action,
    retryable: true,
    sideEffects: 'none',
    path: options.path,
    details: { required, missing, rejected },
    recovery: {
      tool: options.tool,
      arguments: options.arguments,
    },
    hint: `Retry ${options.tool} with the recovery arguments.`,
  });
}

export function validateActionArguments(options: {
  tool: ToolName;
  action: string;
  args: Record<string, unknown>;
  allowed: string[];
  required?: string[];
  path?: string;
}): ToolResult | null {
  const required = options.required ?? [];
  const missing = required.filter((name) => {
    const value = options.args[name];
    return value === undefined || value === null || value === '';
  });
  const rejected = Object.keys(options.args).filter(
    (name) =>
      name !== 'action' &&
      options.args[name] !== undefined &&
      !options.allowed.includes(name),
  );
  if (missing.length === 0 && rejected.length === 0) {
    return null;
  }

  const recoveryArguments: Record<string, unknown> = { action: options.action };
  for (const name of options.allowed) {
    if (options.args[name] !== undefined) {
      recoveryArguments[name] = options.args[name];
    } else if (required.includes(name)) {
      recoveryArguments[name] = `<${name}>`;
    }
  }

  const problems = [
    missing.length > 0 ? `missing required arguments: ${missing.join(', ')}` : '',
    rejected.length > 0 ? `arguments do not apply to action "${options.action}": ${rejected.join(', ')}` : '',
  ].filter(Boolean);

  return invalidArgsError({
    tool: options.tool,
    action: options.action,
    message: problems.join('; '),
    required,
    missing,
    rejected,
    path: options.path,
    arguments: recoveryArguments,
  });
}

/**
 * Maps thrown/caught exceptions to structured tool errors.
 */
export function mapToolError(e: unknown, context?: Partial<ToolErrorContext>): ToolResult {
  const pathHint = context?.path;
  const tool = context?.tool ?? 'note';
  const action = context?.action ?? 'unknown';
  const recoveryArguments = context?.arguments ?? {
    ...(action !== 'unknown' ? { action } : {}),
    ...(pathHint ? { path: pathHint } : {}),
  };
  const base = {
    action,
    sideEffects: 'none' as const,
  };

  if (e && typeof e === 'object' && 'name' in e) {
    const name = (e as { name: string }).name;
    const message = e instanceof Error ? e.message : String(e);

    if (name === 'SecurityError') {
      return toolError({
        error: 'path_traversal',
        message,
        ...base,
        retryable: true,
        path: pathHint,
        details: { rejectedPath: pathHint },
        recovery: { tool, arguments: recoveryArguments },
        hint: 'Use a vault-relative path that stays inside OBSIDIAN_VAULT_PATH.',
      });
    }

    if (name === 'ReadOnlyError') {
      return toolError({
        error: 'read_only',
        message,
        ...base,
        retryable: true,
        details: { configuration: 'OBSIDIAN_READ_ONLY' },
        recovery: { tool, arguments: recoveryArguments },
        hint: 'Set OBSIDIAN_READ_ONLY=false (or omit it) to allow writes.',
      });
    }

    if (name === 'FileTooLargeError') {
      return toolError({
        error: 'file_too_large',
        message,
        ...base,
        retryable: true,
        path: pathHint,
        details: {},
        recovery: { tool, arguments: recoveryArguments },
        hint: 'Reduce note size or raise OBSIDIAN_MAX_FILE_SIZE.',
      });
    }

    if (name === 'AlreadyExistsError') {
      return toolError({
        error: 'already_exists',
        message,
        ...base,
        retryable: true,
        path: pathHint,
        details: { existingPath: pathHint },
        recovery: { tool, arguments: recoveryArguments },
        hint: 'Use overwrite: true to replace, or choose a different path.',
      });
    }

    if (name === 'PartialUpdateError') {
      const completed =
        'completed' in e && Array.isArray((e as { completed: unknown }).completed)
          ? (e as { completed: string[] }).completed
          : [];
      const restored =
        'restored' in e && Array.isArray((e as { restored: unknown }).restored)
          ? (e as { restored: string[] }).restored
          : [];
      const unresolved =
        'unresolved' in e && Array.isArray((e as { unresolved: unknown }).unresolved)
          ? (e as { unresolved: string[] }).unresolved
          : 'failed' in e && Array.isArray((e as { failed: unknown }).failed)
            ? (e as { failed: string[] }).failed
            : [];
      return toolError({
        error: 'partial_update',
        message,
        ...base,
        retryable: false,
        sideEffects: 'partial',
        path: pathHint,
        details: { completed, restored, unresolved },
        recovery: { tool: 'vault', arguments: { action: 'health' } },
        hint: `Completed: ${completed.join(', ') || 'none'}. Restored: ${restored.join(', ') || 'none'}. Unresolved: ${unresolved.join(', ') || 'none'}.`,
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
        ...base,
        retryable: code === 'invalid_args' || code === 'not_found',
        path: pathHint,
        details: {},
        recovery: { tool, arguments: recoveryArguments },
        hint: `Retry ${tool} with the recovery arguments.`,
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
        ...base,
        retryable: true,
        path: pathHint,
        details: {
          required: [],
          missing: [],
          rejected: [],
          candidates: paths,
        },
        recovery: {
          tool,
          arguments: {
            ...recoveryArguments,
            path: paths[0] ?? pathHint ?? '<vault-relative-path>',
          },
        },
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
      ...base,
      retryable: true,
      path: pathHint,
      details: { missingPath: pathHint },
      recovery: {
        tool: 'search',
        arguments: { action: 'list' },
      },
      hint: 'Check the path with search (action list or content), then retry.',
    });
  }

  const message = e instanceof Error ? e.message : String(e);
  return toolError({
    error: 'internal_error',
    message,
    ...base,
    retryable: false,
    path: pathHint,
    details: {},
    recovery: { tool, arguments: recoveryArguments },
    hint: `Retry ${tool} only after reviewing the error.`,
  });
}
