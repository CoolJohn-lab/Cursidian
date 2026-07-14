#!/usr/bin/env python3
"""Flag content pages missing a TL;DR or Related section. Read-only."""
import os
ROOT=os.environ.get("VAULT_ROOT") or os.path.abspath(os.path.join(os.path.dirname(__file__),"..",".."))
SKIP={"index.md","hot.md","log.md"}
for dp,_,fns in os.walk(ROOT):
    if os.sep+"." in dp: continue
    for fn in fns:
        if not fn.endswith(".md") or fn in SKIP: continue
        p=os.path.join(dp,fn); t=open(p,encoding="utf-8",errors="replace").read().lower()
        rel=os.path.relpath(p,ROOT).replace(os.sep,"/"); flags=[]
        if "## tl;dr" not in t and "## tldr" not in t: flags.append("no-TLDR")
        if "## related" not in t: flags.append("no-Related")
        if flags: print(f"{','.join(flags):20s} {rel}")
