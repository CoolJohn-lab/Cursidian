import { type Config } from '../config.js';
import { searchContentHandler } from '../tools/search-content.js';
import { getNoteNeighborhoodHandler } from '../tools/get-note-neighborhood.js';
import { getVaultSnapshot, type VaultMarkdownFile } from './vault-snapshot.js';
import { parseFrontmatter } from './frontmatter.js';
import { normaliseKey, resolveWikilinkTarget, type VaultIndex } from './vault-index.js';
import { prepareSearchTokens } from './search-tokens.js';
import { findBestSection } from './section-read.js';
import { estimateTokens } from './token-estimate.js';
import { parseManifest, MANIFEST_RELATIVE_PATH } from './manifest.js';
import { resolvePath } from './vault.js';
import { readFileBounded } from './security.js';
import { isHealthExcludedPath } from './operational-paths.js';
import type {
  ContextBundle,
  ContextGuidance,
  ContextIntent,
  ContextItem,
  SearchResult,
} from '../types/index.js';
import {
  compactContextItems,
  type ContextAssembleDiagnostics,
} from './context-quality.js';

const DEFAULT_TOKEN_BUDGET = 4000;
const DEFAULT_STALE_DAYS = 90;
const MAX_BODY_CHARS = 6000;
const MAX_NEIGHBOR_CALLS = 8;
const NEIGHBOR_CAP_CONNECTION = 4;
const NEIGHBOR_CAP_ONBOARDING = 2;
const JOURNAL_DEMOTION_FACTOR = 0.35;
const TICKET_BASENAME_RE = /^(ado|ticket|wi|bug)-\d+/i;
const TICKET_QUERY_ID_RE = /\b(?:ado|ticket|wi|bug)[-\s]?\d+\b/i;
const CONTRADICTS_RE = /^>\s*Contradicts\s+\[\[([^\]]+)\]\]/gim;

function basenameWithoutExt(relativePath: string): string {
  const base = relativePath.replace(/\\/g, '/').split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '');
}

export interface AssembleContextOptions {
  query: string;
  intent?: ContextIntent;
  tokenBudget?: number;
  /** Normalised or raw paths to exclude from candidate generation (used by expand). */
  excludePaths?: string[];
}

/** Bundle plus logdump-only ranking diagnostics (not returned on the MCP wire). */
export interface ContextAssembleResult {
  bundle: ContextBundle;
  diagnostics: ContextAssembleDiagnostics;
}

interface Candidate {
  path: string;
  score: number;
  reasons: string[];
  kind?: 'neighbor-note';
  matchCount?: number;
}

interface ContradictionPair {
  source: string;
  target: string;
}

/**
 * Thrown when a context `expand` cursor is malformed, corrupt, or from an
 * incompatible schema version.
 */
export class InvalidContextCursorError extends Error {
  constructor(message = 'Invalid or corrupt context cursor.') {
    super(message);
    this.name = 'InvalidContextCursorError';
  }
}

interface ContextCursorPayload {
  v: 1;
  query: string;
  intent: ContextIntent;
  excludePaths: string[];
}

/**
 * Encodes a context bundle continuation cursor (query + intent + already-considered paths).
 */
export function encodeContextCursor(payload: Omit<ContextCursorPayload, 'v'>): string {
  const full: ContextCursorPayload = { v: 1, ...payload };
  return Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
}

/**
 * Decodes a context bundle continuation cursor produced by encodeContextCursor.
 */
export function decodeContextCursor(cursor: string): ContextCursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as ContextCursorPayload;
    if (
      parsed.v !== 1 ||
      typeof parsed.query !== 'string' ||
      typeof parsed.intent !== 'string' ||
      !Array.isArray(parsed.excludePaths)
    ) {
      throw new Error('malformed context cursor payload');
    }
    return parsed;
  } catch {
    throw new InvalidContextCursorError();
  }
}

/**
 * Infers an intent from query phrasing when the caller does not supply one.
 * Deliberately simple keyword/shape heuristics - see Cursidian Improvement Plan
 * Phase 2.9 ("simple keyword/shape classifier").
 */
