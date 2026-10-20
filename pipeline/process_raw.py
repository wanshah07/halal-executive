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
import base64
import datetime as dt
import json
import re
import sys

import time

import he_api
import llm_router
import qr_links
from prompts import SYSTEM, VACANCY_READ

# An answer that carries a link or a phone number is never published without
# review: group messages can be wrong or planted.
RISKY = re.compile(r"(https?://|www\.|\+?6?01\d[\s-]?\d{3,4}[\s-]?\d{4}|wa\.me)", re.I)

BATCH = 25
CHAR_BUDGET = 40000      # per model call; rows with long attachments make smaller batches
ATTACH_CHARS = 6000      # text kept from one attachment


def dicts(x):
    """Only the dict entries of a list the model returned (it sometimes puts
    a bare string or number in one)."""
    return [e for e in (x if isinstance(x, list) else []) if isinstance(e, dict)]


def shape(j):
    """The model is asked for an object {items, documents, events, guidelines}.
    It sometimes answers with the items list alone (run 18 on 14 Oct 2026
    crashed on exactly that and stopped every run after it)."""
    if isinstance(j, list):
        j = {"items": j}
    if not isinstance(j, dict):
        j = {}
    return {k: dicts(j.get(k)) for k in ("items", "documents", "events", "guidelines", "vacancies")}


ADMIN_CERT = "Admin upload: this is a halal certificate"
ADMIN_EVENT = "Admin upload: this is an event"
ADMIN_VACANCY = "Admin upload: this is a job vacancy"
VAC_TEXT = re.compile(r"\b(vacanc(y|ies)|jawatan kosong|kekosongan jawatan|we.?re hiring|hiring|now hiring|job opening|career opportunit|apply now|mohon segera|send (your )?(cv|resume)|hantar (cv|resume)|position available)\b", re.I)
VAC_KEYS = ("title", "title_bm", "employer", "location", "state", "job_type", "salary", "requirements", "description", "apply_link", "apply_email", "apply_phone", "closing_date", "category")
VISION_FILE = re.compile(r"^image/|application/pdf", re.I)


def _jobs(j):
    j = j if isinstance(j, dict) else {}
    if j.get("is_vacancy") is False:
        return []
    jobs = j.get("jobs") if isinstance(j.get("jobs"), list) else ([j] if j.get("title") else [])
    return [x for x in jobs if isinstance(x, dict) and str(x.get("title") or "").strip()]


def _thin(v):
    """A reading that missed the job title or every way to apply."""
    return not v or not str(v.get("title") or "").strip() or not any(str(v.get(k) or "").strip() for k in ("apply_link", "apply_email", "apply_phone"))


def read_vacancy(m, rows):
    """Every job in one vacancy ad, read on its own so no detail is lost (Wan,
    20 Oct 2026: "AI can read all details without fail"). Two passes: the words
    (message text plus the OCR of its attachments) through the text AI, then,
    when that left the job title or the way to apply empty, the poster itself
    through a picture-reading AI (vision_read). The second pass fills only the
    fields the first left empty, so a detail read from the words is never
    overwritten by a guess from the picture."""
    sys_p = VACANCY_READ.replace("TODAY", dt.date.today().isoformat())
    text = "\n\n".join([m.get("text") or ""] + [a.get("content") or "" for a in m.get("attachments", [])]).strip()
    jobs = []
    if text:
        try:
            out = llm_router.complete_json([{"role": "system", "content": sys_p}, {"role": "user", "content": text[:9000]}], max_tokens=1800, temperature=0)
            jobs = _jobs(out["json"])
        except llm_router.LLMError as e:
            print("vacancy not read from text:", e, file=sys.stderr)
    if jobs and not any(_thin(v) for v in jobs):
        return jobs
    r = next((x for x in rows if str(x["id"]) == str(m["id"])), None)
    for a in json.loads((r or {}).get("attachments") or "[]"):
        if not a.get("drive_file_id") or not VISION_FILE.search(str(a.get("mime") or "")):
            continue
        try:
            got = he_api.post("vision_read", id=a["drive_file_id"], system=sys_p, prompt="Read every job in this vacancy advert.", json=True)
        except he_api.ApiError as e:
            print("vacancy picture not read:", str(e)[:120], file=sys.stderr)
            continue
        seen = _jobs(got.get("json")) if got.get("ok") and got.get("read") else []
        if not seen:
            continue
        if not jobs:
            return seen
        for i, v in enumerate(jobs):  # fill only what the words left empty
            p = seen[i] if i < len(seen) else seen[0]
            for k in VAC_KEYS:
                if not str(v.get(k) or "").strip() and str(p.get(k) or "").strip():
                    v[k] = p[k]
        return jobs
    return jobs

