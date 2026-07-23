#!/usr/bin/env node
/**
 * Score a ContextSearches JSONL freeze against the four wiki quality metrics
 * and run an accuracy drill-down on ranking vs focusTop1 (schemaVersion 2).
 *
 * Usage:
 *   node docs/validation/scripts/score-context-logdump.mjs [path-to.jsonl]
 *
 * Default path: ~/.cursor/logdump/ContextSearches/Version TD-CGE-001 v2 freeze - 2026-07-23.jsonl
 *
 * See wiki: projects/cursidian/concepts/context-quality-metrics
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_FREEZE = path.join(
  os.homedir(),
  '.cursor',
  'logdump',
  'ContextSearches',
  'Version TD-CGE-001 v2 freeze - 2026-07-23.jsonl',
);

const SMOKE_QUERY = 'logdump-smoke-probe';

function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n, digits = 3) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function loadRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function queryOf(row) {
  const input = row.input ?? {};
  return input.query ?? input.task ?? '';
}

function isAnalysable(row) {
  if (row.status !== 'success') return false;
  if (queryOf(row) === SMOKE_QUERY) return false;
  if (!row.quality) return false;
  const action = row.input?.action ?? 'assemble';
  return action === 'assemble' || action === 'for_task' || action === 'expand';
}

function scoreCorpus(rows) {
  const usable = rows.filter(isAnalysable);
  const n = usable.length;
  if (n === 0) {
    return { n: 0, error: 'no usable rows' };
  }

  const sufficiency = usable.filter((r) => r.quality.sufficiency).length;
  const confidences = usable.map((r) => r.quality.confidence).filter((c) => typeof c === 'number');
  const tokens = usable.map((r) => r.quality.tokensUsed);
  const depth = usable.map((r) => r.quality.depthShare);
  const budgetOk = usable.filter((r) => r.quality.tokensUsed <= r.quality.tokenBudget).length;
  const strong = usable.filter((r) => r.quality.strongHit).length;
  const clean = usable.filter((r) => r.quality.cleanBundle).length;
  const nextSteps = {};
  for (const r of usable) {
    const step = r.quality.nextStep ?? 'null';
    nextSteps[step] = (nextSteps[step] ?? 0) + 1;
  }

  return {
    n,
    schemaVersions: [...new Set(usable.map((r) => r.schemaVersion ?? 1))],
    packageVersions: [...new Set(usable.map((r) => r.packageVersion ?? 'unknown'))],
    sufficiencyRate: round(sufficiency / n, 4),
    sufficiencyCount: sufficiency,
    confidence: {
      median: round(median(confidences), 3),
      mean: round(mean(confidences), 3),
      min: round(Math.min(...confidences), 3),
    },
    tokensDelivered: {
      median: Math.round(median(tokens)),
      mean: Math.round(mean(tokens)),
      min: Math.min(...tokens),
      max: Math.max(...tokens),
    },
    budgetAdherence: round(budgetOk / n, 4),
    depthShare: {
      mean: round(mean(depth), 3),
      median: round(median(depth), 3),
    },
    strongHitRate: round(strong / n, 4),
    cleanBundleRate: round(clean / n, 4),
    nextSteps,
  };
}

/**
 * Accuracy drill-down: does focusTop1 agree with searchHits[0] / candidatesAfterRerank[0]?
 */
