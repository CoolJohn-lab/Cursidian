import { createHash } from 'node:crypto';

const DEPRECATED_HASH_WARNING =
  'expectedHash is deprecated; use expectedRevision from note read instead.';

/**
 * Computes a SHA-256 hash of note body content (excluding frontmatter).
 * Used for optimistic concurrency checks between note read and note update.
 */
export function computeContentHash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/**
 * Computes a SHA-256 hash of the full note file (frontmatter and body).
 */
export function computeRevisionHash(rawFileText: string): string {
  return createHash('sha256').update(rawFileText, 'utf8').digest('hex');
}

export type RevisionCheckResult =
  | { ok: true; warnings?: string[] }
  | {
      ok: false;
      message: string;
      hint: string;
      check: 'revision' | 'content_hash';
      currentRevision?: string;
      currentHash?: string;
    };

export function checkRevisionConcurrency(options: {
  raw: string;
  body: string;
  expectedRevision?: string;
  expectedHash?: string;
}): RevisionCheckResult {
  const warnings: string[] = [];

  if (options.expectedHash !== undefined) {
    warnings.push(DEPRECATED_HASH_WARNING);
  }

  if (options.expectedRevision !== undefined) {
    const currentRevision = computeRevisionHash(options.raw);
    if (options.expectedRevision !== currentRevision) {
      return {
        ok: false,
        check: 'revision',
        currentRevision,
        message:
          'Note has changed since read (revision mismatch). Re-read the note and retry with the latest revisionHash.',
        hint: 'Call note with action read again, then pass the fresh revisionHash as expectedRevision. Or use details.currentRevision from this error for frontmatter-only / replace retries.',
      };
    }
    return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
  }

  if (options.expectedHash !== undefined) {
    const currentHash = computeContentHash(options.body);
    if (options.expectedHash !== currentHash) {
      return {
        ok: false,
        check: 'content_hash',
        currentHash,
        currentRevision: computeRevisionHash(options.raw),
        message:
          'Note content has changed since read (hash mismatch). Re-read the note and retry with the latest contentHash.',
        hint: 'Call note with action read again, then pass the fresh contentHash as expectedHash.',
      };
    }
    return { ok: true, warnings };
  }

  return { ok: true };
}

/** Shared details payload for hash_mismatch tool errors. */
export function hashMismatchDetails(
  revisionCheck: Extract<RevisionCheckResult, { ok: false }>,
): Record<string, unknown> {
  return {
    conflictKind: 'revision' as const,
    check: revisionCheck.check,
    ...(revisionCheck.currentRevision ? { currentRevision: revisionCheck.currentRevision } : {}),
    ...(revisionCheck.currentHash ? { currentHash: revisionCheck.currentHash } : {}),
  };
}
