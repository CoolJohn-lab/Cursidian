# Vault page schema

Load this reference only for create/edit work. Retrieval-only tasks do not need it.

## Layout

Categories: `concepts/`, `entities/`, `skills/`, `references/`, and `journal/`, plus project trees.

- Project knowledge: `projects/<name>/<category>/`
- Project overview: `projects/<name>/<name>.md` (never `_project.md`)
- Decision/analysis pages: `concepts/` or `references/.../*-synthesis.md`, not a root `synthesis/`
- `_raw/`: staging inbox, not a Layer-1 source

## Special files

| File | Role |
| ---- | ---- |
| `index.md` | Flat mode: leaf catalog. Hub mode: curated router; `sync_index` preserves its body and pages are catalogued when listed or within two outbound hops. |
| `_meta/manifest.md` | Ingest ledger; mutate only through `vault` `manifest`. |
| `_meta/vocabulary.md` | Search synonyms/pairings; mutate only through `vault` `vocabulary`. |

Read `indexMode` from `vault health` before treating index sparsity as drift.

## Page template

```markdown
---
title: Page Title
category: concepts
tags: [two-to-five, taxonomy-tags]
summary: One or two sentences, <=200 chars.
sources: [where this came from]
aliases: [optional real alternate names]
created: 2026-07-12T16:00:00Z
updated: 2026-07-12T16:00:00Z
---

# Page Title

One-paragraph summary.

## Key Ideas

- A claim the source actually makes.
- A generalization the source implies. ^[inferred]
- A point where sources disagree. ^[ambiguous]

## Related

- [[concepts/related-page]] - why it is related
```

Every page needs the template frontmatter, a summary, and at least two wikilinks. Tolerate legacy decorative fields on read; do not require or invent them on write.