export function inferIntent(query: string): ContextIntent {
  const q = query.toLowerCase();

  const connectionHints = [
    /\bhow (are|is)\b.*\brelated?\b/,
    /\brelates? to\b/,
    /\bconnection\b/,
    /\bconnects? to\b/,
    /\bvs\.?\b/,
    /\bversus\b/,
    /\bbetween\b.*\band\b/,
  ];
  const onboardingHints = [
    /\bonboard/,
    /\bgetting started\b/,
    /\bnew to\b/,
    /\bwhere (do|should) i start\b/,
    /\boverview of\b/,
    /\bread this first\b/,
    /\bwhat (do|should) i know before\b/,
    /\bbefore (touching|working on)\b/,
  ];
  const troubleshootHints = [
    /\berror\b/,
    /\bfail(ed|ing|ure)?\b/,
    /\bbroken\b/,
    /\bbug\b/,
    /\btroubleshoot/,
    /\bissue\b/,
    /\bfix\b/,
    /\bnot working\b/,
    /\brecover/,
  ];
  const ingestPrepHints = [
    /\bingest/,
    /\bnew source\b/,
    /\badd(ing)? (a )?source\b/,
    /\bpreflight\b/,
  ];

  // Order matters: troubleshoot and connection keywords are strong, specific signals.
  // Ingest-prep is checked after connection ("ingestion" is a substring of "ingest") but
  // before onboarding, whose broader phrasing ("what should I know before...") would
  // otherwise swallow "...before ingesting a new source".
  if (troubleshootHints.some((re) => re.test(q))) {
    return 'troubleshoot';
  }
  if (connectionHints.some((re) => re.test(q))) {
    return 'connection';
  }
  if (ingestPrepHints.some((re) => re.test(q))) {
    return 'ingest-prep';
  }
  if (onboardingHints.some((re) => re.test(q))) {
    return 'onboarding';
  }
  return 'lookup';
}

function seedLimitForIntent(intent: ContextIntent): number {
  switch (intent) {
    case 'onboarding':
      return 6;
    case 'connection':
      return 6;
    case 'troubleshoot':
    case 'ingest-prep':
      return 12;
    default:
      return 8;
  }
}

function neighborCapForIntent(intent: ContextIntent): number {
  return intent === 'onboarding' ? NEIGHBOR_CAP_ONBOARDING : NEIGHBOR_CAP_CONNECTION;
}

function emptyBundle(query: string, intent: ContextIntent, tokenBudget: number, warnings: string[]): ContextBundle {
  const guidance: ContextGuidance = {
    nextStep: 'refine_query',
    reason: warnings[0] ?? 'No pages matched; refine the query or try different keywords.',
  };
  return {
    query,
    intent,
    tokenBudget,
    tokensUsed: 0,
    items: [],
    coverage: { includedPaths: [], consideredPaths: [], droppedForBudget: [] },
    warnings,
    citations: [],
    bundleConfidence: 0,
    focus: [],
    guidance,
  };
}

function emptyDiagnostics(): ContextAssembleDiagnostics {
  return {
    searchHits: [],
    candidatesAfterRerank: [],
    itemsCompact: [],
    droppedCompact: [],
  };
}

function emptyResult(
  query: string,
  intent: ContextIntent,
  tokenBudget: number,
  warnings: string[],
): ContextAssembleResult {
  return { bundle: emptyBundle(query, intent, tokenBudget, warnings), diagnostics: emptyDiagnostics() };
}

function boostSkillsPages(candidates: Map<string, Candidate>): void {
  for (const candidate of candidates.values()) {
    if (normaliseKey(candidate.path).startsWith('skills/')) {
      candidate.score += 40;
      candidate.reasons.push('troubleshoot-skills-boost');
    }
  }
}

async function boostManifestTouchedPages(config: Config, candidates: Map<string, Candidate>): Promise<void> {
  try {
    const resolved = resolvePath(config.vaultPath, MANIFEST_RELATIVE_PATH);
    const raw = await readFileBounded(resolved, config.maxFileSize);
    const manifest = parseManifest(raw);
    const touchedPages = new Set<string>();
    for (const source of manifest.sources) {
      for (const page of source.pages ?? []) {
        touchedPages.add(normaliseKey(page));
      }
    }
    for (const candidate of candidates.values()) {
      if (touchedPages.has(normaliseKey(candidate.path))) {
        candidate.score += 30;
        candidate.reasons.push('manifest-touched');
      }
    }
  } catch {
    // Manifest missing/unreadable: ingest-prep degrades gracefully to lookup-like ranking.
  }
}

