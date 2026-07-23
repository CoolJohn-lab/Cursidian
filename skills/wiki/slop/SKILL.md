---
name: slop
description: Use this skill when the user asks to deslop, run a slop check, remove LLM typography, clean decorative emoji, or normalise em dashes in files on disk. Use it only for an identified local file or directory; do not use it for ordinary prose rewriting, substantive style editing, or Obsidian vault content.
---

# Local Slop Check

**Package owner:** Cursidian ships this skill under `skills/wiki/slop/` (incl. `scripts/deslop.mjs`). Deploy with `npm run skills:install` into `~/.cursor/skills/slop/`.

**Source of truth (required):** wiki `skills/local-deslop` via `user-cursidian`.

You are operating a conservative local-file hygiene tool for a technically proficient user. Preserve meaning and file integrity: report ambiguous material instead of rewriting it, and make only transformations the user authorised.

## Scope and routing

1. Resolve the target before running anything. Accept an explicit local path or the `cursor-global` / `cursidian` preset. If no target is clear, ask for one.
2. Do not run this tool on an Obsidian vault. The CLI blocks vaults it can discover, but that is a guard rather than proof that an arbitrary path is not a vault. If the target contains `.obsidian`, stop and use skill **`wiki-slop`** (MCP `vault` `slop_check` / `deslop`) instead.
3. For a Cursidian checkout, prefer its package scripts when present because they pin the project configuration. Otherwise use this helper with `--preset cursidian` and `--cursidian PATH` (or `CURSIDIAN_ROOT`).
4. Do not use this skill for a pasted paragraph, a request to improve ideas or tone, or generic editing. Handle those directly with the relevant drafting capability.

## Command

The bundled helper is `~/.cursor/skills/slop/scripts/deslop.mjs`. It requires Node.js 20 or later and has no npm dependency for its built-in engine.

```bash
export PATH="/opt/homebrew/bin:$PATH"
SCRIPT=~/.cursor/skills/slop/scripts/deslop.mjs

node "$SCRIPT" <check|fix> [paths...] [options]
```

Key options:

- `--preset cursor-global|cursidian`: add a known scan scope.
- `--engine auto|builtin|cursidian`: `builtin` uses only deterministic rules; `auto` adds Cursidian first-party engine findings when an explicit trusted Cursidian root is configured; `cursidian` requires that integration. Engine phrase/char findings beyond the builtin map are report-only (`--engine detector` remains a deprecated alias).
- `--cursidian PATH`: trusted Cursidian root for the preset or cursidian engine. `CURSIDIAN_ROOT` is the environment fallback (on this Mac usually `~/local-repos/cursidian`).
- `--strip-emoji`: remove complete decorative emoji graphemes. This is opt-in because emoji can carry meaning.
- `--aggressive`: also normalise arrows, bullets, mathematical symbols and exotic spaces. This is opt-in because those characters can be intentional.
- `--include-code`: include source and structured-data extensions. Rules still apply to the entire file, not only comments; preview first.
- `--scan-comments`: deprecated compatibility alias for `--include-code`; it does not parse comments.
- `--exclude NAME`: add a basename or root-relative POSIX path exclusion; repeatable.
- `--dry-run`: simulate a fix without writing.
- `--diff`: show a unified-style preview and imply `--dry-run`.
- `--backup`: create a collision-free `<file>.deslop.bak[.N]` before each write; a backup failure prevents that write.
- `--json`: emit the stable `deslop/v2` result envelope to stdout. Human diagnostics go to stderr.
- `--pack LIST`: cursidian phrase packs (default `claudeisms,structural,puffery,security`).

Exit status is `0` when the requested operation completed and the simulated or actual result is clean, `1` when findings remain, and `2` for invalid usage, inaccessible/skipped targets, integration failure, or incomplete writes.

## Workflow

1. Start with `check` unless the user explicitly requested a fix. A check is non-mutating and establishes the exact scope and remaining findings.
2. Before changing a directory, code/JSON/YAML, more than one file, or any target outside a disposable workspace, run `fix --dry-run --diff`. Ask the user to approve the preview unless their request already explicitly authorised those exact changes.
3. Use the conservative defaults first. Add `--strip-emoji`, `--aggressive`, or `--include-code` only when the user asked for that broader policy and understands that symbols or file semantics may change.
4. Run `fix` only after the scope and policy are settled. Add `--backup` for valuable or uncommitted files; version control is preferable for repositories.
5. Re-run `check` with the same policy. The helper also evaluates the post-fix state, but a separate check makes the final command and exit status easy to report.
6. Rewrite cursidian phrase findings manually only if the user asked for substantive prose cleanup. Never auto-apply text extracted from engine messages.

## Built-in policy

The default policy fixes common typography with exact-span edits: em/en/figure dashes, curly and guillemet quotation marks, and ellipses. It removes a UTF-8 BOM only at the start of a file. It does not globally trim whitespace, change line endings, delete zero-width joiners, or collapse spaces.

`--strip-emoji` removes recognised emoji grapheme sequences but preserves copyright, registered-trade-mark and trade-mark symbols. Treat flags, keycaps and status emoji as potentially meaningful and review the preview.

`--aggressive` adds arrows, bullets, multiplication/minus/fraction symbols, and selected exotic spaces. Do not use it on technical notation, quoted source material, identifiers or structured data without review.

## Safety expectations

The helper skips symlinks and non-regular files, accepts only valid UTF-8, enforces a 5 MiB per-file limit before reading, and uses same-directory temporary files plus atomic rename for writes. It protects all vault paths discovered from `OBSIDIAN_VAULT_PATH` and `~/.cursor/mcp.json`, including when a requested root is their parent, but undiscovered vaults remain the operator's responsibility.

Treat any skipped, unreadable, changed-during-run or failed file as an incomplete run (exit `2`), not as a clean result. Cursidian engine output is schema-checked, path-allowlisted and report-only; `auto` never executes that pass merely because a Cursidian checkout appears under the scanned tree.

## Report back

State:

- exact scope and command/policy;
- engine passes used and cursidian/config path when applicable;
- files scanned, proposed or written;
- skipped/error paths and reasons;
- remaining typography, emoji and phrase findings; and
- final exit status and whether the result is clean, has findings, or is incomplete.
