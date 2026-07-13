import path from 'node:path';
import fs from 'node:fs/promises';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class ReadOnlyError extends Error {
  constructor() {
    super('Vault is in read-only mode. This operation is not permitted.');
    this.name = 'ReadOnlyError';
  }
}

export class FileTooLargeError extends Error {
  readonly code = 'file_too_large';

  constructor(size: number, maxBytes: number) {
    super(
      `File size ${size} bytes exceeds the limit of ${maxBytes} bytes (${(maxBytes / 1_048_576).toFixed(1)} MB).`,
    );
    this.name = 'FileTooLargeError';
  }
}

export function assertSafePath(vaultPath: string, resolvedPath: string): void {
  const relative = path.relative(vaultPath, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SecurityError(
      `Path escapes vault boundaries: "${resolvedPath}". All paths must remain within the vault.`,
    );
  }
}

function assertRealPathInsideVault(realVault: string, realPath: string, displayPath: string): void {
  const relative = path.relative(realVault, realPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SecurityError(
      `Symlink-based path traversal detected: "${displayPath}" resolves outside the vault.`,
    );
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function assertPositiveMaxBytes(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid max file size: ${maxBytes}. Must be a positive finite number.`);
  }
}

/**
 * Walks upward from resolvedPath until an existing filesystem entry is found.
 * Used when the target path does not exist yet (e.g. create_note).
 */
export async function findExistingAncestor(resolvedPath: string): Promise<string> {
  let cursor = path.resolve(resolvedPath);
  const root = path.parse(cursor).root;

  while (true) {
    try {
      await fs.lstat(cursor);
      return cursor;
    } catch (err) {
      if (!isEnoent(err)) {
        throw err;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor || parent === root) {
        throw new SecurityError(
          `No existing ancestor found for path "${resolvedPath}" within the filesystem.`,
        );
      }
      cursor = parent;
    }
  }
}

export async function assertSafePathAsync(vaultPath: string, resolvedPath: string): Promise<void> {
  assertSafePath(vaultPath, resolvedPath);

  const realVault = await fs.realpath(vaultPath);
  const normalized = path.resolve(resolvedPath);

  let anchorPath: string;
  try {
    await fs.lstat(normalized);
    anchorPath = normalized;
  } catch (err) {
    if (!isEnoent(err)) {
      throw err;
    }
    anchorPath = await findExistingAncestor(normalized);
  }

  const realAnchor = await fs.realpath(anchorPath);
  assertRealPathInsideVault(realVault, realAnchor, resolvedPath);
}

/** Alias for write-path validation before any mutation. */
export async function assertWritablePathAsync(
  vaultPath: string,
  resolvedPath: string,
): Promise<void> {
  await assertSafePathAsync(vaultPath, resolvedPath);
}

export function assertNotReadOnly(readOnly: boolean): void {
  if (readOnly) {
    throw new ReadOnlyError();
  }
}

export function assertContentSize(content: string, maxBytes: number): void {
  assertPositiveMaxBytes(maxBytes);
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > maxBytes) {
    throw new FileTooLargeError(bytes, maxBytes);
  }
}

export async function assertFileSize(filePath: string, maxBytes: number): Promise<void> {
  assertPositiveMaxBytes(maxBytes);
  const stat = await fs.stat(filePath);
  if (stat.size > maxBytes) {
    throw new FileTooLargeError(stat.size, maxBytes);
  }
}

/**
 * Reads a UTF-8 file when within maxBytes; throws FileTooLargeError otherwise.
 */
export async function readFileBounded(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  await assertFileSize(filePath, maxBytes);
  return fs.readFile(filePath, 'utf-8');
}
