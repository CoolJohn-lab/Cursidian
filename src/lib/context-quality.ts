import type { ContextBundle, ContextItem } from '../types/index.js';

/** Precomputed quality fields for ContextSearches logdump analysis (not wall-clock). */
export interface ContextQualitySnapshot {
  /** guidance.nextStep === 'sufficient' */
  sufficiency: boolean;
  nextStep: string | null;
  confidence: number | null;
  tokensUsed: number;
  tokenBudget: number;
  /** tokensUsed / tokenBudget (0 when budget is 0) */
  fillRatio: number;
  /** body tokens / tokensUsed (0 when unused) */
  depthShare: number;
  tokensByKind: Record<string, number>;
  itemCount: number;
  itemCountsByKind: Record<string, number>;
  warningCount: number;
  cleanBundle: boolean;
  focus: string[];
  focusTop1: string | null;
  /** sufficiency && confidence >= 0.9 */
  strongHit: boolean;
}

export interface ContextRankingHit {
  path: string;
  score: number;
  reasons: string[];
  matchCount?: number;
}

export interface ContextItemCompact {
  path: string;
  title: string;
  kind: ContextItem['kind'];
  score: number;
  tokens: number;
  reasons: string[];
  lifecycle?: string;
  staleDays?: number;
}

export interface ContextDroppedCompact {
  path: string;
  score: number;
  tokens: number;
  kind: ContextItem['kind'];
}

/** Ranking / selection diagnostics - logdump only, not returned on the MCP wire. */
export interface ContextAssembleDiagnostics {
  searchHits: ContextRankingHit[];
  /** Candidates after boosts/demotes, sorted by score descending. */
  candidatesAfterRerank: ContextRankingHit[];
  itemsCompact: ContextItemCompact[];
  droppedCompact: ContextDroppedCompact[];
}

function tokensByKind(items: ContextItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.kind] = (out[item.kind] ?? 0) + item.tokens;
  }
  return out;
}

function countsByKind(items: ContextItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item.kind] = (out[item.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Derive the four quality metrics (+ helpers) from a context bundle.
 * Sufficiency / Confidence / Tokens delivered / Depth share.
 */
export function buildContextQualitySnapshot(bundle: ContextBundle): ContextQualitySnapshot {
  const tokensUsed = bundle.tokensUsed ?? 0;
  const tokenBudget = bundle.tokenBudget ?? 0;
  const byKind = tokensByKind(bundle.items ?? []);
  const bodyTokens = byKind.body ?? 0;
  const nextStep = bundle.guidance?.nextStep ?? null;
  const confidence = bundle.bundleConfidence ?? null;
  const sufficiency = nextStep === 'sufficient';
  const focus = bundle.focus ?? [];

  return {
    sufficiency,
    nextStep,
    confidence,
    tokensUsed,
    tokenBudget,
    fillRatio: tokenBudget > 0 ? tokensUsed / tokenBudget : 0,
    depthShare: tokensUsed > 0 ? bodyTokens / tokensUsed : 0,
    tokensByKind: byKind,
    itemCount: bundle.items?.length ?? 0,
    itemCountsByKind: countsByKind(bundle.items ?? []),
    warningCount: bundle.warnings?.length ?? 0,
    cleanBundle: (bundle.warnings?.length ?? 0) === 0,
    focus,
    focusTop1: focus[0] ?? null,
    strongHit: sufficiency && confidence !== null && confidence >= 0.9,
  };
}

export function compactContextItems(items: ContextItem[]): ContextItemCompact[] {
  return items.map((item) => ({
    path: item.path,
    title: item.title,
    kind: item.kind,
    score: item.score,
    tokens: item.tokens,
    reasons: item.reasons,
    ...(item.lifecycle !== undefined ? { lifecycle: item.lifecycle } : {}),
    ...(item.staleDays !== undefined ? { staleDays: item.staleDays } : {}),
  }));
}
