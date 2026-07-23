import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';

export const MANIFEST_RELATIVE_PATH = '_meta/manifest.md';

export interface ManifestSource {
  key: string;
  ingested: string;
  mtime?: string;
  pages?: string[];
}

export interface ManifestProject {
  name: string;
  cwd: string;
  lastCommit?: string;
  synced?: string;
}

export interface ManifestRecord {
  sourceDirs: string[];
  sources: ManifestSource[];
  projects: ManifestProject[];
}

interface ManifestPreserve {
  bodyBeforeSources: string;
  sourcesHeader: string;
  sourcesUnknownLines: string[];
  bodyBetween: string;
  projectsHeader: string;
  projectsUnknownLines: string[];
  bodyAfterProjects: string;
}

interface ParsedManifest extends ManifestRecord {
  frontmatter: Record<string, unknown>;
  preserve: ManifestPreserve;
}

const SOURCES_HEADING_RE = /^##\s+Sources\s*$/im;
const PROJECTS_HEADING_RE = /^##\s+Projects\s*$/im;

const SOURCE_LINE_RE =
  /^-\s+`([^`]+)`\s+\|\s+ingested:\s+(\S+)(?:\s+\|\s+mtime:\s+(\S+))?(?:\s+\|\s+pages:\s+(.+))?$/;

const PROJECT_LINE_RE =
  /^-\s+`([^`]+)`\s+\|\s+cwd:\s+(\S+)(?:\s+\|\s+last_commit:\s+(\S+))?(?:\s+\|\s+synced:\s+(\S+))?$/;

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Normalizes an absolute source path to canonical form: forward slashes, case preserved.
 */
export function normalizeSourceKey(input: string): string {
  let normalized = input.trim().replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized)) {
    const drive = normalized.slice(0, 2);
    normalized = drive + normalized.slice(2).replace(/\/+/g, '/');
  } else {
    normalized = normalized.replace(/\/+/g, '/');
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function sourceKeysEqual(a: string, b: string): boolean {
  return normalizeSourceKey(a).toLowerCase() === normalizeSourceKey(b).toLowerCase();
}

export function projectNamesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function parseSourceDirs(data: Record<string, unknown>): string[] {
  const raw = data.source_dirs;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeSourceKey(entry));
}

function parsePagesField(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) {
    return undefined;
  }
  const pages: string[] = [];
  for (const match of raw.matchAll(WIKILINK_RE)) {
    const page = match[1]?.trim();
    if (page) {
      pages.push(page);
    }
  }
  return pages.length > 0 ? pages : undefined;
}

function splitBodySections(body: string): {
  beforeSources: string;
  sourcesHeader: string;
  sourcesBody: string;
  between: string;
  projectsHeader: string;
  projectsBody: string;
  afterProjects: string;
} {
  const sourcesMatch = body.match(SOURCES_HEADING_RE);
  const projectsMatch = body.match(PROJECTS_HEADING_RE);

  if (!sourcesMatch || sourcesMatch.index === undefined) {
    return {
      beforeSources: body,
      sourcesHeader: '## Sources',
      sourcesBody: '',
      between: '\n',
      projectsHeader: '## Projects',
      projectsBody: '',
      afterProjects: '',
    };
  }

  const sourcesStart = sourcesMatch.index;
  const sourcesHeader = sourcesMatch[0];
  const afterSourcesHeader = sourcesStart + sourcesHeader.length;

  if (!projectsMatch || projectsMatch.index === undefined || projectsMatch.index <= sourcesStart) {
    const sourcesBody = body.slice(afterSourcesHeader);
    return {
      beforeSources: body.slice(0, sourcesStart),
      sourcesHeader,
      sourcesBody,
      between: '\n',
      projectsHeader: '## Projects',
      projectsBody: '',
      afterProjects: '',
    };
  }

  const projectsStart = projectsMatch.index;
  const projectsHeader = projectsMatch[0];
  const afterProjectsHeader = projectsStart + projectsHeader.length;

  return {
    beforeSources: body.slice(0, sourcesStart),
    sourcesHeader,
    sourcesBody: body.slice(afterSourcesHeader, projectsStart),
    between: '',
    projectsHeader,
    projectsBody: body.slice(afterProjectsHeader),
    afterProjects: '',
  };
}