EVENT_READ = """You read a poster or announcement for an event in Malaysia (seminar, course, training, talk, expo) for halal executives. Return JSON {"is_event":true|false,"title":"","title_bm":"","date_start":"YYYY-MM-DDTHH:MM","date_end":"","venue":"","link":"","description":""}. Dates in Malaysia time as printed; if the year is not printed use the next date on or after TODAY. Time 09:00 if none is printed. title in English, title_bm in Bahasa Malaysia (Malaysian, never Indonesian). description: 2-4 short sentences (organiser, audience, fee and contact as printed). Never invent a date, fee or link."""


def read_event(m):
    """The event on one Admin-uploaded poster, read on its own."""
    text = "\n\n".join([m.get("text") or ""] + [a.get("content") or "" for a in m.get("attachments", [])]).strip()
    if not text:
        return None
    try:
        out = llm_router.complete_json([{"role": "system", "content": EVENT_READ.replace("TODAY", dt.date.today().isoformat())}, {"role": "user", "content": text[:8000]}], max_tokens=900, temperature=0)
    except llm_router.LLMError as e:
        print("event not read:", e, file=sys.stderr)
        return None
    j = out["json"] if isinstance(out["json"], dict) else {}
    return j if j.get("is_event") is not False and j.get("title") else None


def poster_for(mid, rows, dry):
    """The poster of an event announced with a picture or PDF in the group:
    copied to Drive "30 Posters" and shared view-only by Apps Script, exactly
    like a poster uploaded in Admin, so the draft event shows it."""
    r = next((x for x in rows if str(x["id"]) == str(mid)), None)
    if not r or dry:
        return "", ""
    for a in json.loads(r.get("attachments") or "[]"):
        if a.get("drive_file_id") and re.match(r"image/|application/pdf", str(a.get("mime") or "")):
            try:
                p = he_api.post("poster_from_drive", id=a["drive_file_id"])
                return p.get("url", ""), p.get("file", "")
            except he_api.ApiError as e:
                print("poster not copied:", e, file=sys.stderr)
    return "", ""


QR_FILE = re.compile(r"(^image/|application/pdf|presentationml|wordprocessingml)|\.(png|jpe?g|webp|gif|bmp|tiff?|heic|pdf|pptx|docx)$", re.I)
_qr_seen = {}


def qr_link_for(mid, rows):
    """The registration link printed as a QR code on the poster of event
    message `mid`, or "". A model reading the poster's text never sees a QR
    code, so it is decoded from the file itself (qr_links.py): pictures, PDF
    pages and the pictures inside PowerPoint and Word files (Wan, 18 Oct 2026).
    Admin uploads and group posters both come through here."""
    r = next((x for x in rows if str(x["id"]) == str(mid)), None)
    if not r:
        return ""
    for a in json.loads(r.get("attachments") or "[]"):
        fid = a.get("drive_file_id")
        if not fid or not QR_FILE.search(str(a.get("mime") or "") + " " + str(a.get("name") or "")):
            continue
        if fid not in _qr_seen:
            urls = []
            try:
                got = he_api.drive_get(fid, text=False, bytes_=True)
                if got.get("b64") and int(got.get("size") or 0) <= 25_000_000:
                    urls = qr_links.links_from_bytes(base64.b64decode(got["b64"]), a.get("name", ""))
            except (he_api.ApiError, ValueError) as e:
                print(f"QR: {a.get('name')} not read: {e}", file=sys.stderr)
            _qr_seen[fid] = urls
            if urls:
                print(f"QR: {a.get('name')} holds {urls[0]}" + (f" (+{len(urls) - 1} more)" if len(urls) > 1 else ""))
        if _qr_seen[fid]:
            return _qr_seen[fid][0]
    return ""


