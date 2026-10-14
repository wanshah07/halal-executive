"""Raw → FAQ / Documents / Events / Guidelines.

Runs until the Raw queue for the chosen sources is empty (that is the "every
2 hours, after all messages finish" rule): each loop takes a batch of `new`
rows, asks the router (MIRELD / AFIQ alternating) for structured output,
upserts the results, marks the rows processed, and goes again. A batch whose
LLM call fails on BOTH providers is left `new` for the next run and the run
is logged as failed; nothing is marked processed on a guess.

  python process_raw.py --source whatsapp,telegram,manual   (2-hourly job)
  python process_raw.py --source facebook               (daily job)
  python process_raw.py --max-batches 2 --dry-run       (try it)
"""
import argparse
import datetime as dt
import json
import re
import sys

import he_api
import llm_router
from prompts import SYSTEM

# An answer that carries a link or a phone number is never published without
# review: group messages can be wrong or planted.
RISKY = re.compile(r"(https?://|www\.|\+?6?01\d[\s-]?\d{3,4}[\s-]?\d{4}|wa\.me)", re.I)

BATCH = 25
CHAR_BUDGET = 40000      # per model call; rows with long attachments make smaller batches
ATTACH_CHARS = 6000      # text kept from one attachment


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


class Ids:
    def __init__(self, prefix, existing):
        self.prefix, self.n = prefix, 0
        for r in existing:
            i = str(r.get("id", ""))
            if i.startswith(prefix + "-"):
                try:
                    self.n = max(self.n, int(i.split("-")[1]))
                except ValueError:
                    pass

    def __call__(self):
        self.n += 1
        return f"{self.prefix}-{self.n:04d}"


def safe_url(u):
    u = str(u or "").strip()
    return u[:500] if re.match(r"^https?://", u, re.I) else ""


def message_for_model(r):
    """One Raw row as the model sees it: the text, plus the text read out of
    each attachment (screenshot OCR, PDF, Word, Excel, PowerPoint) so a
    certificate or a screenshot of a chat can become an FAQ or a certificate."""
    atts = []
    for a in json.loads(r.get("attachments") or "[]"):
        if not a.get("name"):
            continue
        item = {"name": a["name"], "type": a.get("mime", "")}
        if a.get("drive_file_id"):
            try:
                item["content"] = (he_api.drive_get(a["drive_file_id"], text=True).get("text") or "")[:ATTACH_CHARS]
            except he_api.ApiError as e:
                item["content"] = f"[could not read: {e}]"
        atts.append(item)
    return {"id": r["id"], "source": r.get("source", ""), "ts": r["ts"], "text": (r.get("text") or "")[:3000], "attachments": atts}


def existing_faq_digest(faq):
    # Short list so the model can merge duplicates instead of creating twins.
    return [{"id": f["id"], "category": f["category"], "question_en": f["question_en"][:160]} for f in faq if f.get("status") != "hidden"][:400]