async function enrichWithNeighbours(
  config: Config,
  candidates: Map<string, Candidate>,
  seeds: SearchResult[],
  excludePaths: Set<string>,
  intent: ContextIntent,
): Promise<void> {
  const neighborCap = neighborCapForIntent(intent);
  let calls = 0;
  let kept = 0;

  for (const seed of seeds) {
    if (calls >= MAX_NEIGHBOR_CALLS || kept >= neighborCap) {
      break;
    }
    calls += 1;

    let neighborhood: { content: Array<{ type: string; text: string }>; isError?: boolean };
    try {
      neighborhood = await getNoteNeighborhoodHandler(config)({ path: seed.path, limit: 10 });
    } catch {
      continue;
    }
    if (neighborhood.isError) {
      continue;
    }

    let payload: {
      outgoingLinks?: Array<{ resolvedPath: string | null }>;
      backlinks?: Array<{ path: string }>;
    };
    try {
      payload = JSON.parse(neighborhood.content[0]?.text ?? '{}');
    } catch {
      continue;
    }

    // Prefer outgoing links over backlinks when capping.
    const neighbourPaths = [
      ...(payload.outgoingLinks ?? [])
        .map((link) => link.resolvedPath)
        .filter((p): p is string => Boolean(p)),
      ...(payload.backlinks ?? []).map((b) => b.path),
    ];

    for (const neighbourPath of neighbourPaths) {
      if (kept >= neighborCap) {
        break;
      }
      const key = normaliseKey(neighbourPath);
      if (excludePaths.has(key) || candidates.has(key)) {
        continue;
      }
      if (isHealthExcludedPath(neighbourPath)) {
        continue;
      }
      candidates.set(key, {
        path: neighbourPath,
        score: Math.max(15, (seed.relevanceScore ?? 30) * 0.4),
        reasons: [`neighbor-of:${seed.path}`],
        kind: 'neighbor-note',
      });
      kept += 1;
    }
  }
}

/**
 * Demotes journal pages and ticket-like distractors so they do not crowd session-first
 * bundles unless the query explicitly asks for a ticket id.
 */
function demoteJournalAndTicketCandidates(
  candidates: Map<string, Candidate>,
  fileByPath: Map<string, VaultMarkdownFile>,
  query: string,
): void {
  const queryAsksForTicket = TICKET_QUERY_ID_RE.test(query);

  for (const candidate of candidates.values()) {
    const key = normaliseKey(candidate.path);
    const file = fileByPath.get(key);
    const { data } = file ? parseFrontmatter(file.content) : { data: {} as Record<string, unknown> };
    const title = typeof data.title === 'string' ? data.title : basenameWithoutExt(candidate.path);
    const category = typeof data.category === 'string' ? data.category.toLowerCase() : '';
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
      : [];
    const basename = basenameWithoutExt(candidate.path);
    const underJournal = key.startsWith('journal/') || category === 'journal';
    const ticketLike =
      TICKET_BASENAME_RE.test(basename) ||
      TICKET_BASENAME_RE.test(title) ||
      tags.includes('ticket') ||
      tags.includes('ado');

    if (underJournal) {
      candidate.score = Math.max(1, candidate.score * JOURNAL_DEMOTION_FACTOR);
      candidate.reasons.push('journal-demotion');
    } else if (ticketLike && !queryAsksForTicket) {
      candidate.score = Math.max(1, candidate.score * JOURNAL_DEMOTION_FACTOR);
      candidate.reasons.push('ticket-demotion');
    }
  }
}

function collectContradictionCandidates(
  candidates: Map<string, Candidate>,
  fileByPath: Map<string, VaultMarkdownFile>,
  index: VaultIndex,
  excludePaths: Set<string>,
): ContradictionPair[] {
  const pairs: ContradictionPair[] = [];
  for (const candidate of [...candidates.values()]) {
    const file = fileByPath.get(normaliseKey(candidate.path));
    if (!file) {
      continue;
    }
    const { content: body } = parseFrontmatter(file.content);
    for (const match of body.matchAll(CONTRADICTS_RE)) {
      const target = match[1]?.trim();
      if (!target) {
        continue;
      }
      const resolved = resolveWikilinkTarget(target, index);
      if (!resolved) {
        continue;
      }
      pairs.push({ source: candidate.path, target: resolved });

      const key = normaliseKey(resolved);
      if (excludePaths.has(key) || candidates.has(key)) {
        continue;
      }
      candidates.set(key, {
        path: resolved,
        score: Math.max(20, candidate.score * 0.5),
        reasons: [`contradiction-counterpart:${candidate.path}`],
      });
    }
  }
  return pairs;
}

