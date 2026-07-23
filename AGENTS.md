# Agent notes - Cursidian

## Golden standard (rule -> skill -> wiki)

| Layer  | Where                                           | Role                                                              |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Rule   | `~/.cursor/plugins/local/my-agents/rules/` only | Thin when + "read skill X" - **no** project `.cursor/rules/*.mdc` |
| Skill  | Package `skills/wiki/` -> `~/.cursor/skills/`   | Workflow + MCP protocol (`vault`)                                 |
| Wiki   | WorkStuff via `user-cursidian`                  | Durable Cursidian SoT under `projects/cursidian/`                 |
| Config | `~/.cursor/config/`                             | Local JSON / workspaces                                           |

Protocol skill = **`vault`**. Product facts: `projects/cursidian/cursidian` + `projects/cursidian/concepts/mcp-tool-surface`. Layer contract: `concepts/cursor-rule-skill-wiki-stack`.

## Slop gate (required for build)

`npm run build` runs **`prebuild` -> `slop:check`**. The MCP will not compile while LLM-slop findings or decorative emoji remain in the **repo**.

| Command / tool            | Purpose                                                     |
| ------------------------- | ----------------------------------------------------------- |
| `npm run slop:check`      | Scan this repo; exits non-zero if dirty                     |
| `npm run slop:fix`        | Auto-fix characters/emoji in this repo                      |
| `vault` `slop_check`      | Read-only vault slop report (body + frontmatter) via MCP    |
| `vault` `deslop`          | Journaled vault char/emoji fix (`dryRun` / `confirm: true`) |
| `npm run slop:check:wiki` | Human/CI CLI vault scan (agents prefer MCP)                 |
| `npm run slop:fix:wiki`   | Human/CI CLI vault fix (agents must use MCP `deslop`)       |
| `npm run build`           | Repo slop check, then `tsc`                                 |

Vault deslop is MCP-only for agents (skill `wiki-slop`; covers frontmatter `summary` so index drift stays clear). On-disk deslop for other repos / `~/.cursor` uses skill `slop` (shipped under `skills/wiki/slop/` with `scripts/deslop.mjs`; deployed by `skills:install`). Wiki scans do **not** gate `build` (vault lives outside the package). Keep `npm run slop:*` as this package's **build gate** only.

Config: `.cursidian-slop.json` + `rules/slop/` (packs: `claudeisms`, `structural`, `puffery`, `security`). Decorative emoji is gated by `EMOJI_RE` in code, not the char list.

## MCP server reload

After `npm run build`, restart the `user-cursidian` MCP server in Cursor (Settings -> MCP -> restart, or reload the window) so the IDE picks up changes from `dist/`.

After changing `~/.cursor/mcp.json`, run:

```bash
npm run mcp:check
```

That is a **read-only** guard: it fails if the `cursidian` server entry is missing, points at a legacy server path, or lacks an absolute `OBSIDIAN_VAULT_PATH`. It does not rewrite the file. Then restart `user-cursidian`.

## MCP invocation checklist (CallMcpTool)

Every vault MCP call must set **both**:

- `server: "user-cursidian"`
- `toolName`: exactly one of `note` | `search` | `graph` | `vault` | `context`

Never send only `arguments` + `description` (missing `server` / `toolName` fails before Cursidian runs). Discover schemas with `GetMcpTools` first. On verify steps, re-read with a well-formed call - do not mark verify complete after a malformed invocation.

Do not call denylisted tool names (`read_note`, `search_content`, `list_notes`, ...). See `skills/wiki/vault/SKILL.md` (MCP Contract) and `docs/MCP-HOST-HYGIENE.md` for stale Cursor allowlist cleanup.

## Wiki skills refresh

After changing files under `skills/wiki/`, or when Cursor agents still call denylisted tool names (`read_note`, `search_content`, ...), reinstall into the user skills directory:

```bash
npm run skills:install
```

That **removes then copies** the 11 skill folders into `~/.cursor/skills/` (never symlink; never copy into an existing folder - that nests `skill/skill/SKILL.md`). Start a new agent chat so Cursor re-discovers skills - Cursor caches skill text per chat, so an existing chat keeps teaching the old version, including denylisted tool names, until restarted. Details: `skills/wiki/INSTALL.md`. Vault deslop: skill **wiki-slop** (`vault` `slop_check` / `deslop`). On-disk / `~/.cursor`: skill **slop** (`scripts/deslop.mjs`). This package's build gate: `npm run slop:*`.

If you are not sure whether `~/.cursor/skills/` is stale relative to this repo, run `npm run skills:doctor` - it fingerprints each skill folder against its installed copy and names exactly which ones need `skills:install`.

## Version bumps

When the user says **"bump the version number"** (or similar):

1. Add notes under **`[Unreleased]`** in `CHANGELOG.md` (`### Added` / `### Changed` / `### Fixed` with bullets).
2. Run:

```bash
npm run bump
```

That defaults to a **patch** bump (`1.0.0` -> `1.0.1`), updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated section. **`npm run bump` fails if `[Unreleased]` is empty** unless you pass `--allow-empty-changelog` (README-only typo bumps).

| User intent              | Command                                   |
| ------------------------ | ----------------------------------------- |
| Default / unspecified    | `npm run bump`                            |
| Patch                    | `npm run bump -- patch`                   |
| Minor (new features)     | `npm run bump -- minor`                   |
| Major (breaking)         | `npm run bump -- major`                   |
| Preview only             | `npm run bump -- --dry-run`               |
| Empty changelog override | `npm run bump -- --allow-empty-changelog` |

Do **not** create a git commit, tag, or publish unless the user explicitly asks. Tagging/publishing is human-gated (see `docs/PUBLISH.md`).

```bash
npm run bump -- --help
```
