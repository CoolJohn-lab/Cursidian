# Contributing to Cursidian

## Verify locally

```bash
npm install
npm run verify
```

`verify` runs lint, typecheck, tests, and build. On Windows, `npm run build` is `tsc` only (no `chmod`).
In Cursor agent sandboxes, `npm_config_devdir` may be injected by the environment; `verify`
cleans that value before running nested npm commands. On Windows PowerShell, prefer
`npm run verify` over manual `&&` command chains. If you need to chain manually, use
`; if ($LASTEXITCODE -eq 0) { ... }`.

## Skills

Wiki skills are tracked under `skills/wiki/` (not under `.cursor/`, which is gitignored).
Machine-wide rules live in `~/.cursor/rules/`; project `.cursor/rules/*.mdc` is fine for scoped thin triggers. Do **not** use `~/.cursor/plugins/local/my-agents` (golden standard: thin rule -> skill -> wiki SoT).

1. Edit the skill under `skills/wiki/<name>/SKILL.md`.
2. Keep the MCP **protocol** in `skills/wiki/vault/SKILL.md` (hard contract + page template). Durable product/tool facts belong in the wiki under `projects/cursidian/` via `user-cursidian`.
3. Run `npm run skills:install` to refresh `~/.cursor/skills/` (see `skills/wiki/INSTALL.md`). That install set does **not** overwrite local-only skills (`wiki-first`, `wiki-structure`, ...).
4. Do not commit private vault content or absolute machine paths.

## Tests

- Full unit suite with coverage: `npm test`
- Focused test file: `npm run test:file -- tests/tools/foo.test.ts`
- Cursor/sandbox coverage run with npm env cleanup: `npm run test:clean`
- Retrieval eval: `npm run eval` (writes `tests/eval/snapshots/baseline.json`); soft regression gate: `npm run eval -- --gate` (compares nDCG@10 to `tests/eval/snapshots/gate-baseline.json`, epsilon 0.05)
- Scorecard markdown: `npm run eval:report`
- Live smoke (requires `OBSIDIAN_VAULT_PATH`): run `npm run build`, then `npm run smoke`
- Synthetic fixtures: `tests/fixtures/test-vault/`, `tests/fixtures/wiki-vault/`, `tests/eval/golden-vault/`

### Golden-query maintenance

When a real query returns a bad search ranking or thin context bundle:

1. Add a labelled line to `tests/eval/queries.jsonl` with the correct `relevant_paths`.
2. Re-run `npm run eval` and inspect the scorecard.
3. If ranking/weights change and improve the metric deliberately, update `tests/eval/snapshots/gate-baseline.json` in the same PR.
4. Optionally record the miss via `context` `feedback` (`insufficient` / `off_target`) so the local telemetry log accumulates real failures.

## Version bumps

Source of truth: `package.json` `"version"` (semver).

1. Write release notes under **`[Unreleased]`** in `CHANGELOG.md` before bumping.
2. Run:

```bash
npm run bump              # patch (default)
npm run bump -- minor
npm run bump -- major
npm run bump -- --dry-run
```

`npm run bump` **rejects an empty `[Unreleased]`** unless you pass `--allow-empty-changelog`.

Agents: when asked to "bump the version number", add changelog bullets first, then run `npm run bump` (see `~/.cursor/rules/cursidian-agents.mdc`). The script updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated version section. Do not tag or publish unless explicitly asked (see [`docs/PUBLISH.md`](docs/PUBLISH.md)).

## Pull requests

- Keep changes focused.
- Ensure `npm run verify` passes.
- Update `CHANGELOG.md` under `[Unreleased]` (required before `npm run bump`).
