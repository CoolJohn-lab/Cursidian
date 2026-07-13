# Plan

## Summary

The previous agent session made **~58 MCP-related tool invocations** (`GetMcpTools` + `CallMcpTool`) across deploy, smoke validation, and a wiki sync pass. **No MCP tool returned a hard server-side failure** (create/update/delete/folder/manifest/log all completed and appear in the server log). Failures and friction were almost entirely **host/agent-layer**: sandbox permission denial, Smart Mode approval gating, malformed `CallMcpTool` payloads, and noisy stderr logging.

| Severity | Count | Outcome |
|----------|------:|---------|
| Hard MCP tool errors (server rejected / threw) | 0 | - |
| Retries that recovered | 3 classes | All recovered |
| Agent mis-steps (wrong/incomplete tool args) | 6 calls | Re-issued correctly (or left unverified) |
| Product/logging noise (false `[error]`) | Many | INFO lines mislabeled |
| Vault findings (not agent failures) | Health drift | Documented, left intentional |

---

## Sources reviewed

1. Agent transcript JSONL for session `2a58fea9-8d7a-4fe7-aa7a-90355e671422` (48 turns, 55 `CallMcpTool` + 3 `GetMcpTools`).
2. Cursor log window `20260713T175549` (and nearby `175128` / `175329`):
   - `mcp-server-user-cursidian.log`
   - `mcpprocess.log`
   - `window2/workbench.mcp.allowlist.log`
   - `window2/exthost/anysphere.cursor-agent-exec/Cursor Agent Exec.log`
   - `anysphere.cursor-mcp/MCP Logs.log`
3. Agent tool dumps under `…/local-cursidian/agent-tools/` (`GetMcpTools` schema dump, slop-check dump).

---

## Session timeline (MCP-relevant)

| Local time | Phase | What happened |
|------------|-------|---------------|
| ~17:54 | Deploy | `npm run build` OK; `skills:install` blocked by sandbox -> retry with `all` |
| ~17:55 | Deploy | Rewrote `~/.cursor/mcp.json` from old `Obsidian-MCP-For-Cursor` path to this repo's `dist` |
| 17:55:54-58 | MCP connect | `user-cursidian` connected; immediate **reload** (`reason=config_changed`) then reconnect |
| 17:56-17:57 | Smoke test | Full 4-tool exercise + create/patch/delete smoke note |
| 17:58-17:59 | Wiki plan | Discovery via MCP; plan notes `sync_index` would destroy hub-router `index.md` |
| 18:00-18:03 | Wiki pass | Folders + notes created/updated; Smart Mode blocked one `hot.md` write -> approved retry |
| 18:03 | Verify | Legacy-name search + dry-run `sync_index` (`wouldWrite: true`, not applied) |

---

## Failures, retries, and mis-steps to address:

### F2 - Stale MCP config still pointed at predecessor repo

| Field | Value |
|-------|--------|
| **When** | Deploy phase |
| **What** | `~/.cursor/mcp.json` still launched `Obsidian-MCP-For-Cursor` instead of `cursidian` |
| **Agent action** | Overwrote config to `node …/cursidian/dist/index.js` with same `OBSIDIAN_VAULT_PATH` |
| **Outcome** | Corrected; required user MCP restart (requested explicitly) |
| **Class** | Config drift / cutover mis-step (environment), fixed in-session |

### F4 - Malformed `CallMcpTool` payloads (missing `server` + `toolName`)

| Field | Value |
|-------|--------|
| **When** | Wiki discovery L22 (4 calls); verify L46 (2 calls) |
| **What** | Agent invoked `CallMcpTool` with only `arguments` + `description` - **no** `server`, **no** `toolName` |

**Calls (L22):**

1. Read `projects/data-platform-dlz/skills/cursor-plugins-and-tooling-status` (intended `note` / `read`)
2. Read `projects/data-platform-dlz/skills/agent-toolkit-and-rules` (intended `note` / `read`)
3. Search `search_content read_note manage_frontmatter` (intended `search` / `content`)
4. List `projects` folder (intended `search` / `list`)

**Calls (L46):**

1. Confirm agent-toolkit content  
2. Confirm index router uses `search`

| Field | Value |
|-------|--------|
| **Recovery** | L23 immediately re-issued the same four operations with correct `server: user-cursidian` and `toolName` |
| **L46** | No explicit corrected re-issue in the transcript before marking verify complete - treat as a **verify gap** (server mutation log does not show these reads either way) |
| **Class** | Agent tooling mis-step (incomplete MCP meta-tool args) |
| **Impact** | Extra round-trips; possible incomplete verify on final reads |

### F7 - Cursor logs INFO server messages as `[error]` / stderr `ERR`

| Field | Value |
|-------|--------|
| **What** | Every successful cursidian log line (`cursidian starting`, `Note created`, `Folder created`, ...) appears in Cursor logs as `[error]` / `McpProcess stderr ERR`, while the payload still says `[INFO]` |
| **Cause** | Server writes structured logs to **stderr**; Cursor MCP host treats stderr as error channel |
| **Impact** | Noise when grepping logs for real failures; can hide genuine errors |
| **Class** | Observability / host+server logging mismatch (product friction) |

### F8 - Stale allowlist patterns for retired Obsidian tool names

| Field | Value |
|-------|--------|
| **Evidence** | Every cursidian tool call walks permission allowlist entries such as `serverPattern="obsidian", toolPattern="read_note|search_content|list_notes|…"`, all `result=false` |
| **Impact** | Log volume only; no deny observed (`deny` count 0 in allowlist parse) |
| **Class** | Host permission config still carries predecessor MCP allowlist entries |

---

## Vault findings surfaced during the session (not agent tool failures). Update the wiki. Use these updates as dogfood, to test the fixes you made for the above failures. You will have to restart cursor before starting on this section, pause and ask the user to restart the cursor IDE.

These are conditions the agent discovered while exercising MCP; they are wiki/content issues, not MCP crashes:

1. **Health:** ~19 broken links (mostly missing Attachments + heading anchors); 0 orphans.
2. **Index drift:** `vault sync_index` dry-run returned `wouldWrite: true`. Agent correctly **avoided** applying it - a flat catalog rewrite would destroy the intentional hub-router `index.md`.
3. **Stale wiki docs (pre-pass):** DLZ toolkit pages and router still taught `user-obsidian` / legacy tools (`read_note`, `search_content`, ...). Addressed in the wiki pass.
4. **Empty manifest before upsert:** `manifest` read returned empty / missing `_meta/manifest.md` until `upsert_project`.