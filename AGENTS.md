# Agent notes — Cursidian

## MCP server reload

After `npm run build`, restart the `user-cursidian` MCP server in Cursor (Settings → MCP → restart, or reload the window) so the IDE picks up changes from `dist/`.

## Version bumps

When the user says **"bump the version number"** (or similar), run:

```bash
npm run bump
```

That defaults to a **patch** bump (`1.0.0` → `1.0.1`), updates `package.json`, `package-lock.json`, and promotes `CHANGELOG.md` `[Unreleased]` to a dated section.

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
