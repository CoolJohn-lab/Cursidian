#!/usr/bin/env python3
"""Scan the Obsidian vault and report structural facts. Read-only."""
import os, re, json
ROOT = os.environ.get("VAULT_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
def md_files():
    for dp, _, fns in os.walk(ROOT):
        if os.sep + "." in dp: continue
        for fn in fns:
            if fn.endswith(".md"): yield os.path.join(dp, fn)
def rel(p): return os.path.relpath(p, ROOT).replace(os.sep, "/")
def read(p): return open(p, encoding="utf-8", errors="replace").read()
WIKILINK = re.compile(r"\[\[([^\]|#]+)")
def note_name(p): return os.path.splitext(os.path.basename(p))[0]
def main():
    files = list(md_files())
    names = {note_name(p).lower(): rel(p) for p in files}
    reports = {"total_md": len(files), "no_frontmatter": [],
               "empty_or_tiny": [], "broken_links": [], "orphans": [],
               "all_pages": []}
    inbound = {rel(p): 0 for p in files}
    for p in files:
        r = rel(p); txt = read(p); reports["all_pages"].append(r)
        if not txt.lstrip().startswith("---"): reports["no_frontmatter"].append(r)
        if len(txt.strip()) < 120: reports["empty_or_tiny"].append(r)
        for m in WIKILINK.findall(txt):
            tgt = m.strip().split("/")[-1].lower()
            if tgt in names and names[tgt] != r: inbound[names[tgt]] += 1
            elif tgt not in names: reports["broken_links"].append({"in": r, "link": m.strip()})
    for r, n in inbound.items():
        if n == 0 and r.split("/")[-1].lower() not in ("index.md","hot.md","log.md"):
            reports["orphans"].append(r)
    print(json.dumps(reports, indent=2))
if __name__ == "__main__": main()