def _day(v):
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def event_past(e, msg_ts):
    """An event that has ended, or one taken from a message more than 120 days
    old (the chat-export backlog: the model fills a missing year with the
    current one, so an old seminar would look upcoming)."""
    today = dt.date.today()
    end = _day(e.get("date_end")) or _day(e.get("date_start"))
    if end and end < today:
        return True
    sent = _day(msg_ts)
    return bool(sent and (today - sent).days > 120)


def msg_ids(it):
    x = it.get("source_msg_ids")
    return [str(v) for v in (x if isinstance(x, list) else [x] if x else [])]


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


# Pictures from WhatsApp and Telegram are read by a picture-reading AI when OCR
# gets little or nothing from them (Wan, 20 Oct 2026: "make sure the whatsapp and
# telegram can read image from the sources, read by AI"): a poster, a screenshot of
# a circular or a photo of a certificate then reaches the model as words. Capped
# per run so a backlog of photos cannot use up the gateway (30 a minute on Wanshah 1).
PIC_FILE = re.compile(r"^image/|application/pdf", re.I)
PIC_READ = """Read this picture from a halal industry group chat in Malaysia. First copy out EVERY word printed in it exactly as printed, line by line (titles, names, dates, numbers, links, emails, phone numbers, prices). Then, after a line '---', say in one or two sentences what the picture is (poster for an event, job vacancy ad, halal certificate, circular, screenshot of a chat, product photo, other). Never invent text that is not in the picture."""
PIC_MAX = 30
_pic = {"n": 0, "ready": None}


def picture_text(file_id):
    """Words read from one picture by Wanshah 1, 3 or 2 (Code.gs vision_read picks)."""
    if _pic["ready"] is None:
        try:
            _pic["ready"] = bool(he_api.post("vision_read", ping=True).get("ready"))
        except he_api.ApiError:
            _pic["ready"] = False
    if not _pic["ready"] or _pic["n"] >= PIC_MAX:
        return ""
    _pic["n"] += 1
    try:
        r = he_api.post("vision_read", id=file_id, system=PIC_READ, prompt="Read this picture.")
    except he_api.ApiError as e:
        print("picture not read:", str(e)[:120], file=sys.stderr)
        return ""
    return str(r.get("text") or "").strip() if r.get("ok") and r.get("read") else ""


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
            # Too little from OCR: the AI looks at the picture itself.
            if PIC_FILE.search(str(a.get("mime") or "")) and len(re.sub(r"\s+", "", item.get("content") or "")) < 120:
                seen = picture_text(a["drive_file_id"])
                if seen:
                    item["content"] = ((item.get("content") or "") + "\n[read by AI from the picture]\n" + seen)[:ATTACH_CHARS]
        atts.append(item)
    return {"id": r["id"], "source": r.get("source", ""), "ts": r["ts"], "text": (r.get("text") or "")[:3000], "attachments": atts}


# ---- Duplicate guards ----------------------------------------------------
# The model is told to reuse an existing FAQ id for the same question, but it
# does not always; these checks make sure the same question, event, guideline
# or document never lands twice, whatever the model returns.
STOPW = set("the a an of to in is are for and or on do does can i we our my it this that be with what how if any yang dan di ke untuk adalah ini itu apa bagaimana boleh perlu ada kah tak tidak saya kami kita dengan atau jika".split())


