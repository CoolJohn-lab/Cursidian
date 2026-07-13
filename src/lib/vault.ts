import path from 'node:path';

export function resolvePath(vaultPath: string, userPath: string): string {
  const normalized = userPath.endsWith('.md') ? userPath : `${userPath}.md`;
  return path.resolve(vaultPath, normalized);
}

export function resolveDir(vaultPath: string, userPath: string): string {
  return path.resolve(vaultPath, userPath);
}

export function toRelativePath(vaultPath: string, absolutePath: string): string {
  return path.relative(vaultPath, absolutePath).split(path.sep).join('/');
}

export function noteNameFromPath(notePath: string): string {
  return path.basename(notePath, '.md');
}