function parseSectionLines(sectionBody: string): {
  parsedSources: ManifestSource[];
  parsedProjects: ManifestProject[];
  unknownLines: string[];
  kind: 'sources' | 'projects';
} {
  const lines = sectionBody.split('\n');
  const unknownLines: string[] = [];
  const parsedSources: ManifestSource[] = [];
  const parsedProjects: ManifestProject[] = [];
  let kind: 'sources' | 'projects' = 'sources';

  for (const line of lines) {
    if (line.trim() === '') {
      unknownLines.push(line);
      continue;
    }

    const sourceMatch = line.match(SOURCE_LINE_RE);
    if (sourceMatch) {
      kind = 'sources';
      parsedSources.push({
        key: normalizeSourceKey(sourceMatch[1] ?? ''),
        ingested: sourceMatch[2] ?? '',
        mtime: sourceMatch[3],
        pages: parsePagesField(sourceMatch[4]),
      });
      continue;
    }

    const projectMatch = line.match(PROJECT_LINE_RE);
    if (projectMatch) {
      kind = 'projects';
      parsedProjects.push({
        name: (projectMatch[1] ?? '').trim(),
        cwd: normalizeSourceKey(projectMatch[2] ?? ''),
        lastCommit: projectMatch[3],
        synced: projectMatch[4],
      });
      continue;
    }

    unknownLines.push(line);
  }

  return { parsedSources, parsedProjects, unknownLines, kind };
}

function extractTrailingSuffix(projectsBody: string): {
  projectsBody: string;
  afterProjects: string;
} {
  const lines = projectsBody.split('\n');
  let splitAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? '';
    if (trimmed.startsWith('## ') && !trimmed.match(/^##\s+Projects\s*$/i)) {
      splitAt = i;
      break;
    }
  }
  if (splitAt === lines.length) {
    return { projectsBody, afterProjects: '' };
  }
  return {
    projectsBody: lines.slice(0, splitAt).join('\n'),
    afterProjects: lines.slice(splitAt).join('\n'),
  };
}

export function parseManifest(raw: string): ParsedManifest {
  const { data, content } = parseFrontmatter(raw);
  const sourceDirs = parseSourceDirs(data);

  const sections = splitBodySections(content);
  const { projectsBody, afterProjects } = extractTrailingSuffix(sections.projectsBody);

  const sourcesParsed = parseSectionLines(sections.sourcesBody);
  const projectsParsed = parseSectionLines(projectsBody);

  return {
    sourceDirs,
    sources: sourcesParsed.parsedSources,
    projects: projectsParsed.parsedProjects,
    frontmatter: data,
    preserve: {
      bodyBeforeSources: sections.beforeSources,
      sourcesHeader: sections.sourcesHeader,
      sourcesUnknownLines: sourcesParsed.unknownLines,
      bodyBetween: sections.between || '\n',
      projectsHeader: sections.projectsHeader,
      projectsUnknownLines: projectsParsed.unknownLines,
      bodyAfterProjects: afterProjects,
    },
  };
}

export function emptyManifestRecord(): ManifestRecord {
  return { sourceDirs: [], sources: [], projects: [] };
}

export function defaultManifestContent(): string {
  const frontmatter = {
    title: 'Wiki Manifest',
    source_dirs: [] as string[],
  };
  const body = `# Wiki Manifest

## Sources

## Projects
`;
  return stringifyFrontmatter(frontmatter, body);
}