function buildProvenance(data: Record<string, unknown>): ContextItem['provenance'] | undefined {
  const raw = data.provenance;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const p = raw as Record<string, unknown>;
  const extracted = typeof p.extracted === 'number' ? p.extracted : undefined;
  const inferred = typeof p.inferred === 'number' ? p.inferred : undefined;
  const ambiguous = typeof p.ambiguous === 'number' ? p.ambiguous : undefined;
  if (extracted === undefined && inferred === undefined && ambiguous === undefined) {
    return undefined;
  }
  return { extracted, inferred, ambiguous };
}

function computeStaleDays(updated: string | undefined): number | undefined {
  if (!updated) {
    return undefined;
  }
  const parsed = new Date(updated);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const diffMs = Date.now() - parsed.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

function buildItemForCandidate(
  candidate: Candidate,
  title: string,
  data: Record<string, unknown>,
  body: string,
  tokens: string[],
): ContextItem {
  const reasons = [...candidate.reasons];
  let kind: ContextItem['kind'];
  let text: string;

  const summary = typeof data.summary === 'string' ? data.summary.trim() : '';

  if (candidate.kind === 'neighbor-note') {
    text = summary || body.trim().slice(0, 400);
    kind = 'neighbor-note';
  } else if (summary) {
    text = summary;
    kind = 'summary';
    reasons.push('used-summary');
  } else {
    const section = findBestSection(body, tokens);
    if (section) {
      text = section.content;
      kind = 'section';
      reasons.push(`used-section:${section.heading}`);
    } else {
      text = body.trim().slice(0, MAX_BODY_CHARS);
      kind = 'body';
      reasons.push('used-body');
    }
  }

  const provenance = buildProvenance(data);
  const lifecycle = typeof data.lifecycle === 'string' ? data.lifecycle : undefined;
  const updated = typeof data.updated === 'string' ? data.updated : undefined;
  const staleDays = computeStaleDays(updated);

  return {
    path: candidate.path,
    title,
    kind,
    text,
    score: candidate.score,
    reasons,
    provenance,
    lifecycle,
    updated,
    staleDays,
    tokens: estimateTokens(text),
  };
}

function buildItems(
  candidates: Candidate[],
  fileByPath: Map<string, VaultMarkdownFile>,
  tokens: string[],
): ContextItem[] {
  const items: ContextItem[] = [];
  for (const candidate of candidates) {
    const file = fileByPath.get(normaliseKey(candidate.path));
    if (!file) {
      continue;
    }
    const { data, content: body } = parseFrontmatter(file.content);
    const title = typeof data.title === 'string' ? data.title : candidate.path.replace(/\.md$/i, '');
    items.push(buildItemForCandidate(candidate, title, data, body, tokens));
  }
  return items;
}

function buildShingles(text: string, size: number): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const shingles = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) {
    shingles.add(words.slice(i, i + size).join(' '));
  }
  return shingles;
}

