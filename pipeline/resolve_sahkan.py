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
# "sahkan" is also an ordinary Malay verb (disahkan, mengesahkan, sila sahkan), so a
# marker is only ever the bracketed form, or a bare upper-case "SAHKAN:" that stands
# alone as a word. Matching the letters anywhere cut real sentences out of published
# answers on 25 Oct 2026 and made every Malay answer fail its own check.
BARE = re.compile(r"(?<![A-Za-z])SAHKAN(?![A-Za-z])\s*:")
TRACE_CASE = re.compile(r"(?<![A-Za-z])SAHKAN(?![A-Za-z])\s*:[^\n]*")


def has_marker(text):
    """True for [SAHKAN ...] in any case, or a bare upper-case SAHKAN: ; never for the Malay word."""
    t = str(text or "")
    return bool(MARK.search(t) or re.search(r"\[\s*SAHKAN\b", t, re.I) or BARE.search(t))


def strip_traces(text):
    t = MARK.sub("", str(text or ""))
    t = re.sub(r"\[\s*SAHKAN\b[^\]\n]*\]?", "", t, flags=re.I)
    return TRACE_CASE.sub("", t)

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
    if row.get("status") == "hidden" or row.get("approved_at"):
        return False   # an answer an admin approved or edited is not rewritten by the sweep
    if any(has_marker(row.get(f)) for f in ANSWERS):
        return True
    has_open = len(str(row.get("verify_notes") or "")) > 2
    return has_open and latest and str(latest) > str(row.get("verified_at") or "")


def drop_marked(text):
    """The answer without every sentence that carries a [SAHKAN] marker or any
    trace of one: the fallback when the AI's completion fails the checks, so
    nothing unverified is added and nothing is left blocked (Wan, 23 Oct 2026).
    If every sentence has a marker nothing is left, and the caller borrows the sibling
    answer (formal <-> layman) or keeps the entry as a draft."""
    text = str(text or "")
    parts = re.split(r"(?<=[.!?。])\s+|\n+", text)
    kept = [p for p in parts if p.strip() and not has_marker(p)]
    return re.sub(r"\s{2,}", " ", " ".join(kept)).strip()


# ---- Per-marker fill (Wan, 25 Oct 2026: "markers get sourced, not cut") -------------------
# Asking the model to rewrite all four answers at once made one slip anywhere (a marker
# kept, a number it added) throw away the whole reply, so nothing was ever sourced. Each
# marker is now its own small job: the model gives the few words that replace it, with the
# passage and the exact quote; the code checks that gap alone and does the substitution,
# adding the citation itself. A gap that fails is cut (its sentence) and nothing else.
FILL_SYSTEM = """You fill gaps in FAQ answers for halal executives in Malaysia using ONLY the numbered passages from official references.

Each gap is a marker [SAHKAN: <missing fact>] inside one sentence of an answer. You get the gaps (with the sentence around each one and the language of that answer) and the passages.

For each gap:
- If a passage states the missing fact: "text" = only the words that replace the marker so the sentence reads naturally (a few words or one short clause; do not repeat the citation, it is added for you). Write it in the language of that answer: EN = English; BM = Bahasa Malaysia in the Malaysian register (boleh, ubat, syarikat, kualiti, pembungkusan; never Indonesian), regulatory terms kept original. "n" = the passage number. "quote" = the sentence or phrase of that passage that states the fact, copied word for word (max 25 words). Every number, fee, date, form name and clause in "text" must appear in that quote.
- If no passage states it: "text" = null. Never use outside knowledge and never guess.

Return JSON only: {"gaps":[{"id":1,"text":"","n":1,"quote":""}]}"""

OCC = re.compile(r"\[\s*SAHKAN:?\s*([^\]]*)\]", re.I)
INDO = re.compile(r"\b(bisa|obat|perusahaan|kualitas|kemasan|resiko|izin edar|pemerintah)\b", re.I)
SHORT = [("Pindaan", "Pindaan MPPHM (Domestik) 2020"), ("Manual Prosedur Pensijilan Halal Malaysia", "MPPHM (Domestik) 2020"),
         ("Malaysian Halal Management System", "MHMS 2020")]


def short_title(title):
    for key, name in SHORT:
        if key.lower() in str(title).lower():
            return name
    return re.sub(r"[()]", "", str(title)).strip()


def sentence_at(text, i, j):
    a = max(text.rfind(c, 0, i) for c in ".!?\n") + 1
    ends = [k for k in (text.find(c, j) for c in ".!?\n") if k >= 0]
    b = (min(ends) + 1) if ends else len(text)
    return text[a:b].strip()