def run(sources, max_batches, dry):
    faq = he_api.read("FAQ")
    docs = he_api.read("Documents")
    events = he_api.read("Events")
    gls = he_api.read("Guidelines")
    ids = {"FAQ": Ids("FAQ", faq), "DOC": Ids("DOC", docs), "EV": Ids("EV", events), "GL": Ids("GL", gls)}
    total, batches, provider, model, err = 0, 0, "", "", ""

    while batches < max_batches:
        rows = []
        for s in sources:
            rows += he_api.raw_list(status="new", source=s, limit=BATCH)
        rows = rows[:BATCH]
        if not rows:
            break
        batches += 1
        msgs, used, take = [], 0, []
        for r in rows:
            m = message_for_model(r)
            size = len(json.dumps(m, ensure_ascii=False))
            if take and used + size > CHAR_BUDGET:
                break  # the rest go in the next loop
            msgs.append(m); take.append(r); used += size
        rows = take
        user = json.dumps({"existing": existing_faq_digest(faq), "messages": msgs}, ensure_ascii=False)
        try:
            out = llm_router.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], max_tokens=6000)
        except llm_router.LLMError as e:
            err = str(e)
            print("LLM failed on both providers; leaving batch for next run:", err, file=sys.stderr)
            break
        provider, model = out["provider"], out["model"]
        j = out["json"]
        if out.get("fallback_from"):
            print(f"fallback: {out['fallback_from']} failed ({out['first_error'][:120]}), {provider} answered")

        ts = now()
        faq_rows, doc_rows, ev_rows, gl_rows = [], [], [], []
        by_id = {f["id"]: f for f in faq}
        for it in j.get("items", []):
            if not it.get("relevant") or it.get("category") not in ("halal", "food", "cosmetic") or not it.get("question_en"):
                continue
            rid = it.get("id") if it.get("id") in by_id else ids["FAQ"]()
            old = by_id.get(rid, {})
            row = {
                "id": rid, "category": it["category"], "subcategory": it.get("subcategory", ""),
                "question_en": it.get("question_en", ""), "question_bm": it.get("question_bm", ""),
                "answer_formal_en": it.get("answer_formal_en", ""), "answer_layman_en": it.get("answer_layman_en", ""),
                "answer_formal_bm": it.get("answer_formal_bm", ""), "answer_layman_bm": it.get("answer_layman_bm", ""),
                "source_refs": ";".join(sorted(set((old.get("source_refs", "").split(";") if old.get("source_refs") else []) + [str(x) for x in it.get("source_msg_ids", [])])))[:500],
                "confidence": it.get("confidence", "medium"),
                "status": old.get("status") or ("published" if it.get("confidence") == "high" and not RISKY.search(" ".join(str(it.get(k, "")) for k in ("answer_formal_en", "answer_formal_bm", "answer_layman_en", "answer_layman_bm"))) else "draft"),
                "created_at": old.get("created_at") or ts, "updated_at": ts, "model": f"{provider}:{model}",
            }
            faq_rows.append(row); by_id[rid] = row
        faq = list(by_id.values())

        att_index = {}
        for r in rows:
            for a in json.loads(r.get("attachments") or "[]"):
                if a.get("drive_file_id"):
                    att_index[(r["id"], a.get("name"))] = a
        for d in j.get("documents", []):
            a = att_index.get((d.get("source_msg_id"), d.get("attachment_name")))
            if not a:
                continue
            doc_rows.append({"id": ids["DOC"](), "title": d.get("title") or a["name"], "kind": d.get("kind", "other"), "category": d.get("category", "halal"),
                             "drive_file_id": a["drive_file_id"], "drive_url": a.get("drive_url", ""), "content_hash": a.get("sha256", ""), "version": "",
                             "supersedes_id": "", "source_msg_id": d.get("source_msg_id"), "received_at": next((r["ts"] for r in rows if r["id"] == d.get("source_msg_id")), ts),
                             "updated_at": ts, "status": "inbox", "notes": "awaiting organiser"})
        for e in j.get("events", []):
            if e.get("title"):
                ev_rows.append({"id": ids["EV"](), "title": e["title"], "title_bm": e.get("title_bm", ""), "date_start": e.get("date_start", ""), "date_end": "", "venue": e.get("venue", ""),
                                "poster_url": "", "link": safe_url(e.get("link")), "description": e.get("description", ""), "status": "draft", "source": e.get("source_msg_id", "")})
        for g in j.get("guidelines", []):
            if g.get("title"):
                gl_rows.append({"id": ids["GL"](), "category": g.get("category", "halal"), "title": g["title"], "title_bm": g.get("title_bm", ""), "summary_en": g.get("summary_en", ""),
                                "summary_bm": g.get("summary_bm", ""), "link": safe_url(g.get("link")), "issuer": g.get("issuer", ""), "effective_date": "", "updated_at": ts, "status": "draft", "source": g.get("source_msg_id", "")})

        print(f"batch {batches}: {len(rows)} msgs → faq {len(faq_rows)} docs {len(doc_rows)} events {len(ev_rows)} guidelines {len(gl_rows)} via {provider}/{model}")
        if dry:
            print(json.dumps({"faq": faq_rows, "documents": doc_rows, "events": ev_rows, "guidelines": gl_rows}, ensure_ascii=False, indent=1)[:4000])
            break
        if faq_rows: he_api.upsert("FAQ", faq_rows)
        if doc_rows: he_api.upsert("Documents", doc_rows)
        if ev_rows: he_api.upsert("Events", ev_rows)
        if gl_rows: he_api.upsert("Guidelines", gl_rows)
        relevant = {str(x) for it in j.get("items", []) if it.get("relevant") for x in it.get("source_msg_ids", [])}
        # A message that became a document, event or guideline was used too.
        relevant |= {str(x.get("source_msg_id")) for key in ("documents", "events", "guidelines") for x in j.get(key, []) if x.get("source_msg_id")}
        done = [r["id"] for r in rows if r["id"] in relevant]
        skipped = [r["id"] for r in rows if r["id"] not in relevant]
        if done: he_api.raw_update(done, status="processed", processed_at=ts, model=f"{provider}:{model}")
        if skipped: he_api.raw_update(skipped, status="skipped", processed_at=ts, model=f"{provider}:{model}")
        total += len(rows)

    if not dry:
        he_api.run_log("process_raw:" + ",".join(sources), provider, model, total, not err, err)
    print(f"done: {total} messages in {batches} batches" + (f"; FAILED: {err}" if err else ""))
    return 0 if not err else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="whatsapp,telegram,manual")
    ap.add_argument("--max-batches", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    sys.exit(run([s.strip() for s in a.source.split(",") if s.strip()], a.max_batches, a.dry_run))
