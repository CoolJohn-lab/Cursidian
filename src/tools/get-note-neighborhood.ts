import { type Config } from '../config.js';
import { toRelativePath } from '../lib/vault.js';
import { readFileBounded } from '../lib/security.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { resolveExistingNotePath } from '../lib/vault-index.js';
import { resolveOutgoingLinks } from '../lib/wikilink-resolve.js';
import { getCachedBacklinks } from '../lib/backlink-cache.js';
import { getVaultSnapshot } from '../lib/vault-snapshot.js';
import {
  DEFAULT_GRAPH_BACKLINK_LIMIT,
  MAX_GRAPH_BACKLINK_LIMIT,
} from '../lib/limits.js';
import { paginateByPath, resolveCursorMarker, scanMetadataFromSkipped } from '../lib/pagination.js';
import { ok, mapToolError } from '../types/index.js';

export function getNoteNeighborhoodHandler(config: Config) {
  return async ({
    path: notePath,
    limit,
    cursor,
  }: {
    path: string;
    limit?: number;
    cursor?: string;
  }) => {
    try {
      const resolved = await resolveExistingNotePath(config.vaultPath, notePath);
      const relativePath = toRelativePath(config.vaultPath, resolved);

      const snapshot = await getVaultSnapshot(config.vaultPath, config.maxFileSize);
      const scan = scanMetadataFromSkipped(snapshot.skipped);
      const effectiveLimit = Math.min(limit ?? DEFAULT_GRAPH_BACKLINK_LIMIT, MAX_GRAPH_BACKLINK_LIMIT);
      const marker = resolveCursorMarker(cursor, snapshot.signature, {
        vaultPath: config.vaultPath,
      });

      const raw = await readFileBounded(resolved, config.maxFileSize);
      const { content } = parseFrontmatter(raw);
      const outgoingLinks = resolveOutgoingLinks(content, snapshot.index);
      const resolvedOutgoing = outgoingLinks.filter((link) => link.resolvedPath !== null);
      const unresolvedOutgoingLinks = outgoingLinks
        .filter((link) => link.resolvedPath === null)
        .map((link) => ({ raw: link.raw }));

      const allBacklinks = await getCachedBacklinks(
        config.vaultPath,
        relativePath,
        snapshot.index,
        config.maxFileSize,
        snapshot.signature,
      );
      const paged = paginateByPath(allBacklinks, effectiveLimit, marker, snapshot.signature);

      return ok({
        note: relativePath,
        depth: 1,
        outgoingLinks: resolvedOutgoing,
        unresolvedOutgoingLinks,
        backlinkCount: allBacklinks.length,
        backlinks: paged.page,
        truncated: paged.truncated,
        nextCursor: paged.nextCursor,
        effectiveLimit,
        ...scan,
      });
    } catch (e) {
      return mapToolError(e, {
        tool: 'graph',
        action: 'neighborhood',
        path: notePath,
        arguments: { path: notePath, limit: limit ?? DEFAULT_GRAPH_BACKLINK_LIMIT },
      });
    }
  };
}
