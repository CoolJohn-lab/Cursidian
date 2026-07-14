# Retrieval Eval Scorecard

Generated 2026-07-14T15:36:40.896Z from `tests/eval/golden-vault` (top-10, n=46 queries).

Regenerate with `npm run eval:report` (after `npm run build`). This file is committed so score trend is visible across commits - diff it like any other file.

## Overall

| Metric | Score |
|---|---|
| nDCG@10 | 0.928 |
| Recall@10 | 0.946 |
| MRR | 0.967 |

## By intent

| Intent | n | nDCG@10 | Recall@10 | MRR |
|---|---|---|---|---|
| connection | 10 | 0.884 | 0.900 | 0.950 |
| lookup | 21 | 0.982 | 1.000 | 0.976 |
| onboarding | 7 | 0.892 | 0.929 | 0.929 |
| troubleshoot | 8 | 0.873 | 0.875 | 1.000 |

## Context bundle metrics

From `context assemble` (n=46 labelled queries; skips queries with no `relevant_paths`).

| Metric | Score |
|---|---|
| Token efficiency (relevant tokens / tokensUsed) | 0.538 |
| Budget adherence (tokensUsed <= budget) | 1.000 |

| Intent | n | Token efficiency | Budget adherence |
|---|---|---|---|
| connection | 10 | 0.361 | 1.000 |
| lookup | 21 | 0.645 | 1.000 |
| onboarding | 7 | 0.275 | 1.000 |
| troubleshoot | 8 | 0.709 | 1.000 |

## Maintaining this scorecard

When a real query returns a bad bundle, add it to `tests/eval/queries.jsonl` with the correct `relevant_paths` (see CONTRIBUTING.md), then re-run `npm run eval:report`. Bumping `tests/eval/snapshots/baseline.json` (the gate reference) is a deliberate, separately reviewed commit - see `npm run eval -- --gate`.

Use `npm run eval -- --sweep` to check whether a different `RANK_WEIGHTS.expandedTokenMultiplier` scores better on nDCG@10 without regressing MRR; it prints a recommendation only and never edits source or writes a snapshot.
