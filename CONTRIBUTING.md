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

1. Edit the skill under `skills/wiki/<name>/SKILL.md`.
2. Keep the Cursidian MCP protocol in `skills/wiki/llm-wiki/SKILL.md` as the single source of truth for tool names.
3. Run `npm run skills:install` to refresh `~/.cursor/skills/` (see `skills/wiki/INSTALL.md`).
4. Do not commit private vault content or absolute machine paths.

## Tests

- Full unit suite with coverage: `npm test`
- Focused test file: `npm run test:file -- tests/tools/foo.test.ts`
- Cursor/sandbox coverage run with npm env cleanup: `npm run test:clean`
- Live smoke (requires `OBSIDIAN_VAULT_PATH`): run `npm run build`, then `npm run smoke`
- Synthetic fixtures: `tests/fixtures/test-vault/`, `tests/fixtures/wiki-vault/`

## Version bumps

Source of truth: `package.json` `"version"` (semver).

```bash
npm run bump              # patch (default)
npm run bump -- minor
npm run bump -- major
npm run bump -- --dry-run
```

Agents: when asked to "bump the version number", run `npm run bump` (see `AGENTS.md`). The script updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated version section. Do not tag or publish unless explicitly asked.

## Pull requests

- Keep changes focused.
- Ensure `npm run verify` passes.
- Update `CHANGELOG.md` under Unreleased or the next version section.
