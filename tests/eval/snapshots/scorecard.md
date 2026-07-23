# Retrieval Eval Scorecard

Generated 2026-07-22T13:25:11.634Z from `tests/eval/golden-vault` (top-10, n=49 queries).

Regenerate with `npm run eval:report` (after `npm run build`). This file is committed so score trend is visible across commits - diff it like any other file.

## Overall

| Metric    | Score |
| --------- | ----- |
| nDCG@10   | 0.921 |
| Recall@10 | 0.939 |
| MRR       | 0.969 |

## By intent

| Intent       | n   | nDCG@10 | Recall@10 | MRR   |
| ------------ | --- | ------- | --------- | ----- |
| connection   | 11  | 0.887   | 0.909     | 0.955 |
| lookup       | 21  | 0.982   | 1.000     | 0.976 |
| onboarding   | 8   | 0.890   | 0.938     | 0.938 |
| troubleshoot | 9   | 0.844   | 0.833     | 1.000 |

## Context bundle metrics

From `context assemble` (n=49 labelled queries; skips queries with no `relevant_paths`).

| Metric                                          | Score |
| ----------------------------------------------- | ----- |
| Token efficiency (relevant tokens / tokensUsed) | 0.596 |
| Budget adherence (tokensUsed <= budget)         | 1.000 |

| Intent       | n   | Token efficiency | Budget adherence |
| ------------ | --- | ---------------- | ---------------- |
| connection   | 11  | 0.470            | 1.000            |
| lookup       | 21  | 0.643            | 1.000            |
| onboarding   | 8   | 0.502            | 1.000            |
| troubleshoot | 9   | 0.724            | 1.000            |

## Maintaining this scorecard

When a real query returns a bad bundle, add it to `tests/eval/queries.jsonl` with the correct `relevant_paths` (see CONTRIBUTING.md), then re-run `npm run eval:report`. Bumping `tests/eval/snapshots/baseline.json` (the gate reference) is a deliberate, separately reviewed commit - see `npm run eval -- --gate`.

Use `npm run eval -- --sweep` to check whether a different `RANK_WEIGHTS.expandedTokenMultiplier` scores better on nDCG@10 without regressing MRR; it prints a recommendation only and never edits source or writes a snapshot.
