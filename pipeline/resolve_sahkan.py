"""Close [SAHKAN: …] markers in the FAQ from the references library.

process_raw.py writes [SAHKAN: <the missing fact>] where a group message left
a number, form or clause unstated. This pass, run straight after it:

  1. finds FAQ rows that carry a marker, or that have open points from an
     earlier pass and a reference indexed since then;
  2. retrieves the best passages from RefChunks (the same BM25 + Malay/English
     pairs the References tab uses);
  3. asks the router (MIRELD / AFIQ) to write each point into the four answers
     where a passage states it, citing the reference and page, and to take the
     point out where no passage does, keeping the rest of the answer true;
  4. checks the reply before anything is written:
       - every quote must appear word for word in the passage it cites;
       - every number in the new answers must already be in the old answers or
         in a cited passage (no new fee, date or clause from nowhere);
       - no marker left, no answer emptied;
     a reply that fails any check is discarded and the row is tried again on
     the next run;
  5. writes the answers back, with the points still open in `verify_notes`
     (shown to the admin, never on the page) and `verified_at`.

  python resolve_sahkan.py [--limit 25]
"""
import argparse
import datetime as dt
import json
import time
import math
import re
import sys
import unicodedata

import he_api
import llm_router

ANSWERS = ["answer_formal_en", "answer_layman_en", "answer_formal_bm", "answer_layman_bm"]
MARK = re.compile(r"\[SAHKAN:?\s*([^\]]*)\]", re.I)

# Same tokeniser, stop words and Malay <-> English pairs as askReferences()
# in apps-script/Code.gs, so both rank passages the same way.
STOP = set("the a an of to in is are for and or on with what how do does can i my we our be it this that".split()
           + "yang dan di ke dari untuk adalah ini itu apa bagaimana boleh saya kami kita perlu ada tak tidak ka ker nak macam mana".split())
SYN = {
    "sijil": ["certificate", "certification", "sphm"], "certificate": ["sijil", "pensijilan"], "pensijilan": ["certification", "sijil"],
    "premis": ["premise", "premises"], "premise": ["premis"], "premises": ["premis"], "produk": ["product"], "product": ["produk"],
    "pembaharuan": ["renewal", "renew"], "renew": ["pembaharuan", "pembaharui"], "renewal": ["pembaharuan"], "tamat": ["expiry", "expire"], "expiry": ["tamat", "luput"],
    "bahan": ["ingredient", "material", "raw"], "ingredient": ["bahan", "ramuan"], "ramuan": ["ingredient"], "mentah": ["raw"],
    "pembekal": ["supplier"], "supplier": ["pembekal"], "pengilang": ["manufacturer"], "manufacturer": ["pengilang", "pengeluar"],
    "label": ["label", "pelabelan"], "pelabelan": ["labelling", "label"], "labelling": ["pelabelan"],
    "audit": ["audit", "pemeriksaan"], "pemeriksaan": ["inspection", "audit"], "inspection": ["pemeriksaan"],
    "sertu": ["sertu", "cleansing", "samak"], "samak": ["sertu", "cleansing"], "najis": ["najs", "filth"], "najs": ["najis"],
    "eksekutif": ["executive"], "executive": ["eksekutif"], "jawatankuasa": ["committee"], "committee": ["jawatankuasa"],
    "dalaman": ["internal"], "internal": ["dalaman"], "jaminan": ["assurance"], "assurance": ["jaminan"], "sistem": ["system"], "system": ["sistem"],
    "permohonan": ["application", "apply"], "application": ["permohonan"], "apply": ["mohon", "permohonan"], "mohon": ["apply"],
    "yuran": ["fee", "fees", "caj"], "fee": ["yuran", "caj"], "caj": ["fee", "charge"], "bayaran": ["fee", "payment", "yuran"], "payment": ["bayaran"],
    "tempoh": ["period", "validity"], "validity": ["tempoh", "sah"],
    "kosmetik": ["cosmetic", "cosmetics"], "cosmetic": ["kosmetik"], "makanan": ["food"], "food": ["makanan"],
    "syarikat": ["company"], "company": ["syarikat"], "kilang": ["factory", "plant"], "factory": ["kilang"],
    "pindaan": ["amendment", "change"], "amendment": ["pindaan", "pembetulan"], "pembetulan": ["correction", "amendment"], "correction": ["pembetulan"],
    "jenama": ["brand"], "brand": ["jenama"], "nama": ["name"], "borang": ["form"], "form": ["borang"], "surat": ["letter"], "letter": ["surat"],
    "penggantungan": ["suspension"], "suspension": ["penggantungan"], "penarikan": ["withdrawal", "revocation"], "withdrawal": ["penarikan"],
}

