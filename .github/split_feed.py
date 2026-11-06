"""Split the scrubbed feed snapshot (data.json) into small files the page can
fetch one route at a time (Wan, 6 Nov 2026: "make faster to load").

data.json is ~2.2 MB, 1.3 MB of it the four answer texts of every FAQ entry,
and every route used to wait for all of it before drawing its first card.
This writes, next to it, in <out>/:

  core.json         settings, run stamps and the other small values (a few KB),
                    plus `_parts` (the files below) and `_feed` (answer chunks)
  <tab>.json        one file per published tab (guidelines, events, news, fhcb,
                    vacancies, ...): its rows as the feed has them
  faq.json          FAQ rows without the four answer texts; each row carries
                    `_ac`, the number of the answer chunk that holds its texts
  faq-a-<n>.json    {id: {answer_formal_en, answer_layman_en, answer_formal_bm,
                    answer_layman_bm}} for CHUNK rows at a time, in feed order,
                    so the first page of the FAQ needs only faq-a-0.json

data.json itself is left whole: a page opened before this deploy, and the new
page when a file below is missing, still read it. Run after scrub_feed.py, so
every file is already scrubbed. Exits 1 (and writes nothing) when the input is
not a feed.
"""
import json
import os
import re
import sys

ANSWERS = ("answer_formal_en", "answer_layman_en", "answer_formal_bm", "answer_layman_bm")
CHUNK = 50
# Every list in the feed is a part, except the pipeline's last runs (small;
# Overview and Admin read them with the settings).
CORE_LISTS = ("runs",)

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
if not isinstance(d.get("faq"), list):
    sys.exit(1)

faq, chunks = [], []
for i, row in enumerate(d["faq"]):
    lite = {k: v for k, v in row.items() if k not in ANSWERS}
    n = i // CHUNK
    if n == len(chunks):
        chunks.append({})
    chunks[n][str(row.get("id"))] = {k: row.get(k, "") for k in ANSWERS}
    lite["_ac"] = n
    faq.append(lite)

PARTS = [k for k, v in d.items() if isinstance(v, list) and k not in CORE_LISTS and re.fullmatch(r"[a-z_]+", k)]
core = {k: v for k, v in d.items() if k not in PARTS}
core["_parts"] = PARTS
core["_feed"] = {"chunks": len(chunks), "size": CHUNK}

os.makedirs(out, exist_ok=True)


def write(name, obj):
    with open(os.path.join(out, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


write("faq.json", faq)
for p in PARTS:
    if p != "faq":
        write(f"{p}.json", d[p])
for n, c in enumerate(chunks):
    write(f"faq-a-{n}.json", c)
# core last: the page treats a core.json without its parts as no split at all.
write("core.json", core)
print(f"feed split: core + {len(core['_parts'])} parts + {len(chunks)} answer chunks")
