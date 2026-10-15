"""Merge FAQ entries that ask the same thing in different words.

process_raw.py already reuses an entry when the wording is close (match_faq),
but the group asks the same question many ways ("BPJPH certificate with no
expiry" / "Indonesian certificate without expiry date"). This pass finds
look-alike pairs by shared words, asks the model which pairs are truly the
same question, and keeps one: the published one, else the one with the fuller
answer. The other gets status `duplicate` (kept, never shown, never a draft)
and its source messages are added to the kept entry. Nothing is deleted
(CLAUDE.md rule 6). Pairs already judged are remembered in STATE_DIR.

  python dedupe_faq.py              (each process_whatsapp run)
"""
import itertools
import json
import os
import pathlib
import re
import sys

import he_api
import llm_router

STOP = set("the a an of to in is are for and or on do does can i we our my it this that be with what how if any must should will under use used using yang dan di ke untuk adalah ini itu apa bagaimana boleh perlu ada kah tak tidak saya kami kita dengan atau jika halal malaysia malaysian".split())
STATE = pathlib.Path(os.environ.get("STATE_DIR", pathlib.Path(__file__).parent / ".state"))
MAX_PAIRS = 40

SYSTEM = """You check a halal-executive FAQ for repeated questions. For each numbered pair, answer whether A and B ask the SAME question (a reader would want the same answer), not merely the same topic. Different product, scheme, country, document or step = different. Return JSON {"same": [pair numbers]}."""


def toks(s):
    return {w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if w not in STOP and len(w) > 2}


def fullness(r):
    return sum(len(str(r.get(k) or "")) for k in ("answer_formal_en", "answer_formal_bm", "answer_layman_en", "answer_layman_bm"))


def main():
    faq = [r for r in he_api.read("FAQ") if r.get("status") in ("published", "draft")]
    seen_f = STATE / "dedupe_seen.json"
    try:
        seen = set(json.loads(seen_f.read_text()))
    except (OSError, ValueError):
        seen = set()
    T = [(r, toks(f"{r.get('question_en')} {r.get('question_bm')}")) for r in faq]
    pairs = []
    for (a, ta), (b, tb) in itertools.combinations(T, 2):
        if not ta or not tb or a.get("category") != b.get("category"):
            continue
        key = "|".join(sorted([str(a["id"]), str(b["id"])]))
        if key in seen:
            continue
        j = len(ta & tb) / len(ta | tb)
        if j >= 0.3:
            pairs.append((j, key, a, b))
    pairs.sort(key=lambda x: -x[0])
    pairs = pairs[:MAX_PAIRS]
    if not pairs:
        print("no look-alike pairs to check"); return 0
    text = "\n\n".join(f"{i + 1}. A: {a.get('question_en')}\n   B: {b.get('question_en')}" for i, (_, _, a, b) in enumerate(pairs))
    try:
        out = llm_router.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}], max_tokens=800, temperature=0)
    except llm_router.LLMError as e:
        print("model unavailable:", e); return 0
    j = out["json"] if isinstance(out["json"], dict) else {}
    same = {int(x) for x in (j.get("same") or []) if str(x).isdigit()}
    gone, merged = set(), 0
    for i, (_, key, a, b) in enumerate(pairs):
        seen.add(key)
        if i + 1 not in same or a["id"] in gone or b["id"] in gone:
            continue
        keep, drop = (a, b)
        if (b.get("status") == "published") > (a.get("status") == "published") or (b.get("status") == a.get("status") and fullness(b) > fullness(a)):
            keep, drop = b, a
        refs = sorted(set(filter(None, f"{keep.get('source_refs') or ''};{drop.get('source_refs') or ''}".split(";"))))
        he_api.upsert("FAQ", [dict(keep, source_refs=";".join(refs)[:500]), dict(drop, status="duplicate")])
        gone.add(drop["id"]); merged += 1
        print(f"merged {drop['id']} into {keep['id']}: {str(keep.get('question_en'))[:90]}")
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        seen_f.write_text(json.dumps(sorted(seen)))
    except OSError:
        pass
    he_api.run_log("dedupe_faq", out["provider"], out["model"], merged, True, f"{len(pairs)} pairs checked")
    print(f"done: {len(pairs)} pairs checked, {merged} merged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