def gaps_of(row):
    gaps = []
    for f in ANSWERS:
        t = str(row.get(f) or "")
        for m in OCC.finditer(t):
            gaps.append({"id": len(gaps) + 1, "field": f, "span": m.span(), "point": m.group(1).strip()[:300],
                         "lang": "BM" if f.endswith("_bm") else "EN", "sentence": sentence_at(t, m.start(), m.end())})
    return gaps


def passages_for(row, gaps, docs, df, avg, per=4, cap=10):
    seen, out = set(), []
    q0 = " ".join([str(row.get("question_en") or ""), str(row.get("question_bm") or "")])
    for g in gaps:
        for d in rank(g["point"] + " " + g["sentence"] + " " + q0, docs, df, avg, k=per):
            key = (d["ref_id"], d["page"], d["text"][:60])
            if key in seen:
                continue
            seen.add(key)
            out.append({"n": len(out) + 1, **d})
            if len(out) >= cap:
                return out
    return out


def related(point, quote):
    """The quote must be about the gap: it shares the point's content words (Malay <-> English
    pairs included), or a made-up match like "RM300" under a question about committee size passes."""
    pt = set(toks(point))
    if not pt:
        return False
    qt = set(toks(quote))
    shared = [w for w in pt if w in qt or any(x in qt for x in SYN.get(w, []))]
    return len(shared) >= min(2, len(pt))


def accept(gap, r, by_n):
    """The sourced replacement for one gap, or (None, why)."""
    text = r.get("text")
    if not isinstance(text, str) or not text.strip():
        return None, "no passage states it"
    text = re.sub(r"\s+", " ", text).strip()
    p = by_n.get(int(r.get("n"))) if str(r.get("n") or "").isdigit() else None
    q = norm(r.get("quote"))
    if not p:
        return None, f"cites passage {r.get('n')} that was not sent"
    if len(q) < 8 or q not in norm(p["text"]):
        return None, f"quote not found in passage {r.get('n')}"
    if not related(gap["point"], r.get("quote")):
        return None, "the quote is not about the gap"
    if len(text) > 240 or has_marker(text):
        return None, "replacement too long or carries a marker"
    if gap["lang"] == "BM" and INDO.search(text):
        return None, "Indonesian wording"
    extra = numbers(text) - numbers(r.get("quote")) - numbers(gap["sentence"])
    if extra:
        return None, f"numbers not in the quote: {sorted(extra)}"
    cite = f"({short_title(p['title'])}, {'ms.' if gap['lang'] == 'BM' else 'p.'} {p['page']})"
    return f"{text.rstrip('.')} {cite}", ""