function accuracyDrillDown(rows, limit = 25) {
  const usable = rows.filter((r) => isAnalysable(r) && r.ranking);
  let agreeSearch = 0;
  let agreeRerank = 0;
  let hasRanking = 0;
  const misses = [];
  const expands = [];

  for (const r of usable) {
    hasRanking += 1;
    const q = r.quality;
    const ranking = r.ranking;
    const focusTop1 = q.focusTop1;
    const searchTop = ranking.searchHits?.[0]?.path ?? null;
    const rerankTop = ranking.candidatesAfterRerank?.[0]?.path ?? null;

    if (focusTop1 && searchTop && focusTop1 === searchTop) agreeSearch += 1;
    if (focusTop1 && rerankTop && focusTop1 === rerankTop) agreeRerank += 1;

    const softMiss =
      q.nextStep !== 'sufficient' ||
      (typeof q.confidence === 'number' && q.confidence < 0.9) ||
      (focusTop1 && rerankTop && focusTop1 !== rerankTop);

    if (softMiss && misses.length < limit) {
      misses.push({
        query: queryOf(r).slice(0, 100),
        nextStep: q.nextStep,
        confidence: q.confidence,
        focusTop1,
        searchTop1: searchTop,
        rerankTop1: rerankTop,
        droppedTop: ranking.droppedCompact?.[0]
          ? {
              path: ranking.droppedCompact[0].path,
              score: ranking.droppedCompact[0].score,
              kind: ranking.droppedCompact[0].kind,
            }
          : null,
      });
    }

    if (q.nextStep === 'expand') {
      expands.push({
        query: queryOf(r).slice(0, 100),
        confidence: q.confidence,
        focusTop1,
        searchTop1: searchTop,
        rerankTop1: rerankTop,
      });
    }
  }

  return {
    withRanking: hasRanking,
    focusAgreesSearchTop1: hasRanking ? round(agreeSearch / hasRanking, 4) : null,
    focusAgreesRerankTop1: hasRanking ? round(agreeRerank / hasRanking, 4) : null,
    expandCount: expands.length,
    expands: expands.slice(0, 10),
    softMissSamples: misses,
  };
}

function compareToBaseline30(score) {
  // Package 3.0 baseline from wiki (19 real calls, schemaVersion 1)
  const baseline = {
    sufficiencyRate: 0.947,
    confidenceMedian: 0.96,
    tokensMedian: 1630,
    budgetAdherence: 1.0,
    depthShareMean: 0.86,
    strongHitRate: 0.737,
  };
  return {
    baseline,
    deltas: {
      sufficiencyRate: round(score.sufficiencyRate - baseline.sufficiencyRate, 4),
      confidenceMedian: round(score.confidence.median - baseline.confidenceMedian, 3),
      tokensMedian: score.tokensDelivered.median - baseline.tokensMedian,
      budgetAdherence: round(score.budgetAdherence - baseline.budgetAdherence, 4),
      depthShareMean: round(score.depthShare.mean - baseline.depthShareMean, 3),
      strongHitRate: round(score.strongHitRate - baseline.strongHitRate, 4),
    },
  };
}

/**
 * Decision gate for TD-CGE-001: flat metrics => no-action; clear miss pattern => code change.
 */
function decide(score, accuracy, comparison) {
  const flat =
    Math.abs(comparison.deltas.sufficiencyRate) < 0.05 &&
    Math.abs(comparison.deltas.confidenceMedian) < 0.05 &&
    Math.abs(comparison.deltas.depthShareMean) < 0.08 &&
    score.budgetAdherence >= 0.99;

  const expandRate = (score.nextSteps.expand ?? 0) / score.n;
  const clearMissPattern =
    expandRate > 0.15 ||
    (accuracy.focusAgreesRerankTop1 !== null && accuracy.focusAgreesRerankTop1 < 0.5) ||
    score.sufficiencyRate < 0.85;

  if (clearMissPattern) {
    return {
      verdict: 'action',
      reason:
        'Clear miss pattern vs exit criteria (expand rate, focus/rerank agreement, or sufficiency). Investigate ranking/fill before closing TD.',
    };
  }
  if (flat || score.sufficiencyRate >= 0.9) {
    return {
      verdict: 'no_action',
      reason:
        'Metrics remain excellent vs 3.0 baseline; no weight/fill change warranted. Close TD-CGE-001 as no action.',
    };
  }
  return {
    verdict: 'watch',
    reason:
      'Mixed signal - keep logging; do not churn ranking weights without a labelled gold set.',
  };
}

function main() {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FREEZE;
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const rows = loadRows(filePath);
  const score = scoreCorpus(rows);
  const accuracy = accuracyDrillDown(rows);
  const comparison = compareToBaseline30(score);
  const decision = decide(score, accuracy, comparison);

  const report = {
    source: filePath,
    scoredAt: new Date().toISOString(),
    score,
    accuracy,
    comparison,
    decision,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
