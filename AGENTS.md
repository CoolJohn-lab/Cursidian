# Agent notes - Cursidian

## MCP server reload

After `npm run build`, restart the `user-cursidian` MCP server in Cursor (Settings -> MCP -> restart, or reload the window) so the IDE picks up changes from `dist/`.

## Wiki skills refresh

After changing files under `skills/wiki/`, or when Cursor agents still call retired tool names (`read_note`, `search_content`, ...), reinstall into the user skills directory:

```bash
npm run skills:install
```

That **removes then copies** the 8 skill folders into `~/.cursor/skills/` (never symlink; never copy into an existing folder - that nests `skill/skill/SKILL.md`). Start a new agent chat so Cursor re-discovers skills. Details: `skills/wiki/INSTALL.md`.

## Version bumps

When the user says **"bump the version number"** (or similar), run:
```bash
npm run bump
```

That defaults to a **patch** bump (`1.0.0` -> `1.0.1`), updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated section.

| User intent | Command |
|-------------|---------|
| Default / unspecified | `npm run bump` |
| Patch | `npm run bump -- patch` |
| Minor (new features) | `npm run bump -- minor` |
| Major (breaking) | `npm run bump -- major` |
| Preview only | `npm run bump -- --dry-run` |

Do **not** create a git commit, tag, or publish unless the user explicitly asks. Tagging/publishing is human-gated (see `docs/PUBLISH.md`).

```bash
npm run bump -- --help
```