function shingleOverlap(a: string, b: string, size = 5): number {
  const shinglesA = buildShingles(a, size);
  const shinglesB = buildShingles(b, size);
  if (shinglesA.size === 0 || shinglesB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const shingle of shinglesA) {
    if (shinglesB.has(shingle)) {
      intersection += 1;
    }
  }
  const union = shinglesA.size + shinglesB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function sectionHeadingOf(item: ContextItem): string | undefined {
  return item.reasons.find((r) => r.startsWith('used-section:'))?.slice('used-section:'.length);
}

function isOverlapping(a: ContextItem, b: ContextItem): boolean {
  const headingA = sectionHeadingOf(a);
  const headingB = sectionHeadingOf(b);
  if (headingA && headingA === headingB) {
    return true;
  }
  return shingleOverlap(a.text, b.text) > 0.6;
}

/**
 * Deduplicates overlapping items (shared heading or >60% shingle overlap), keeping the
 * higher-scored representation and noting the merge on the survivor.
 */
function dedupeItems(items: ContextItem[]): ContextItem[] {
  const kept: ContextItem[] = [];
  const sorted = [...items].sort((a, b) => b.score - a.score);
  for (const candidate of sorted) {
    const dupe = kept.find((existing) => isOverlapping(existing, candidate));
    if (dupe) {
      dupe.reasons.push(`dedup-merged:${candidate.path}`);
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

function valuePerToken(item: ContextItem): number {
  return item.score / Math.max(item.tokens, 1);
}

function extractedRatio(item: ContextItem): number {
  const p = item.provenance;
  if (!p) {
    return 0;
  }
  const total = (p.extracted ?? 0) + (p.inferred ?? 0) + (p.ambiguous ?? 0);
  return total === 0 ? 0 : (p.extracted ?? 0) / total;
}

/**
 * Orders items for budget fill. Session-first density: non-neighbour seeds before
 * neighbours, non-demoted before demoted, then value-per-token / score / provenance.
 */
function compareItemsForSelection(a: ContextItem, b: ContextItem): number {
  const aNeighbor = a.kind === 'neighbor-note' ? 1 : 0;
  const bNeighbor = b.kind === 'neighbor-note' ? 1 : 0;
  if (aNeighbor !== bNeighbor) {
    return aNeighbor - bNeighbor;
  }
  const aDemoted = a.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion') ? 1 : 0;
  const bDemoted = b.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion') ? 1 : 0;
  if (aDemoted !== bDemoted) {
    return aDemoted - bDemoted;
  }
  return (
    valuePerToken(b) - valuePerToken(a) ||
    b.score - a.score ||
    extractedRatio(b) - extractedRatio(a) ||
    a.path.localeCompare(b.path)
  );
}

/**
 * Fills the budget. Demoted journal/ticket items are skipped unless no other
 * candidates remain - they stay in consideredPaths for expand but do not dilute
 * the primary bundle.
 */
function greedyFill(
  items: ContextItem[],
  tokenBudget: number,
): { included: ContextItem[]; dropped: ContextItem[]; tokensUsed: number } {
  const included: ContextItem[] = [];
  const dropped: ContextItem[] = [];
  let tokensUsed = 0;

  const primary = items.filter(
    (i) => !i.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion'),
  );
  const demoted = items.filter((i) =>
    i.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion'),
  );

  for (const item of primary) {
    if (tokensUsed + item.tokens <= tokenBudget) {
      included.push(item);
      tokensUsed += item.tokens;
    } else {
      dropped.push(item);
    }
  }

  // Only pull demoted pages if the primary set left the bundle empty (rare).
  if (included.length === 0) {
    for (const item of demoted) {
      if (tokensUsed + item.tokens <= tokenBudget) {
        included.push(item);
        tokensUsed += item.tokens;
      } else {
        dropped.push(item);
      }
    }
  } else {
    dropped.push(...demoted);
  }

  return { included, dropped, tokensUsed };
}

/**
 * Promotes the single highest-scored included seed item from summary/section to full body
 * when leftover budget allows - the "cheapest sufficient, upgrade the primary hit" rule.
 * Neighbour notes never promote. Onboarding/connection allow at most one body.
 */
function promoteTopItem(
  included: ContextItem[],
  fileByPath: Map<string, VaultMarkdownFile>,
  tokenBudget: number,
  tokensUsed: number,
  intent: ContextIntent,
): { items: ContextItem[]; tokensUsed: number } {
  if (included.length === 0) {
    return { items: included, tokensUsed };
  }

  if (
    (intent === 'onboarding' || intent === 'connection') &&
    included.some((i) => i.kind === 'body')
  ) {
    return { items: included, tokensUsed };
  }

  let topIdx = -1;
  for (let i = 0; i < included.length; i++) {
    const item = included[i]!;
    if (item.kind === 'neighbor-note') {
      continue;
    }
    if (topIdx < 0 || item.score > included[topIdx]!.score) {
      topIdx = i;
    }
  }
  if (topIdx < 0) {
    return { items: included, tokensUsed };
  }

  const top = included[topIdx]!;
  if (top.kind === 'body') {
    return { items: included, tokensUsed };
  }

  const file = fileByPath.get(normaliseKey(top.path));
  if (!file) {
    return { items: included, tokensUsed };
  }
  const { content: body } = parseFrontmatter(file.content);
  const fullBody = body.trim().slice(0, MAX_BODY_CHARS);
  if (fullBody.length <= top.text.length) {
    return { items: included, tokensUsed };
  }

  const bodyTokens = estimateTokens(fullBody);
  const extra = bodyTokens - top.tokens;
  if (extra <= 0 || tokensUsed + extra > tokenBudget) {
    return { items: included, tokensUsed };
  }

  const promoted: ContextItem = {
    ...top,
    text: fullBody,
    kind: 'body',
    tokens: bodyTokens,
    reasons: [...top.reasons, 'promoted-to-body'],
  };
  const nextItems = included.map((item, idx) => (idx === topIdx ? promoted : item));
  return { items: nextItems, tokensUsed: tokensUsed + extra };
}

function appendFreshnessWarnings(items: ContextItem[], warnings: string[]): void {
  if (items.length === 0) {
    warnings.push('No relevant pages were found for this query.');
    return;
  }

  const stale = items.filter((i) => (i.staleDays ?? 0) > DEFAULT_STALE_DAYS);
  if (stale.length > 0) {
    warnings.push(
      `${stale.length} of ${items.length} source(s) not updated in ${DEFAULT_STALE_DAYS}+ days: ${stale
        .map((i) => i.path)
        .join(', ')}`,
    );
  }

  const heavilyInferred = items.filter((i) => {
    const p = i.provenance;
    if (!p) {
      return false;
    }
    const total = (p.extracted ?? 0) + (p.inferred ?? 0) + (p.ambiguous ?? 0);
    return total > 0 && (p.inferred ?? 0) / total > 0.5;
  });
  if (heavilyInferred.length > 0) {
    warnings.push(
      `${heavilyInferred.length} source(s) are more than half inferred content: ${heavilyInferred
        .map((i) => i.path)
        .join(', ')}`,
    );
  }
}

function computeBundleConfidence(items: ContextItem[], consideredCount: number, warningCount: number): number {
  if (items.length === 0) {
    return 0;
  }
  const coverage = consideredCount === 0 ? 0 : Math.min(1, items.length / Math.min(consideredCount, 5));
  const freshnessScore =
    items.reduce((sum, i) => sum + ((i.staleDays ?? 0) > DEFAULT_STALE_DAYS ? 0 : 1), 0) / items.length;
  const provenanceScore =
    items.reduce((sum, i) => sum + (i.provenance ? extractedRatio(i) : 1), 0) / items.length;
  const warningPenalty = Math.min(0.3, warningCount * 0.05);

  const neighborFraction = items.filter((i) => i.kind === 'neighbor-note').length / items.length;
  const demotedFraction =
    items.filter((i) => i.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion')).length /
    items.length;
  const noisePenalty = Math.min(0.35, neighborFraction * 0.4 + demotedFraction * 0.35);

  const confidence =
    0.4 * coverage + 0.3 * freshnessScore + 0.3 * provenanceScore - warningPenalty - noisePenalty;
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

/**
 * Primary paths for agents: body-promoted first, then highest-scored non-neighbour
 * non-demoted seeds (max 3).
 */
function buildFocus(items: ContextItem[]): string[] {
  const focus: string[] = [];
  const body = items.find((i) => i.kind === 'body' && i.reasons.includes('promoted-to-body'));
  if (body) {
    focus.push(body.path);
  } else {
    const anyBody = items.find((i) => i.kind === 'body');
    if (anyBody) {
      focus.push(anyBody.path);
    }
  }

  const scoredSeeds = [...items]
    .filter(
      (i) =>
        i.kind !== 'neighbor-note' &&
        !i.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion') &&
        !focus.includes(i.path),
    )
    .sort((a, b) => b.score - a.score);

  for (const item of scoredSeeds) {
    if (focus.length >= 3) {
      break;
    }
    focus.push(item.path);
  }
  return focus;
}

function buildGuidance(
  items: ContextItem[],
  focus: string[],
  droppedForBudget: string[],
  droppedItems: ContextItem[],
  bundleConfidence: number,
  tokenBudget: number,
): ContextGuidance {
  if (items.length === 0) {
    return {
      nextStep: 'refine_query',
      reason: 'No pages matched; refine the query or try different keywords.',
    };
  }

  const neighborFraction = items.filter((i) => i.kind === 'neighbor-note').length / items.length;
  const demotedCount = items.filter((i) =>
    i.reasons.some((r) => r === 'journal-demotion' || r === 'ticket-demotion'),
  ).length;
  const avgScore = items.reduce((sum, i) => sum + i.score, 0) / items.length;
  const competitiveDrop = droppedItems.some((d) => d.score >= avgScore * 0.8);

  if (focus.length === 0 || neighborFraction > 0.5) {
    return {
      nextStep: 'refine_query',
      reason: 'Bundle is neighbour-heavy or lacks a clear focus path; narrow the query toward the SoT page or skill.',
    };
  }

  if (avgScore < 25 && demotedCount === items.length) {
    return {
      nextStep: 'refine_query',
      reason: 'Only demoted journal/ticket pages matched; refine toward skills or concepts.',
    };
  }

  if (bundleConfidence < 0.7 || (droppedForBudget.length > 0 && competitiveDrop)) {
    const suggested = Math.min(50_000, Math.max(tokenBudget + 2000, Math.ceil(tokenBudget * 1.5)));
    return {
      nextStep: 'expand',
      reason:
        bundleConfidence < 0.7
          ? `Bundle confidence ${bundleConfidence} is below 0.7; expand with nextCursor for more coverage.`
          : 'Competitive pages were dropped for budget; expand with nextCursor.',
      suggestedTokenBudget: suggested,
    };
  }

  return {
    nextStep: 'sufficient',
    reason: 'Focus paths cover the ask within budget; expand only if a follow-up needs more depth.',
  };
}

/**
 * Assembles a token-budgeted, deduplicated, provenance-tagged context bundle for a
 * query. Composes the existing search/graph lib layer (one shared vault snapshot,
 * inherited caching/security) rather than adding a new I/O primitive - the context
 * engine is read-only by construction.
 *
 * Prefer `assembleContextDetailed` when the caller also needs ranking diagnostics
 * (ContextSearches logdump). This wrapper returns the bundle only.
 */
export async function assembleContext(config: Config, options: AssembleContextOptions): Promise<ContextBundle> {
  const { bundle } = await assembleContextDetailed(config, options);
  return bundle;
}

/**
 * Same assembly as `assembleContext`, plus logdump-only ranking diagnostics
 * (search hits, post-rerank candidates, compact selected/dropped items).
 */
export async function assembleContextDetailed(
  config: Config,
  options: AssembleContextOptions,
): Promise<ContextAssembleResult> {
  const query = options.query.trim();
  const intent = options.intent ?? inferIntent(query);
  const tokenBudget = Math.max(1, Math.floor(options.tokenBudget ?? DEFAULT_TOKEN_BUDGET));
  const excludePaths = new Set((options.excludePaths ?? []).map((p) => normaliseKey(p)));
  const warnings: string[] = [];

  if (!query) {
    return emptyResult(query, intent, tokenBudget, ['Empty query: no context could be assembled.']);
  }

  const seedLimit = seedLimitForIntent(intent);
  const searchResult = await searchContentHandler(config)({
    query,
    limit: seedLimit,
    format: 'full',
    verbose: true,
  });

  let searchPayload: { results?: SearchResult[]; incomplete?: boolean; message?: string };
  try {
    searchPayload = JSON.parse(searchResult.content[0]?.text ?? '{}');
  } catch {
    searchPayload = {};
  }

  if (searchResult.isError) {
    return emptyResult(query, intent, tokenBudget, [
      `Candidate search failed: ${searchPayload.message ?? 'unknown error'}`,
    ]);
  }

  if (searchPayload.incomplete) {
    warnings.push('Vault scan was incomplete; some pages may be missing from this bundle.');
  }

  const searchHits = searchPayload.results ?? [];
  const candidates = new Map<string, Candidate>();
  for (const hit of searchHits) {
    const key = normaliseKey(hit.path);
    if (excludePaths.has(key)) {
      continue;
    }
    candidates.set(key, {
      path: hit.path,
      score: hit.relevanceScore ?? 0,
      reasons: hit.matchReasons ?? [],
      matchCount: hit.matchCount,
    });
  }

  if (intent === 'connection' || intent === 'onboarding') {
    await enrichWithNeighbours(config, candidates, searchHits.slice(0, 3), excludePaths, intent);
  }
  if (intent === 'troubleshoot') {
    boostSkillsPages(candidates);
  }
  if (intent === 'ingest-prep') {
    await boostManifestTouchedPages(config, candidates);
  }

  const snapshot = await getVaultSnapshot(config.vaultPath, config.maxFileSize);
  const fileByPath = new Map(snapshot.files.map((f) => [normaliseKey(f.relativePath), f]));

  demoteJournalAndTicketCandidates(candidates, fileByPath, query);

  const contradictionPairs = collectContradictionCandidates(candidates, fileByPath, snapshot.index, excludePaths);

  const tokens = prepareSearchTokens(query).contentTokens;
  let items = buildItems([...candidates.values()], fileByPath, tokens);
  items = dedupeItems(items);
  items.sort(compareItemsForSelection);

  const filled = greedyFill(items, tokenBudget);
  const promoted = promoteTopItem(filled.included, fileByPath, tokenBudget, filled.tokensUsed, intent);

  const finalItems = promoted.items;
  const consideredPaths = [...candidates.keys()];
  const includedPaths = finalItems.map((i) => i.path);
  const droppedForBudget = filled.dropped.map((i) => i.path);

  appendFreshnessWarnings(finalItems, warnings);

  for (const pair of contradictionPairs) {
    warnings.push(
      `Contradiction callout: ${pair.source} contradicts ${pair.target}. Both sides are pulled in where budget allows - verify before relying on either.`,
    );
  }

  const citations = finalItems.map((item) => `[[${item.path.replace(/\.md$/i, '')}]]`);
  const focus = buildFocus(finalItems);
  let bundleConfidence = computeBundleConfidence(finalItems, consideredPaths.length, warnings.length);
  if (focus.length === 0 && finalItems.length > 0) {
    bundleConfidence = Math.min(bundleConfidence, 0.55);
  }
  const guidance = buildGuidance(
    finalItems,
    focus,
    droppedForBudget,
    filled.dropped,
    bundleConfidence,
    tokenBudget,
  );

  const nextCursor = encodeContextCursor({
    query,
    intent,
    excludePaths: [...new Set([...excludePaths, ...consideredPaths])],
  });

  const candidatesAfterRerank = [...candidates.values()]
    .map((c) => ({
      path: c.path,
      score: c.score,
      reasons: c.reasons,
      ...(c.matchCount !== undefined ? { matchCount: c.matchCount } : {}),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const diagnostics: ContextAssembleDiagnostics = {
    searchHits: searchHits.map((hit) => ({
      path: hit.path,
      score: hit.relevanceScore ?? 0,
      reasons: hit.matchReasons ?? [],
      ...(hit.matchCount !== undefined ? { matchCount: hit.matchCount } : {}),
    })),
    candidatesAfterRerank,
    itemsCompact: compactContextItems(finalItems),
    droppedCompact: filled.dropped.map((item) => ({
      path: item.path,
      score: item.score,
      tokens: item.tokens,
      kind: item.kind,
    })),
  };

  return {
    bundle: {
      query,
      intent,
      tokenBudget,
      tokensUsed: promoted.tokensUsed,
      items: finalItems,
      coverage: { includedPaths, consideredPaths, droppedForBudget },
      warnings,
      citations,
      nextCursor,
      bundleConfidence,
      focus,
      guidance,
    },
    diagnostics,
  };
}

/**
 * Continues a prior bundle: decodes the cursor and re-assembles, excluding
 * already-considered paths, within a (possibly fresh) token budget.
 */
export async function expandContext(config: Config, cursor: string, tokenBudget?: number): Promise<ContextBundle> {
  const decoded = decodeContextCursor(cursor);
  const { bundle } = await assembleContextDetailed(config, {
    query: decoded.query,
    intent: decoded.intent,
    tokenBudget,
    excludePaths: decoded.excludePaths,
  });
  return bundle;
}

/** Expand with ranking diagnostics for logdump. */
export async function expandContextDetailed(
  config: Config,
  cursor: string,
  tokenBudget?: number,
): Promise<ContextAssembleResult> {
  const decoded = decodeContextCursor(cursor);
  return assembleContextDetailed(config, {
    query: decoded.query,
    intent: decoded.intent,
    tokenBudget,
    excludePaths: decoded.excludePaths,
  });
}
