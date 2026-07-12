---
name: wiki-setup
description: >
  Initialize a new Obsidian wiki vault with the correct structure and special files. Use when the
  user says "set up my wiki", "initialize obsidian", "create a new vault", "get started with the
  wiki", or needs to repair a broken vault structure.
---

# Wiki Setup - Vault Initialization

You are bootstrapping a new wiki vault (or repairing one). **All vault access is via the `user-cursidian` MCP server** - see the MCP Contract in `llm-wiki/SKILL.md`. If MCP is unavailable or any call fails, stop and report; never create vault files or folders with filesystem tools.

The MCP server already knows the vault path (`OBSIDIAN_VAULT_PATH` in the user's `mcp.json`). If `search` action `list` fails because the server isn't configured, point the user at `INSTALL.md` and stop.

## Step 1: Check what exists

Call `search` action `list` (recursive). If the vault already has `index.md` and category folders, this is a repair - only create what's missing.

## Step 2: Create structure

Via `vault` action `create_folder`, make: `concepts`, `entities`, `skills`, `references`, `synthesis`, `journal`, `projects`, `_meta`, `_raw`, `_archives`.

## Step 3: Create special files

Via `note` action `create`:

**`index.md`** - frontmatter `title: Wiki Index`; body with a `## <Category>` heading per category and a note that the index is auto-maintained.

**`log.md`** - frontmatter `title: Wiki Log`; body:

```markdown
# Wiki Log

- [<ISO timestamp>] INIT categories=concepts,entities,skills,references,synthesis,journal
```

**`hot.md`** - frontmatter `title: Hot Cache`, `updated: <ISO timestamp>`; body with empty sections: Recent Activity, Active Threads, Key Takeaways, Flagged Contradictions.

**`_meta/manifest.md`** - the ingest ledger (schema in `llm-wiki/SKILL.md`). Ask the user where their source documents live and record those directories in the `source_dirs` frontmatter list.

**`_meta/taxonomy.md`** - starter tag vocabulary; a few grouped tags the user cares about. Skills consult this before inventing new tags.

## Step 4: Verify and hand off

Re-run `search` action `list` and confirm every folder and file above exists. Report the result, then tell the user:

1. Open the vault in Obsidian (File → Open Vault)
2. Run `wiki-ingest` to add their first sources
3. Run `wiki-status` anytime to see what's pending
