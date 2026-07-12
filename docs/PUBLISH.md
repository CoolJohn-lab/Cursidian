# Publishing checklist (1.0.0)

Do **not** publish until a human confirms the gates below.

## Gates

1. `npm run verify` is green locally.
2. Full-repo scrub for private paths is clean (see Step 14 in the public-ready plan).
3. `npm pack --dry-run` contains `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `skills/`.
4. `npm view cursidian version` returns not-found (name still free).
5. GitHub Actions secret **`NPM_TOKEN`** is set on `CoolJohn-lab/Cursidian` (npm automation token).
6. User explicitly asks to tag and publish.

## Publish sequence (only when asked)

1. Bump version if needed: `npm run bump` (or `-- minor` / `-- major`).
2. Commit the bump (and any release notes) when asked.
3. Tag and push:

```bash
git tag v1.0.0
git push origin main --tags
```

Replace `v1.0.0` with the version in `package.json`.

The `release.yml` workflow verifies the tag matches `package.json`, runs tests, `npm publish`, and creates a GitHub release.
