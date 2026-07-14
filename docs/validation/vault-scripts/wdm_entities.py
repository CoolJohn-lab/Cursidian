#!/usr/bin/env python3
"""Print WDM entity codes + types from the source CSV. argv1 = repo path."""
import csv, sys
path=sys.argv[1]+"/metadata/contracts/scripts/data-products/WorkerDataMart-EntityMetadata.csv"
rows=list(csv.DictReader(open(path,encoding="utf-8-sig")))
print(f"TOTAL ROWS: {len(rows)}")
seen={}
for r in rows:
    seen[(r.get('ENTITY_CODE') or '').strip()]=((r.get('TYPE') or '').strip(),(r.get('TABLE_CATALOG') or '').strip())
for code in sorted(seen):
    typ,cat=seen[code]
    warn=f"  <-- CATALOG CASING: {cat!r}" if cat and cat!="WorkerDataMart" else ""
    print(f"{typ:18s} {code}{warn}")
