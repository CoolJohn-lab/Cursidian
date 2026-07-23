import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { MAX_LIST_LIMIT } from './limits.js';

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

export interface SignaturePathFingerprint {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export type SignaturePathChange = 'added' | 'removed' | 'modified';

export interface ChangedSignaturePath {
  path: string;
  change: SignaturePathChange;
  before?: SignaturePathFingerprint;
  after?: SignaturePathFingerprint;
}

export interface StaleCursorDetails {
  changedPathCount: number;
  changedPathsTruncated: boolean;
  cursorSignatureFingerprint: string;
  currentSignatureFingerprint: string;
  changedPaths: ChangedSignaturePath[];
}

const CHANGED_PATHS_CAP = 25;
const MAX_CURSOR_BYTES = 8 * 1024;

export class StaleCursorError extends Error {
  details?: StaleCursorDetails;

  constructor(message: string, details?: StaleCursorDetails) {
    super(message);
    this.name = 'StaleCursorError';
    this.details = details;
  }
}

function cursorKey(signature: string): Buffer {
  return createHash('sha256').update(`cursor-mac-v1\0${signature}`).digest();
}

export function encodeSignatureCursor(signature: string, marker: string): string {
  const body = JSON.stringify({ v: 1, signature, marker } satisfies SignatureCursorPayload);
  const mac = createHmac('sha256', cursorKey(signature)).update(body).digest('base64url');
  return Buffer.from(JSON.stringify({ b: body, m: mac }), 'utf8').toString('base64url');
}

export function decodeSignatureCursor(cursor: string): SignatureCursorPayload {
  if (Buffer.byteLength(cursor, 'utf8') > MAX_CURSOR_BYTES) {
    throw new StaleCursorError('Cursor too large; rerun from the first page without a cursor.');
  }
  try {
    const outer = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      b: string;
      m: string;
    };
    if (typeof outer.b !== 'string' || typeof outer.m !== 'string') {
      throw new Error('shape');
    }
    const parsed = JSON.parse(outer.b) as SignatureCursorPayload;
    if (
      parsed.v !== 1 ||
      typeof parsed.signature !== 'string' ||
      typeof parsed.marker !== 'string'
    ) {
      throw new Error('shape');
    }
    const expected = createHmac('sha256', cursorKey(parsed.signature))
      .update(outer.b)
      .digest('base64url');
    const got = Buffer.from(outer.m, 'base64url');
    const exp = Buffer.from(expected, 'base64url');
    if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
      throw new Error('mac');
    }
    return parsed;
  } catch (err) {
    if (err instanceof StaleCursorError) {
      throw err;
    }
    throw new StaleCursorError(
      'Invalid or stale cursor. Rerun from the first page without a cursor.',
    );
  }
}

function fingerprintSignature(signature: string): string {
  return createHash('sha256').update(signature).digest('hex').slice(0, 16);
}

function parseSignatureEntries(signature: string): Map<string, SignaturePathFingerprint> {
  const entries = new Map<string, SignaturePathFingerprint>();
  if (!signature) {
    return entries;
  }
  for (const line of signature.split('\n')) {
    if (!line) {
      continue;
    }
    const parts = line.split('\0');
    if (parts.length !== 4) {
      continue;
    }
    const [absolute, mtimeRaw, sizeRaw, contentHash] = parts;
    if (!absolute || mtimeRaw === undefined || sizeRaw === undefined || contentHash === undefined) {
      continue;
    }
    entries.set(absolute, {
      mtimeMs: Number(mtimeRaw),
      size: Number(sizeRaw),
      contentHash,
    });
  }
  return entries;
}

function toVaultRelative(absolute: string, vaultPath: string): string {
  return path.relative(vaultPath, absolute).split(path.sep).join('/');
}

export function diffVaultSignatures(
  cursorSig: string,
  currentSig: string,
  vaultPath: string,
): StaleCursorDetails {
  const before = parseSignatureEntries(cursorSig);
  const after = parseSignatureEntries(currentSig);
  const allPaths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changedPaths: ChangedSignaturePath[] = [];

  for (const absolute of allPaths) {
    const prior = before.get(absolute);
    const next = after.get(absolute);
    const relative = toVaultRelative(absolute, vaultPath);

    if (prior && !next) {
      changedPaths.push({ path: relative, change: 'removed', before: prior });
      continue;
    }
    if (!prior && next) {
      changedPaths.push({ path: relative, change: 'added', after: next });
      continue;
    }
    if (
      prior &&
      next &&
      (prior.mtimeMs !== next.mtimeMs ||
        prior.size !== next.size ||
        prior.contentHash !== next.contentHash)
    ) {
      changedPaths.push({ path: relative, change: 'modified', before: prior, after: next });
    }
  }

  const changedPathCount = changedPaths.length;
  return {
    changedPathCount,
    changedPathsTruncated: changedPathCount > CHANGED_PATHS_CAP,
    cursorSignatureFingerprint: fingerprintSignature(cursorSig),
    currentSignatureFingerprint: fingerprintSignature(currentSig),
    changedPaths: changedPaths.slice(0, CHANGED_PATHS_CAP),
  };
}

export function resolveCursorMarker(
  cursor: string | undefined,
  currentSignature: string,
  options?: { vaultPath: string },
): string | null {
  if (!cursor) {
    return null;
  }
  const parsed = decodeSignatureCursor(cursor);
  if (parsed.signature !== currentSignature) {
    const details = options?.vaultPath
      ? diffVaultSignatures(parsed.signature, currentSignature, options.vaultPath)
      : undefined;
    throw new StaleCursorError(
      'Cursor was issued against an older vault snapshot. Rerun from the first page without a cursor.',
      details,
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
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_LIST_LIMIT) {
    throw new Error(`pageSize must be an integer between 1 and ${MAX_LIST_LIMIT}`);
  }

  let startIndex = 0;
  if (marker !== null) {
    const found = items.findIndex((item) => item.path === marker);
    if (found === -1) {
      throw new StaleCursorError(
        'Cursor marker no longer present in the result set (vault changed). Rerun from the first page.',
      );
    }
    startIndex = found + 1;
  }
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