SYSTEM = """You complete FAQ answers for halal executives in Malaysia using ONLY the numbered passages from official references.

The entry has four answers (formal English, layman English, formal Bahasa Malaysia, layman Bahasa Malaysia) and a list of open points: facts the answer needs that the group messages did not state.

For each open point:
- If a passage states it, write it into all four answers where the marker or the point belongs, and cite the reference in the answer, e.g. "(MPPHM 2020, p. 23)" in English and "(MPPHM 2020, ms. 23)" in Bahasa Malaysia. Add it to "resolved" with the passage number and an exact quote from that passage (max 25 words, copied word for word).
- If no passage states it, take the marker out and any words that only made sense with it, so the answer reads complete and stays true without that fact. Add the point to "open".

Rules:
- Never use outside knowledge. Never invent a number, fee, date, form name, clause or page.
- Change nothing else: keep every other sentence, fact and the register of each answer. Layman stays short and plain.
- Bahasa Malaysia in the Malaysian register (boleh, ubat, syarikat, kualiti, pembungkusan; never Indonesian). Keep regulatory terms original (Sijil Pengesahan Halal Malaysia, MPPHM, MHMS, Borang).
- No [SAHKAN] marker may remain.

Return JSON only:
{"answer_formal_en":"","answer_layman_en":"","answer_formal_bm":"","answer_layman_bm":"","resolved":[{"point":"","n":1,"quote":""}],"open":["point still not confirmed"]}"""


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def toks(s):
    s = unicodedata.normalize("NFKD", str(s or "").lower())
    return [w for w in re.sub(r"[^a-z0-9\s]", " ", s).split() if len(w) > 1 and w not in STOP]


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", unicodedata.normalize("NFKC", str(s or "").lower()))).strip()


def numbers(s):
    """Numbers as written (12, 2020, 3.5, 1500:2019 → 1500, 2019)."""
    return set(re.findall(r"\d+(?:[.,]\d+)?", str(s or "")))


def rank(query, docs, df, avg, k=8):
    terms = {}
    for w in toks(query):
        terms[w] = 1.0
        for x in SYN.get(w, []):
            terms.setdefault(x, 0.7)
    n = len(docs)
    scored = []
    for d in docs:
        sc = 0.0
        for w, wt in terms.items():
            f = d["tf"].get(w)
            if not f:
                continue
            idf = math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5))
            sc += wt * idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d["len"] / avg))
        if sc > 0:
            scored.append((sc, d))
    scored.sort(key=lambda x: -x[0])
    return [d for _, d in scored[:k]]


def load_index():
    refs = {r["id"]: r for r in he_api.read("References") if r.get("status") == "indexed"}
    latest = max((str(r.get("indexed_at") or "") for r in refs.values()), default="")
    docs, df = [], {}
    if refs:
        for c in he_api.read("RefChunks"):
            ref = refs.get(c.get("ref_id"))
            if not ref:
                continue
            tk = toks(c.get("text"))
            tf = {}
            for w in tk:
                tf[w] = tf.get(w, 0) + 1
            for w in tf:
                df[w] = df.get(w, 0) + 1
            title = ref.get("title", "") + (f" ({ref['edition']})" if ref.get("edition") and str(ref["edition"]) not in ref.get("title", "") else "")
            docs.append({"ref_id": ref["id"], "title": title, "page": str(c.get("page", "")), "text": str(c.get("text", ""))[:1600], "tf": tf, "len": len(tk)})
    avg = (sum(d["len"] for d in docs) / len(docs)) if docs else 1
    return docs, df, avg, latest


def open_points(row):
    pts = []
    for f in ANSWERS:
        pts += [m.strip() for m in MARK.findall(str(row.get(f) or "")) if m.strip()]
    try:
        old = json.loads(row.get("verify_notes") or "[]")
    except ValueError:
        old = [str(row.get("verify_notes"))]
    seen, out = set(), []
    for p in pts + [str(x) for x in old if str(x).strip()]:
        k = norm(p)
        if k and k not in seen:
            seen.add(k)
            out.append(p[:300])
    return out


def needs_pass(row, latest):
    if row.get("status") == "hidden":
        return False
    if any(MARK.search(str(row.get(f) or "")) for f in ANSWERS):
        return True
    has_open = len(str(row.get("verify_notes") or "")) > 2
    return has_open and latest and str(latest) > str(row.get("verified_at") or "")


