# Agent notes - Cursidian

## Slop gate (required for build)

`npm run build` runs **`prebuild` -> `slop:check`**. The MCP will not compile while LLM-slop findings or decorative emoji remain in the **repo**.

| Command / tool | Purpose |
|----------------|---------|
| `npm run slop:check` | Scan this repo; exits non-zero if dirty |
| `npm run slop:fix` | Auto-fix characters/emoji in this repo |
| `vault` `slop_check` | Read-only vault slop report (body + frontmatter) via MCP |
| `vault` `deslop` | Journaled vault char/emoji fix (`dryRun` / `confirm: true`) |
| `npm run slop:check:wiki` | Human/CI CLI vault scan (agents prefer MCP) |
| `npm run slop:fix:wiki` | Human/CI CLI vault fix (agents must use MCP `deslop`) |
| `npm run build` | Repo slop check, then `tsc` |

Wiki deslop is MCP-only for agents (covers frontmatter `summary` so index drift stays clear). Wiki scans do **not** gate `build` (vault lives outside the package).

Config: `.llmsloprc.json` + `.vscode/settings.json` (packs: `claudeisms`, `structural`, `puffery`, `security`).

## MCP server reload

After `npm run build`, restart the `user-cursidian` MCP server in Cursor (Settings -> MCP -> restart, or reload the window) so the IDE picks up changes from `dist/`.

After changing `~/.cursor/mcp.json` (or switching away from a predecessor path such as `Obsidian-MCP-For-Cursor`), run:

```bash
npm run mcp:check
```

That is a **read-only** guard: it fails if the `cursidian` server entry is missing, still points at `Obsidian-MCP-For-Cursor`, or lacks an absolute `OBSIDIAN_VAULT_PATH`. It does not rewrite the file. Then restart `user-cursidian`.

## MCP invocation checklist (CallMcpTool)

Every vault MCP call must set **both**:

- `server: "user-cursidian"`
- `toolName`: exactly one of `note` | `search` | `graph` | `vault` | `context`

Never send only `arguments` + `description` (missing `server` / `toolName` fails before Cursidian runs). Discover schemas with `GetMcpTools` first. On verify steps, re-read with a well-formed call - do not mark verify complete after a malformed invocation.

Retired tool names (`read_note`, `search_content`, `list_notes`, ...) must not be called. See `skills/wiki/llm-wiki/SKILL.md` (MCP Contract) and `docs/MCP-HOST-HYGIENE.md` for stale Cursor allowlist cleanup.

## Wiki skills refresh

After changing files under `skills/wiki/`, or when Cursor agents still call retired tool names (`read_note`, `search_content`, ...), reinstall into the user skills directory:

```bash
npm run skills:install
```

That **removes then copies** the 10 skill folders into `~/.cursor/skills/` (never symlink; never copy into an existing folder - that nests `skill/skill/SKILL.md`). Start a new agent chat so Cursor re-discovers skills - Cursor caches skill text per chat, so an existing chat keeps teaching the old version, including retired tool names, until restarted. Details: `skills/wiki/INSTALL.md`. Use the **wiki-slop** skill for deslop / repo `slop:*` / vault `slop_check`+`deslop`.

If you are not sure whether `~/.cursor/skills/` is stale relative to this repo, run `npm run skills:doctor` - it fingerprints each skill folder against its installed copy and names exactly which ones need `skills:install`.

## Version bumps

When the user says **"bump the version number"** (or similar):

1. Add notes under **`[Unreleased]`** in `CHANGELOG.md` (`### Added` / `### Changed` / `### Fixed` with bullets).
2. Run:

```bash
npm run bump
```

That defaults to a **patch** bump (`1.0.0` -> `1.0.1`), updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated section. **`npm run bump` fails if `[Unreleased]` is empty** unless you pass `--allow-empty-changelog` (README-only typo bumps).

| User intent | Command |
|-------------|---------|
| Default / unspecified | `npm run bump` |
| Patch | `npm run bump -- patch` |
| Minor (new features) | `npm run bump -- minor` |
| Major (breaking) | `npm run bump -- major` |
| Preview only | `npm run bump -- --dry-run` |
| Empty changelog override | `npm run bump -- --allow-empty-changelog` |

Do **not** create a git commit, tag, or publish unless the user explicitly asks. Tagging/publishing is human-gated (see `docs/PUBLISH.md`).

```bash
npm run bump -- --help
```