def fill_gaps(row, gaps, passages):
    """(new answers, [points sourced], [points cut], [reasons], (provider, model))."""
    got, why, used = {}, [], ("", "")
    if passages:
        by_n = {p["n"]: p for p in passages}
        user = ("Passages:\n" + "\n\n".join(f"[{p['n']}] {p['title']}, page {p['page']}\n{p['text']}" for p in passages)
                + "\n\nGaps:\n" + "\n".join(f"{g['id']}. ({g['lang']}) missing: {g['point'] or '(not named)'}\n   sentence: {g['sentence']}" for g in gaps)
                + "\n\nQuestion: " + str(row.get("question_en") or row.get("question_bm") or ""))
        r = llm_router.complete_json([{"role": "system", "content": FILL_SYSTEM}, {"role": "user", "content": user}], max_tokens=2000, temperature=0.1)
        used = (r["provider"], r["model"])
        out = r["json"]
        items = out.get("gaps") if isinstance(out, dict) else out
        for it in items if isinstance(items, list) else []:
            if isinstance(it, dict) and str(it.get("id") or "").isdigit():
                g = next((x for x in gaps if x["id"] == int(it["id"])), None)
                if g:
                    rep, bad = accept(g, it, by_n)
                    if rep:
                        got[g["id"]] = rep
                    elif it.get("text"):
                        why.append(f"gap {g['id']}: {bad}")
    fields = {f: str(row.get(f) or "") for f in ANSWERS}
    for g in sorted(gaps, key=lambda x: (x["field"], -x["span"][0])):
        if g["id"] in got:
            a, b = g["span"]
            t = fields[g["field"]]
            fields[g["field"]] = t[:a].rstrip(" ") + (" " if a and t[a - 1] == " " else "") + got[g["id"]] + t[b:]
    for f in ANSWERS:                      # a gap with no source: its sentence goes, nothing else
        if has_marker(fields[f]):
            fields[f] = drop_marked(fields[f])
    sourced = [g["point"] for g in gaps if g["id"] in got]
    cut = [g["point"] for g in gaps if g["id"] not in got]
    return fields, sourced, cut, why, used


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
        if has_marker(new):
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
    # Auto-publish (Wan, 23 Oct 2026, replacing the 15 Oct "back to Drafts" rule):
    # an answer whose text carries no [SAHKAN] marker is published. A point the
    # references could not confirm was already taken OUT of the text and kept in
    # verify_notes for the admin, so what is published only says what the sources say.
    up = [dict(r, status="published", updated_at=now()) for r in faq if r.get("status") == "draft" and not any(has_marker(r.get(f)) for f in ANSWERS) and str(r.get("question_en") or r.get("question_bm") or "").strip()]
    if up:
        he_api.upsert("FAQ", up)
        print(f"{len(up)} drafts with no open marker published")
    todo = [r for r in faq if needs_pass(r, latest)][: a.limit]
    print(f"{len(todo)} FAQ entries to complete; {len(docs)} reference passages indexed")
    done, errs, provider, model, closed, still, fell = 0, [], "", "", 0, 0, []
    t_end = time.time() + a.minutes * 60
    for row in todo:
        if time.time() > t_end:
            print("time box reached; the rest wait for the next run"); break
        pts = open_points(row)
        gaps = gaps_of(row)
        if gaps:
            ps = passages_for(row, gaps, docs, df, avg) if docs else []
            try:
                fields, sourced, cut, why, used = fill_gaps(row, gaps, ps)
            except llm_router.LLMError as e:
                errs.append(f"{row['id']}: {e}")
                continue
            except (KeyError, TypeError, ValueError) as e:
                print(f"[skip] {row['id']}: reply not usable ({type(e).__name__})")
                errs.append(f"{row['id']}: reply not usable")
                continue
            provider, model = used if used[0] else (provider, model)
            if why:
                print(f"[gap-fallback] {row['id']}: " + "; ".join(why)[:300])
            prior = [x for x in pts if norm(x) not in {norm(g["point"]) for g in gaps}]
            out = dict(fields, resolved=[{"point": x} for x in sourced], open=cut + prior)
            if cut:
                fell.append(row["id"])
        else:
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
                # The completion cannot be trusted, so none of it is used: the answer
                # is published as it was, minus the sentences that needed a fact the
                # references did not give. Every open point goes to verify_notes.
                print(f"[fallback] {row['id']}: " + "; ".join(why)[:300])
                fell.append(row["id"])
                out = {f: drop_marked(row.get(f)) for f in ANSWERS}
                out["resolved"], out["open"] = [], pts

        open_left = [str(x)[:300] for x in (out.get("open") or []) if str(x).strip()]
        closed += len(out.get("resolved") or [])
        still += len(open_left)
        new = dict(row)
        for f in ANSWERS:
            new[f] = str(out[f]).strip()
        for f in ANSWERS:  # last line of defence: no trace of a marker is ever published
            if has_marker(new[f]):
                new[f] = drop_marked(new[f])
        # A language or register left empty by the cut borrows its sibling's text; an entry with
        # nothing left to say in any answer is the one thing that stays a draft.
        for lang in ("en", "bm"):
            fm, ly = new[f"answer_formal_{lang}"], new[f"answer_layman_{lang}"]
            if not fm and ly: new[f"answer_formal_{lang}"] = ly
            if not ly and fm: new[f"answer_layman_{lang}"] = fm
        if not any(new[f] for f in ANSWERS):
            print(f"[hold] {row['id']}: nothing left to publish after the markers were cut")
            continue
        new["verify_notes"] = json.dumps(open_left, ensure_ascii=False) if open_left else ""
        # Every marker is filled or taken out of the text (check() refuses a reply
        # that leaves one), so the answer is published; points still unconfirmed
        # stay in verify_notes for the admin, never in the answer.
        if new.get("status") != "hidden":
            new["status"] = "published"
        new["verified_at"] = now()
        if any(new[f] != row.get(f) for f in ANSWERS):
            new["updated_at"] = now()
        he_api.upsert("FAQ", [new])
        done += 1
        print(f"[ok] {row['id']}: {len(out.get('resolved') or [])} confirmed from references, {len(open_left)} left out pending a reference")
    if todo:
        he_api.run_log("resolve_sahkan", provider, model, done, not errs, f"confirmed {closed}, open {still}, fallback {len(fell)}; " + "; ".join(errs)[:400])
    print(f"done: {done} updated, {closed} points confirmed, {still} still open, {len(errs)} skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
