"""Check and clean the public feed snapshot before it is published as data.json.

Drops fields that carry WhatsApp message ids (they contain the group id, a
phone number) and blanks any value that still looks like one. Exits 1 when the
file is not a feed, so the deploy publishes no snapshot rather than a bad one.
"""
import json
import re
import sys

path = sys.argv[1]
d = json.load(open(path))
if not isinstance(d.get("faq"), list):
    sys.exit(1)
WA = re.compile(r"@(g|c)\.us|@lid\b")
for key, rows in d.items():
    if not isinstance(rows, list):
        continue
    for r in rows:
        if not isinstance(r, dict):
            continue
        for f in ("source_refs", "source_msg_id", "sender_hash"):
            r.pop(f, None)
        for f, v in list(r.items()):
            if isinstance(v, str) and WA.search(v):
                r[f] = ""
json.dump(d, open(path, "w"), ensure_ascii=False)