function serializeSourceLine(source: ManifestSource): string {
  const parts = [`- \`${source.key}\``, `ingested: ${source.ingested}`];
  if (source.mtime) {
    parts.push(`mtime: ${source.mtime}`);
  }
  if (source.pages?.length) {
    const links = source.pages.map((page) => `[[${page}]]`).join(', ');
    parts.push(`pages: ${links}`);
  }
  return parts.join(' | ');
}

function serializeProjectLine(project: ManifestProject): string {
  const parts = [`- \`${project.name}\``, `cwd: ${project.cwd}`];
  if (project.lastCommit) {
    parts.push(`last_commit: ${project.lastCommit}`);
  }
  if (project.synced) {
    parts.push(`synced: ${project.synced}`);
  }
  return parts.join(' | ');
}

function joinSectionLines(parsedLines: string[], unknownLines: string[]): string {
  const lines = [...unknownLines.filter((line) => line.trim() !== ''), ...parsedLines];
  if (lines.length === 0) {
    return '';
  }
  return `\n${lines.join('\n')}\n`;
}

export function serializeManifest(parsed: ParsedManifest): string {
  const frontmatter = {
    ...parsed.frontmatter,
    title: parsed.frontmatter.title ?? 'Wiki Manifest',
    source_dirs: parsed.sourceDirs,
  };

  const sourceLines = parsed.sources
    .slice()
    .sort((a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()))
    .map(serializeSourceLine);
  const projectLines = parsed.projects
    .slice()
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    .map(serializeProjectLine);

  const sourcesSection =
    parsed.preserve.bodyBeforeSources +
    parsed.preserve.sourcesHeader +
    joinSectionLines(sourceLines, parsed.preserve.sourcesUnknownLines) +
    parsed.preserve.bodyBetween +
    parsed.preserve.projectsHeader +
    joinSectionLines(projectLines, parsed.preserve.projectsUnknownLines) +
    parsed.preserve.bodyAfterProjects;

  return stringifyFrontmatter(frontmatter, sourcesSection);
}

export function upsertSource(record: ParsedManifest, source: ManifestSource): ParsedManifest {
  const key = normalizeSourceKey(source.key);
  const normalized = { ...source, key };
  const existingIndex = record.sources.findIndex((entry) => sourceKeysEqual(entry.key, key));
  const sources =
    existingIndex >= 0
      ? record.sources.map((entry, index) => (index === existingIndex ? normalized : entry))
      : [...record.sources, normalized];

  let sourceDirs = [...record.sourceDirs];
  const parentDir = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : key;
  if (parentDir && !sourceDirs.some((dir) => sourceKeysEqual(dir, parentDir))) {
    sourceDirs = [...sourceDirs, normalizeSourceKey(parentDir)];
  }

  return { ...record, sources, sourceDirs };
}

export function upsertProject(record: ParsedManifest, project: ManifestProject): ParsedManifest {
  const name = project.name.trim();
  const normalized = { ...project, name, cwd: normalizeSourceKey(project.cwd) };
  const existingIndex = record.projects.findIndex((entry) => projectNamesEqual(entry.name, name));
  const projects =
    existingIndex >= 0
      ? record.projects.map((entry, index) => (index === existingIndex ? normalized : entry))
      : [...record.projects, normalized];

  return { ...record, projects };
}

export function removeManifestEntry(
  record: ParsedManifest,
  kind: 'source' | 'project',
  key: string,
): ParsedManifest {
  if (kind === 'source') {
    return {
      ...record,
      sources: record.sources.filter((entry) => !sourceKeysEqual(entry.key, key)),
    };
  }
  return {
    ...record,
    projects: record.projects.filter((entry) => !projectNamesEqual(entry.name, key)),
  };
}

export function toManifestRecord(parsed: ParsedManifest): ManifestRecord {
  return {
    sourceDirs: parsed.sourceDirs,
    sources: parsed.sources,
    projects: parsed.projects,
  };
}
