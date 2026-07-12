import { createHash } from 'node:crypto';

/**
 * Computes a SHA-256 hash of note body content (excluding frontmatter).
 * Used for optimistic concurrency checks between read_note and update_note.
 */
export function computeContentHash(body: string): string {
  // Hash the raw body bytes so agents can detect concurrent edits reliably.
  return createHash('sha256').update(body, 'utf8').digest('hex');
}
