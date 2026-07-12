export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ScanMetadata {
  incomplete: boolean;
  skipped: SkippedFile[];
}

export function scanMetadataFromSkipped(skipped: SkippedFile[]): ScanMetadata {
  return {
    incomplete: skipped.length > 0,
    skipped,
  };
}

interface SignatureCursorPayload {
  v: 1;
  signature: string;
  marker: string;
}

export class StaleCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleCursorError';
  }
}

export function encodeSignatureCursor(signature: string, marker: string): string {
  const payload: SignatureCursorPayload = { v: 1, signature, marker };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeSignatureCursor(cursor: string): SignatureCursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as SignatureCursorPayload;
    if (
      parsed.v !== 1 ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.marker !== 'string'
    ) {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw new StaleCursorError(
      'Invalid or stale cursor. Rerun from the first page without a cursor.',
    );
  }
}

export function resolveCursorMarker(
  cursor: string | undefined,
  currentSignature: string,
): string | null {
  if (!cursor) {
    return null;
  }
  const parsed = decodeSignatureCursor(cursor);
  if (parsed.signature !== currentSignature) {
    throw new StaleCursorError(
      'Cursor was issued against an older vault snapshot. Rerun from the first page without a cursor.',
    );
  }
  return parsed.marker;
}

export function paginateByPath<T extends { path: string }>(
  items: T[],
  pageSize: number,
  marker: string | null,
  signature: string,
): {
  page: T[];
  truncated: boolean;
  nextCursor?: string;
  totalMatches: number;
} {
  const startIndex =
    marker !== null ? Math.max(0, items.findIndex((item) => item.path === marker) + 1) : 0;
  const page = items.slice(startIndex, startIndex + pageSize);
  const truncated = startIndex + pageSize < items.length;
  const nextCursor =
    truncated && page.length > 0
      ? encodeSignatureCursor(signature, page[page.length - 1]!.path)
      : undefined;
  return {
    page,
    truncated,
    nextCursor,
    totalMatches: items.length,
  };
}