CERT_TEXT = re.compile(r"sijil\s+pengesahan\s+halal|halal\s+certificat|certificate\s+of\s+halal|perakuan\s+halal|pengesahan\s+halal\s+malaysia", re.I)


def toks(s):
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", str(s or "").lower()).split() if len(w) > 1 and w not in STOPW}


def same_question(a, b):
    ta, tb = toks(a), toks(b)
    if len(ta) < 3 or len(tb) < 3:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.75


def match_faq(it, faq):
    for f in faq:
        if f.get("status") == "hidden":
            continue
        if same_question(it.get("question_en"), f.get("question_en")) or same_question(it.get("question_bm"), f.get("question_bm")):
            return f["id"]
    return None


def norm_title(s):
    return " ".join(sorted(toks(s)))


def existing_faq_digest(faq):
    # Short list so the model can merge duplicates instead of creating twins.
    return [{"id": f["id"], "category": f["category"], "question_en": f["question_en"][:160]} for f in faq if f.get("status") != "hidden"][:400]


def run(sources, max_batches, dry, minutes=20, attachments=None):
    """One phase: reads batches until the queue is empty or `minutes` have
    passed, then stops cleanly so the next 30-minute run carries on (the KKM
    complaints routine works the same way). Nothing is lost when it stops:
    a row is only marked once its batch is filed."""
    start = time.time()
    job = "process_raw:" + ",".join(sources)
    try:
        left0 = int(he_api.post("raw_stats").get("new", 0))
    except Exception:
        left0 = 0

    def note(text, state="running"):
        print(text, flush=True)
        if not dry:
            try:
                he_api.progress(job, text, state=state, done=total, left=max(left0 - total, 0))
            except Exception as e:  # progress is a nicety; never stop the run for it
                print("progress not saved:", e, file=sys.stderr)

    faq = he_api.read("FAQ")
    docs = he_api.read("Documents")
    events = he_api.read("Events")
    gls = he_api.read("Guidelines")
    try:
        vacs = he_api.read("Vacancies")
    except he_api.ApiError:  # Code.gs older than the Vacancies tab
        vacs = None
    ids = {"FAQ": Ids("FAQ", faq), "DOC": Ids("DOC", docs), "EV": Ids("EV", events), "GL": Ids("GL", gls), "VAC": Ids("VAC", vacs or [])}
    seen_files = {str(d.get("drive_file_id")) for d in docs if d.get("drive_file_id")}
    seen_hashes = {str(d.get("content_hash")) for d in docs if d.get("content_hash")}
    seen_events = {(norm_title(e.get("title")), str(e.get("date_start", ""))[:10]) for e in events}
    seen_guidelines = {norm_title(g.get("title")) for g in gls}
    seen_vacancies = {(norm_title(v.get("title")), norm_title(v.get("employer"))) for v in (vacs or [])}
    total, batches, provider, model, err = 0, 0, "", "", ""
    stopped = ""
    note(f"started: {left0} messages waiting")

    while batches < max_batches:
        if time.time() - start > minutes * 60:
            stopped = f"time box of {minutes} min reached; the next run carries on"
            break
        rows = []
        for s in sources:
            rows += he_api.raw_list(status="new", source=s, limit=BATCH, attachments=None if s == "manual" else attachments)
        if attachments is not None:  # also here, in case Apps Script is an older version that ignores the filter
            rows = [r for r in rows if r.get("source") == "manual" or ('"name"' in str(r.get("attachments") or "")) == attachments]
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
        j = shape(out["json"])
        if out.get("fallback_from"):
            print(f"fallback: {out['fallback_from']} failed ({out['first_error'][:120]}), {provider} answered")

        def handle():
            nonlocal faq, total
            ts = now()
            faq_rows, doc_rows, ev_rows, gl_rows, vac_rows = [], [], [], [], []
            by_id = {f["id"]: f for f in faq}
            for it in j["items"]:
                if not it.get("relevant") or it.get("category") not in ("halal", "food", "cosmetic") or not it.get("question_en"):
                    continue
                rid = it.get("id") if it.get("id") in by_id else (match_faq(it, list(by_id.values())) or ids["FAQ"]())
                old = by_id.get(rid, {})
                row = {
                    "id": rid, "category": it["category"], "subcategory": it.get("subcategory", ""),
                    "question_en": it.get("question_en", ""), "question_bm": it.get("question_bm", ""),
                    "answer_formal_en": it.get("answer_formal_en", ""), "answer_layman_en": it.get("answer_layman_en", ""),
                    "answer_formal_bm": it.get("answer_formal_bm", ""), "answer_layman_bm": it.get("answer_layman_bm", ""),
                    "source_refs": ";".join(sorted(set((old.get("source_refs", "").split(";") if old.get("source_refs") else []) + msg_ids(it))))[:500],
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
            src_of = {str(r["id"]): r.get("source", "") for r in rows}

            def origin(mid):
                # Admin uploads are published by the organiser; group files wait as drafts.
                return "from:admin; " if src_of.get(str(mid)) == "manual" else "from:group; "

            for d in j["documents"]:
                a = att_index.get((d.get("source_msg_id"), d.get("attachment_name")))
                if not a:
                    continue
                if a["drive_file_id"] in seen_files or (a.get("sha256") and a["sha256"] in seen_hashes):
                    continue  # this file is already a Documents row
                seen_files.add(a["drive_file_id"]); seen_hashes.add(a.get("sha256") or a["drive_file_id"])
                doc_rows.append({"id": ids["DOC"](), "title": d.get("title") or a["name"], "kind": d.get("kind", "other"), "category": d.get("category", "halal"),
                                 "drive_file_id": a["drive_file_id"], "drive_url": a.get("drive_url", ""), "content_hash": a.get("sha256", ""), "version": "",
                                 "supersedes_id": "", "source_msg_id": d.get("source_msg_id"), "received_at": next((r["ts"] for r in rows if r["id"] == d.get("source_msg_id")), ts),
                                 "updated_at": ts, "status": "inbox", "notes": origin(d.get("source_msg_id")) + "awaiting organiser"})
            # A halal certificate posted in the group is filed even when the model
            # did not list it: the text read from the picture or PDF decides.
            for m in msgs:
                for att in m.get("attachments", []):
                    if not (CERT_TEXT.search(att.get("content") or "") or (m.get("text") or "").startswith(ADMIN_CERT)):
                        continue
                    a = att_index.get((m["id"], att.get("name")))
                    if not a or a["drive_file_id"] in seen_files:
                        continue
                    seen_files.add(a["drive_file_id"])
                    doc_rows.append({"id": ids["DOC"](), "title": "Halal certificate", "kind": "certificate", "category": "halal",
                                     "drive_file_id": a["drive_file_id"], "drive_url": a.get("drive_url", ""), "content_hash": a.get("sha256", ""), "version": "",
                                     "supersedes_id": "", "source_msg_id": m["id"], "received_at": m.get("ts") or ts,
                                     "updated_at": ts, "status": "inbox", "notes": origin(m["id"]) + "certificate text found; awaiting organiser"})
            msg_ts = {str(r["id"]): str(r.get("ts") or "") for r in rows}
            # An Admin upload marked "Event" always becomes an event, like a
            # certificate upload: when the batch reply did not list it, the
            # poster is read again on its own (Wan, 15 Oct 2026).
            listed = {str(e.get("source_msg_id")) for e in j["events"]}
            for m in msgs:
                if (m.get("text") or "").startswith(ADMIN_EVENT) and str(m["id"]) not in listed:
                    ev = read_event(m)
                    if ev:
                        j["events"].append(dict(ev, source_msg_id=m["id"]))
            for e in j["events"]:
                if event_past(e, msg_ts.get(str(e.get("source_msg_id")), "")):
                    continue  # over already, or announced in an old message: never a draft (Wan, 15 Oct 2026)
                ek = (norm_title(e.get("title")), str(e.get("date_start", ""))[:10])
                if e.get("title") and ek in seen_events:
                    continue  # same event (title words + day) already on file
                seen_events.add(ek)
                if e.get("title"):
                    poster, poster_file = poster_for(e.get("source_msg_id"), rows, dry)
                    # The QR code on the poster is the registration link; it wins
                    # over a link the model guessed from the text.
                    qr = qr_link_for(e.get("source_msg_id"), rows)
                    if qr and safe_url(e.get("link")) not in ("", qr):
                        print(f"event {str(e.get('title'))[:60]!r}: QR link replaces the text link {safe_url(e.get('link'))}")
                    ev_rows.append({"id": ids["EV"](), "title": e["title"], "title_bm": e.get("title_bm", ""), "date_start": e.get("date_start", ""), "date_end": e.get("date_end", ""), "venue": e.get("venue", ""),
                                    "poster_url": poster, "link": qr or safe_url(e.get("link")), "description": e.get("description", ""),
                                    # Group posters publish at once too (Wan, 20 Oct 2026: "all poster ...
                                    # from telegram and whatsapp is always automatic appear in the website").
                                    "status": "published",
                                    "source": e.get("source_msg_id", ""), "poster_file": poster_file,
                                    "kind": e.get("kind") if e.get("kind") in ("competency", "awareness", "executive", "auditor") else "other"})
            # Vacancies: every ad is read again on its own (words, then the
            # picture), so the batch reply's short version never decides what
            # a reader sees. An Admin upload marked Vacancy always is one; a
            # group message is one when the batch listed it or its words say so.
            if vacs is not None:
                by_msg = {}
                for v in j["vacancies"]:
                    by_msg.setdefault(str(v.get("source_msg_id")), []).append(v)
                for m in msgs:
                    words = " ".join([m.get("text") or ""] + [a.get("content") or "" for a in m.get("attachments", [])])
                    admin = (m.get("text") or "").startswith(ADMIN_VACANCY)
                    if not (admin or str(m["id"]) in by_msg or VAC_TEXT.search(words)):
                        continue
                    jobs = read_vacancy(m, rows) or by_msg.get(str(m["id"]), [])
                    for v in jobs:
                        vk = (norm_title(v.get("title")), norm_title(v.get("employer")))
                        if not v.get("title") or vk in seen_vacancies:
                            continue  # same job at the same employer already on file
                        cd = str(v.get("closing_date") or "")[:10]
                        if _day(cd) and _day(cd) < dt.date.today():
                            continue  # closed already: never listed
                        seen_vacancies.add(vk)
                        poster, poster_file = poster_for(m["id"], rows, dry)
                        manual = src_of.get(str(m["id"])) == "manual"
                        row = {k: ("\n".join(str(x) for x in v[k]) if isinstance(v.get(k), list) else str(v.get(k) or ""))[:4000 if k in ("description", "requirements") else 300] for k in VAC_KEYS}
                        row.update({"id": ids["VAC"](), "closing_date": cd if _day(cd) else "", "apply_link": safe_url(v.get("apply_link")),
                                    "category": v.get("category") if v.get("category") in ("halal", "food", "cosmetic") else "halal",
                                    "poster_url": poster, "poster_file": poster_file,
                                    # Vacancies from the groups publish at once too (Wan, 20 Oct 2026:
                                    # "make sure telegram can read and appear"); Admin can hide one.
                                    "status": "published", "source": str(m["id"]), "updated_at": ts})
                        vac_rows.append(row)
                        j["vacancies"].append({"source_msg_id": m["id"]})
            for g in j["guidelines"]:
                gk = norm_title(g.get("title"))
                if g.get("title") and gk in seen_guidelines:
                    continue  # this guideline is already listed
                seen_guidelines.add(gk)
                if g.get("title"):
                    gl_rows.append({"id": ids["GL"](), "category": g.get("category", "halal"), "title": g["title"], "title_bm": g.get("title_bm", ""), "summary_en": g.get("summary_en", ""),
                                    "summary_bm": g.get("summary_bm", ""), "link": safe_url(g.get("link")), "issuer": g.get("issuer", ""), "effective_date": "", "updated_at": ts, "status": "draft", "source": g.get("source_msg_id", "")})

            print(f"batch {batches}: {len(rows)} msgs → faq {len(faq_rows)} docs {len(doc_rows)} events {len(ev_rows)} guidelines {len(gl_rows)} vacancies {len(vac_rows)} via {provider}/{model}")
            if dry:
                print(json.dumps({"faq": faq_rows, "documents": doc_rows, "events": ev_rows, "guidelines": gl_rows, "vacancies": vac_rows}, ensure_ascii=False, indent=1)[:4000])
                return "stop"
            if faq_rows: he_api.upsert("FAQ", faq_rows)
            if doc_rows: he_api.upsert("Documents", doc_rows)
            if ev_rows: he_api.upsert("Events", ev_rows)
            if vac_rows: he_api.upsert("Vacancies", vac_rows)
            # Guidelines mirror the references library only (index_references.py);
            # a guideline mentioned in a group message is not added on its own.
            relevant = {str(x) for it in j["items"] if it.get("relevant") for x in msg_ids(it)}
            # A message that became a document, event or guideline was used too.
            relevant |= {str(x.get("source_msg_id")) for key in ("documents", "events", "guidelines", "vacancies") for x in j[key] if x.get("source_msg_id")}
            relevant |= {str(d["source_msg_id"]) for d in doc_rows if d.get("source_msg_id")}
            done = [r["id"] for r in rows if r["id"] in relevant]
            skipped = [r["id"] for r in rows if r["id"] not in relevant]
            if done: he_api.raw_update(done, status="processed", processed_at=ts, model=f"{provider}:{model}")
            if skipped: he_api.raw_update(skipped, status="skipped", processed_at=ts, model=f"{provider}:{model}")
            total += len(rows)
        try:
            if handle() == "stop":
                break
        except Exception as e:  # one bad batch never stops the queue
            print(f"batch {batches} could not be filed ({type(e).__name__}: {e}); its rows are marked error and the run goes on", file=sys.stderr)
            if not dry:
                # Tried again on the next runs, up to 3 times, before it is left as an
                # error (Wan, 20 Oct 2026: "the 3 robots must fix all immediately").
                for r in rows:
                    tries = int((re.search(r"try (\d)", str(r.get("notes") or "")) or [0, 0])[1]) + 1
                    he_api.raw_update([r["id"]], status="new" if tries < 3 else "error", processed_at=now(), notes=f"try {tries}: {type(e).__name__}: {e}"[:200])
            total += len(rows)
        note(f"batch {batches}: {total} messages read this run")

    if not dry:
        he_api.run_log(job, provider, model, total, not err, err)
        try:  # the workflow starts the next run at once when this one ran out of time
            import os, pathlib
            d = pathlib.Path(os.environ.get("STATE_DIR", "."))
            d.mkdir(parents=True, exist_ok=True)
            (d / "more_waiting").write_text("1" if (stopped and total and not err) else "0")
        except OSError:
            pass
    note(f"finished: {total} messages in {batches} batches" + (f"; {stopped}" if stopped else "") + (f"; FAILED: {err}" if err else ""), state="failed" if err else "done")
    return 0 if not err else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    # Admin uploads first: a certificate dropped in Admin is read in the next
    # run, not after the whole chat-export backlog.
    ap.add_argument("--source", default="manual,whatsapp,telegram")
    ap.add_argument("--minutes", type=int, default=20)
    ap.add_argument("--attachments", choices=["only", "none", "all"], default="all",
                    help="only = group messages with a file (files lane), none = text only (backlog lane)")
    ap.add_argument("--max-batches", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    sys.exit(run([s.strip() for s in a.source.split(",") if s.strip()], a.max_batches, a.dry_run, a.minutes, {"only": True, "none": False}.get(a.attachments)))
