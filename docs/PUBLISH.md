# Publishing checklist

Do **not** tag or publish until a human confirms the gates below. Agents must not run `git tag`, `git push --tags`, or `npm publish` unless the user explicitly asks.

## Gates

1. `npm run verify` is green locally (lint, typecheck, tests, build, MCP integration, skills checks).
2. `[Unreleased]` in `CHANGELOG.md` has meaningful notes (or you intentionally pass `--allow-empty-changelog` to `npm run bump`).
3. No private paths, tokens, or machine-specific vault paths in the diff.
4. `npm pack --dry-run` lists `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `skills/`, `rules/`, and `.cursidian-slop.json`.
5. GitHub Actions secret **`NPM_TOKEN`** is set on `CoolJohn-lab/Cursidian` (npm automation token with publish access).
6. User explicitly asks to tag and publish.

## First publish vs subsequent release

|            | First publish                                                        | Subsequent release                                                                     |
| ---------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| npm name   | Confirm `npm view cursidian version` is acceptable (404 = name free) | Confirm `npm view cursidian version` matches the last published version before bumping |
| Version    | Set semver in `package.json` via `npm run bump`                      | `npm run bump` (or `-- minor` / `-- major`)                                            |
| Tag        | `v<version>` must match `package.json` exactly                       | Same                                                                                   |
| Skills     | User runs `npm run skills:install` after install                     | Re-run when `skills/wiki/` changed in the release                                      |
| MCP reload | User restarts `user-cursidian` after upgrading                       | Same (see `AGENTS.md`)                                                                 |

## Publish sequence (only when asked)

1. Ensure `[Unreleased]` notes are complete, then bump if needed:

```bash
npm run bump
# or: npm run bump -- minor
```

2. Commit the bump and changelog when asked.
3. Tag and push (replace the version with `package.json` `"version"`):

```bash
git tag v2.11.2
git push origin main --tags
```

The [`release.yml`](../.github/workflows/release.yml) workflow:

- Verifies the tag matches `package.json`
- Runs `npm run verify`
- Runs `npm publish --access public`
- Creates a GitHub release pointing at `CHANGELOG.md`

## After publish

- Restart or reload the `user-cursidian` MCP server so local dev picks up the published build if testing from source.
- If wiki skills changed, remind the user to run `npm run skills:install` and start a new agent chat.
