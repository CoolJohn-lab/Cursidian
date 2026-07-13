import { describe, it, expect } from 'vitest';
import {
  defaultManifestContent,
  normalizeSourceKey,
  parseManifest,
  removeManifestEntry,
  serializeManifest,
  sourceKeysEqual,
  upsertProject,
  upsertSource,
} from '../../src/lib/manifest.js';

const SAMPLE_MANIFEST = `---
title: Wiki Manifest
source_dirs:
  - C:/sources
---

# Wiki Manifest

## Sources

- \`C:/sources/paper.pdf\` | ingested: 2026-07-12T16:00:00Z | mtime: 2026-07-10T09:00:00Z | pages: [[concepts/foo]], [[references/paper]]
<!-- source comment -->

## Projects

- \`my-project\` | cwd: C:/projects/my-project | last_commit: abc123f | synced: 2026-07-12T16:00:00Z

## Custom Notes

Keep this section intact.
`;

describe('manifest library', () => {
  it('normalizes Windows paths with forward slashes and preserved case', () => {
    expect(normalizeSourceKey('C:\\Sources\\Paper.PDF')).toBe('C:/Sources/Paper.PDF');
    expect(normalizeSourceKey('c:/sources/paper.pdf')).toBe('c:/sources/paper.pdf');
    expect(sourceKeysEqual('C:/Sources/a.pdf', 'c:/sources/a.pdf')).toBe(true);
  });

  it('parses sources, projects, source_dirs, and unknown sections', () => {
    const parsed = parseManifest(SAMPLE_MANIFEST);
    expect(parsed.sourceDirs).toEqual(['C:/sources']);
    expect(parsed.sources).toHaveLength(1);
    expect(parsed.sources[0]).toMatchObject({
      key: 'C:/sources/paper.pdf',
      ingested: '2026-07-12T16:00:00Z',
      mtime: '2026-07-10T09:00:00Z',
      pages: ['concepts/foo', 'references/paper'],
    });
    expect(parsed.projects[0]).toMatchObject({
      name: 'my-project',
      cwd: 'C:/projects/my-project',
      lastCommit: 'abc123f',
      synced: '2026-07-12T16:00:00Z',
    });
    expect(parsed.preserve.bodyAfterProjects).toContain('## Custom Notes');
    expect(parsed.preserve.bodyAfterProjects).toContain('Keep this section intact.');
    expect(parsed.preserve.sourcesUnknownLines.some((line) => line.includes('source comment'))).toBe(true);
  });

  it('serializes deterministically with sorted entries', () => {
    const parsed = parseManifest(defaultManifestContent());
    const withEntries = upsertProject(
      upsertSource(parsed, {
        key: 'C:/z/last.pdf',
        ingested: '2026-07-12T18:00:00Z',
      }),
      {
        name: 'z-project',
        cwd: 'C:/z',
        synced: '2026-07-12T18:00:00Z',
      },
    );
    const withFirst = upsertSource(withEntries, {
      key: 'C:/a/first.pdf',
      ingested: '2026-07-12T17:00:00Z',
    });

    const output = serializeManifest(withFirst);
    const reparsed = parseManifest(output);
    expect(reparsed.sources.map((s) => s.key)).toEqual(['C:/a/first.pdf', 'C:/z/last.pdf']);
    expect(reparsed.projects.map((p) => p.name)).toEqual(['z-project']);
    expect(reparsed.sourceDirs).toContain('C:/a');
    expect(reparsed.sourceDirs).toContain('C:/z');
  });

  it('replaces duplicate sources by normalized key', () => {
    const parsed = parseManifest(defaultManifestContent());
    const first = upsertSource(parsed, {
      key: 'C:/sources/doc.pdf',
      ingested: '2026-07-12T10:00:00Z',
      mtime: '2026-07-12T09:00:00Z',
    });
    const second = upsertSource(first, {
      key: 'c:/sources/doc.pdf',
      ingested: '2026-07-12T11:00:00Z',
      mtime: '2026-07-12T10:00:00Z',
      pages: ['concepts/doc'],
    });

    expect(second.sources).toHaveLength(1);
    expect(second.sources[0]?.ingested).toBe('2026-07-12T11:00:00Z');
    expect(second.sources[0]?.pages).toEqual(['concepts/doc']);
  });

  it('preserves unknown trailing sections after round-trip', () => {
    const parsed = parseManifest(SAMPLE_MANIFEST);
    const updated = upsertSource(parsed, {
      key: 'C:/sources/new.pdf',
      ingested: '2026-07-12T20:00:00Z',
    });
    const output = serializeManifest(updated);
    expect(output).toContain('## Custom Notes');
    expect(output).toContain('Keep this section intact.');
  });

  it('removes sources and projects by key', () => {
    const parsed = parseManifest(SAMPLE_MANIFEST);
    const withoutSource = removeManifestEntry(parsed, 'source', 'C:/sources/paper.pdf');
    expect(withoutSource.sources).toHaveLength(0);

    const withoutProject = removeManifestEntry(parsed, 'project', 'my-project');
    expect(withoutProject.projects).toHaveLength(0);
  });
});