def check(row, out, passages):
    """Reasons to discard the reply; empty when it is safe to write."""
    why = []
    by_n = {p["n"]: p for p in passages}
    cited_text = ""
    for r in out.get("resolved") or []:
        p = by_n.get(int(r.get("n") or 0)) if str(r.get("n") or "").isdigit() else None
        q = norm(r.get("quote"))
        if not p:
            why.append(f"cites passage {r.get('n')} that was not sent")
        elif len(q) < 8 or q not in norm(p["text"]):
            why.append(f"quote not found in passage {r.get('n')}: {str(r.get('quote'))[:80]}")
        else:
            cited_text += " " + p["text"] + " " + p["title"] + " " + p["page"]
    old_nums = set().union(*(numbers(row.get(f)) for f in ANSWERS))
    allowed = old_nums | numbers(cited_text)
    for f in ANSWERS:
        new, old = str(out.get(f) or "").strip(), str(row.get(f) or "").strip()
        if not new:
            why.append(f"{f} empty")
            continue
        if MARK.search(new) or "SAHKAN" in new.upper():
            why.append(f"{f} still has a marker")
        if len(new) < 0.4 * len(MARK.sub("", old)):
            why.append(f"{f} shrank from {len(old)} to {len(new)} chars")
        extra = numbers(new) - allowed
        if extra:
            why.append(f"{f} adds numbers not in the old answer or a cited passage: {sorted(extra)}")
    return why


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--minutes", type=float, default=5, help="stop cleanly after this long; the next run carries on")
    a = ap.parse_args()

    try:
        docs, df, avg, latest = load_index()
    except he_api.ApiError as e:
        if "unknown tab" in str(e) or "Missing tab" in str(e):
            print("References tabs not in the Sheet yet (run setup in Apps Script); markers are only hidden on the page.")
            docs, df, avg, latest = [], {}, 1, ""
        else:
            raise
    faq = he_api.read("FAQ")
    if faq and "verify_notes" not in faq[0]:
        # The open points need somewhere to live, or a point taken out of an
        # answer could never be written back when its reference arrives.
        print("FAQ tab has no verify_notes column yet: paste the new Code.gs and run setup. Markers stay hidden on the page meanwhile.")
        return 0
    # An answer with points the references do not state yet is not published:
    # it goes back to Admin → Drafts until a reference confirms it (Wan, 15 Oct 2026).
    back = [dict(r, status="draft", updated_at=now()) for r in faq if r.get("status") == "published" and len(str(r.get("verify_notes") or "")) > 2]
    if back:
        he_api.upsert("FAQ", back)
        print(f"{len(back)} published answers with unconfirmed points moved to drafts")
    todo = [r for r in faq if needs_pass(r, latest)][: a.limit]
    print(f"{len(todo)} FAQ entries to complete; {len(docs)} reference passages indexed")
    done, errs, provider, model, closed, still = 0, [], "", "", 0, 0
    t_end = time.time() + a.minutes * 60
    for row in todo:
        if time.time() > t_end:
            print("time box reached; the rest wait for the next run"); break
        pts = open_points(row)
        q = " ".join([str(row.get("question_en") or ""), str(row.get("question_bm") or "")] + pts)
        passages = [{"n": i + 1, **d} for i, d in enumerate(rank(q, docs, df, avg))] if docs else []
        user = ("Passages:\n" + ("\n\n".join(f"[{p['n']}] {p['title']}, page {p['page']}\n{p['text']}" for p in passages) or "(none: the references library has nothing on this yet)")
                + "\n\nEntry:\n" + json.dumps({"question_en": row.get("question_en"), "question_bm": row.get("question_bm"), **{f: row.get(f) for f in ANSWERS}}, ensure_ascii=False)
                + "\n\nOpen points:\n" + "\n".join(f"- {p}" for p in pts))
        try:
            r = llm_router.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], max_tokens=2500, temperature=0.1)
        except llm_router.LLMError as e:
            errs.append(f"{row['id']}: {e}")
            continue
        provider, model = r["provider"], r["model"]
        out = r["json"] or {}
        if not isinstance(out, dict):
            # A model sometimes answers with a bare JSON list; that crashed the
            # whole phase on 15 Oct 2026. Skip the entry; the next run asks again.
            print(f"[skip] {row['id']}: reply was a {type(out).__name__}, not an object")
            errs.append(f"{row['id']}: reply not an object")
            continue
        why = check(row, out, passages)
        if why:
            print(f"[skip] {row['id']}: " + "; ".join(why)[:400])
            errs.append(f"{row['id']}: {why[0]}"[:200])
            continue
        open_left = [str(x)[:300] for x in (out.get("open") or []) if str(x).strip()]
        closed += len(out.get("resolved") or [])
        still += len(open_left)
        new = dict(row)
        for f in ANSWERS:
            new[f] = str(out[f]).strip()
        new["verify_notes"] = json.dumps(open_left, ensure_ascii=False) if open_left else ""
        if open_left and new.get("status") == "published":
            new["status"] = "draft"  # unconfirmed points: back to Drafts
        new["verified_at"] = now()
        if any(new[f] != row.get(f) for f in ANSWERS):
            new["updated_at"] = now()
        he_api.upsert("FAQ", [new])
        done += 1
        print(f"[ok] {row['id']}: {len(out.get('resolved') or [])} confirmed from references, {len(open_left)} left out pending a reference")
    if todo:
        he_api.run_log("resolve_sahkan", provider, model, done, not errs, f"confirmed {closed}, open {still}; " + "; ".join(errs)[:400])
    print(f"done: {done} updated, {closed} points confirmed, {still} still open, {len(errs)} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
