#!/usr/bin/env python3
"""List md pages missing required frontmatter keys. Read-only."""
import os, re
ROOT = os.environ.get("VAULT_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__),"..",".."))
REQ = ["title","category","tags","status","updated","summary"]
SKIP = {"index.md","hot.md","log.md"}
def files():
    for dp,_,fns in os.walk(ROOT):
        if os.sep+"." in dp: continue
        for fn in fns:
            if fn.endswith(".md"): yield os.path.join(dp,fn)
for p in files():
    if os.path.basename(p) in SKIP: continue
    txt=open(p,encoding="utf-8",errors="replace").read()
    rel=os.path.relpath(p,ROOT).replace(os.sep,"/")
    if not txt.lstrip().startswith("---"): print(f"MISSING-ALL  {rel}"); continue
    fm=txt.split("---",2)[1] if txt.count("---")>=2 else ""
    miss=[k for k in REQ if not re.search(rf"^{k}\s*:",fm,re.M)]
    if miss: print(f"MISSING {','.join(miss):40s} {rel}")
