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

export function assertSafePath(vaultPath: string, resolvedPath: string): void {
  const relative = path.relative(vaultPath, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SecurityError(
      `Path escapes vault boundaries: "${resolvedPath}". All paths must remain within the vault.`,
    );
  }
}

export async function assertSafePathAsync(vaultPath: string, resolvedPath: string): Promise<void> {
  // First: static check using the provided vault path (may be a symlink like /tmp on macOS)
  assertSafePath(vaultPath, resolvedPath);

  // Second: resolve vault symlinks and check again against the real path
  // This catches symlink-based traversal where the target file exists and points outside
  try {
    const realVault = await fs.realpath(vaultPath);
    const realResolved = await fs.realpath(resolvedPath);
    const relative = path.relative(realVault, realResolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new SecurityError(
        `Symlink-based path traversal detected: "${resolvedPath}" resolves outside the vault.`,
      );
    }
  } catch (err) {
    if (err instanceof SecurityError) throw err;
    // ENOENT: file doesn't exist yet (e.g. create_note) — static check already passed above
    // Other errors: static check already passed, proceed
  }
}

export function assertNotReadOnly(readOnly: boolean): void {
  if (readOnly) {
    throw new ReadOnlyError();
  }
}

export async function assertFileSize(filePath: string, maxBytes: number): Promise<void> {
  const stat = await fs.stat(filePath);
  if (stat.size > maxBytes) {
    throw new Error(
      `File size ${stat.size} bytes exceeds the limit of ${maxBytes} bytes (${(maxBytes / 1_048_576).toFixed(1)} MB).`,
    );
  }
}
