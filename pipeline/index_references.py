"""Index references uploaded in Admin: page-numbered passages + a summary.

For each References row with status "pending":
  1. fetch the file through Apps Script (drive_get with bytes);
  2. PDF: text per page with pypdf; a page with no text layer (a scan) is
     OCR'd with Tesseract (eng+msa), installed on first need;
     Word / Excel / PowerPoint / text: Apps Script extracts the text, slides
     and sheets keep their numbers, Word is split into parts of ~3000 chars;
  3. split each page into ~1100-character passages with overlap, keeping the
     page number for citations;
  4. ask the router (MIRELD / AFIQ) for a short summary and key points — the
     "memory" shown in the References tab and used to rank results;
  5. write the passages to RefChunks and mark the row "indexed".

  python index_references.py
"""
import base64
import datetime as dt
import io
import json
import re
import shutil
import subprocess
import sys

import he_api
import llm_router

PASSAGE = 1100
OVERLAP = 150
STOP = set("the a an of to in is are for and or on with be by as at from that this it its which shall may must will not no any all other such has have been were was".split()
           + "yang dan di ke dari untuk adalah ini itu oleh dengan atau pada dalam bagi tidak hendaklah boleh telah akan serta jika maka iaitu ialah".split())

SUMMARY = """You summarise an official reference document for halal executives in Malaysia. From the text given, return JSON:
{"summary_en":"3-5 sentences: what the document is, who it applies to, what it governs","summary_bm":"the same in Bahasa Malaysia (Malaysian register, never Indonesian)","key_points":["up to 8 short points, each naming the clause or section if the text shows it"],"edition":"edition or year if printed, else empty"}
Use only the text given. Never invent clause numbers."""


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def ensure_tesseract():
    if shutil.which("tesseract"):
        return True
    try:
        subprocess.run(["sudo", "apt-get", "-qq", "update"], check=True, timeout=300)
        subprocess.run(["sudo", "apt-get", "-qq", "install", "-y", "tesseract-ocr", "tesseract-ocr-msa", "poppler-utils"], check=True, timeout=600)
        return bool(shutil.which("tesseract"))
    except Exception as e:  # noqa: BLE001
        print("could not install tesseract:", e, file=sys.stderr)
        return False


def pdf_pages(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    # Many official PDFs are encrypted only to stop editing or printing (no
    # password to open); an empty password unlocks them for reading. AES needs
    # the cryptography package (requirements.txt).
    if reader.is_encrypted and not reader.decrypt(""):
        raise RuntimeError("this PDF needs a password to open; upload an unlocked copy")
    pages = [(i + 1, (p.extract_text() or "").strip()) for i, p in enumerate(reader.pages)]
    empty = [n for n, t in pages if len(t) < 40]
    if empty and ensure_tesseract():
        from pdf2image import convert_from_bytes
        import pytesseract
        print(f"  OCR for {len(empty)} scanned pages")
        for n in empty:
            img = convert_from_bytes(data, dpi=200, first_page=n, last_page=n)[0]
            text = pytesseract.image_to_string(img, lang="eng+msa")
            pages[n - 1] = (n, text.strip())
    return pages


def office_pages(text):
    """Text from Apps Script: '## Slide n' / '## <sheet>' markers, else parts."""
    if re.search(r"^## (Slide \d+|.+)$", text, re.M):
        out, cur, label = [], [], None
        for line in text.splitlines():
            m = re.match(r"^## (.+)$", line)
            if m:
                if label is not None:
                    out.append((label, "\n".join(cur).strip()))
                label, cur = m.group(1).replace("Slide ", "slide "), []
            else:
                cur.append(line)
        if label is not None:
            out.append((label, "\n".join(cur).strip()))
        return out
    parts, n = [], 1
    for i in range(0, len(text), 3000):
        parts.append((f"part {n}", text[i:i + 3000])); n += 1
    return parts


def passages(pages):
    out, k = [], 0
    for page, text in pages:
        text = re.sub(r"[ \t]+", " ", text or "").strip()
        if len(text) < 30:
            continue
        i = 0
        while i < len(text):
            piece = text[i:i + PASSAGE]
            if i + PASSAGE < len(text):  # end on a sentence or line where we can
                cut = max(piece.rfind(". "), piece.rfind("\n"))
                if cut > PASSAGE * 0.6:
                    piece = piece[:cut + 1]
            words = [w for w in re.findall(r"[a-z0-9]{3,}", piece.lower()) if w not in STOP]
            terms = " ".join(sorted(set(words), key=words.count, reverse=True)[:12])
            out.append({"n": k, "page": page, "text": piece.strip(), "terms": terms}); k += 1
            if i + len(piece) >= len(text):
                break
            i += max(len(piece) - OVERLAP, 1)
    return out


def index_one(r):
    meta = he_api.drive_get(r["drive_file_id"], text=False, bytes_=True)
    data = base64.b64decode(meta.get("b64") or "")
    mime = (meta.get("mime") or r.get("mime") or "").lower()
    name = (meta.get("name") or "").lower()
    if "pdf" in mime or name.endswith(".pdf"):
        pages = pdf_pages(data)
    elif mime.startswith("text/") or name.endswith((".txt", ".md")):
        pages = office_pages(data.decode("utf-8", "replace"))
    else:
        pages = office_pages(he_api.drive_get(r["drive_file_id"], text=True).get("text") or "")
    chunks = passages(pages)
    if not chunks:
        raise RuntimeError("no readable text in the file")
    sample = "\n\n".join(f"[page {c['page']}] {c['text']}" for c in chunks[:14])[:14000]
    provider = model = ""
    summ = {}
    try:
        out = llm_router.complete_json([{"role": "system", "content": SUMMARY}, {"role": "user", "content": f"Title: {r.get('title')}\n\n{sample}"}], max_tokens=1200)
        summ, provider, model = out["json"], out["provider"], out["model"]
    except llm_router.LLMError as e:
        print("  summary skipped:", e, file=sys.stderr)
    for i in range(0, len(chunks), 400):
        he_api.post("ref_chunks", ref_id=r["id"], replace=(i == 0), chunks=chunks[i:i + 400])
    pages_n = len([p for p in pages if (p[1] or "").strip()])
    unreadable = len([p for p in pages if len((p[1] or "").strip()) < 40])
    he_api.upsert("References", [{**r, "pages": pages_n, "chunks": len(chunks), "summary_en": summ.get("summary_en", r.get("summary_en", "")),
                                  "summary_bm": summ.get("summary_bm", r.get("summary_bm", "")), "key_points": json.dumps(summ.get("key_points", []), ensure_ascii=False),
                                  "edition": r.get("edition") or summ.get("edition", ""), "status": "indexed", "indexed_at": now(),
                                  "error": (f"{unreadable} pages unreadable" if unreadable else "") + (f"; {r['error']}" if str(r.get("error", "")).startswith("audit") else "")}])
    print(f"  {r['id']}: {pages_n} pages, {len(chunks)} passages")
    return provider, model


# ---- Guidelines follow the references library --------------------------
# Every indexed reference appears on the Guidelines tab with the summary the
# model wrote from the document itself (rule 12: the file stays private, so no
# link to it). A reference that matches a guideline already listed (same title
# words, ignoring the year) updates that row instead of adding a twin; an
# amendment ("Pindaan …", "Amendment …") is always its own row.
AMEND = {"pindaan", "amendment", "amended", "addendum", "semakan"}


def title_words(t):
    return {w for w in re.sub(r"[^a-z ]", " ", str(t or "").lower()).split() if len(w) > 1 and w not in {"the", "of", "and", "dan", "for"}}


def same_doc(a, b):
    wa, wb = title_words(a), title_words(b)
    if not wa or not wb or (wa & AMEND) != (wb & AMEND):
        return False
    return wa == wb or wa <= wb or wb <= wa


def sync_guidelines():
    try:
        refs = [r for r in he_api.read("References") if r.get("status") == "indexed" and (r.get("summary_en") or r.get("summary_bm"))]
        gls = he_api.read("Guidelines")
    except he_api.ApiError as e:
        print("guidelines sync skipped:", e)
        return
    out = []
    for r in refs:
        g = next((x for x in gls if x.get("source") == r["id"]), None) or next((x for x in gls if same_doc(x.get("title"), r.get("title"))), None)
        row = {**(g or {}), "id": (g or {}).get("id") or f"GL-{r['id']}", "category": r.get("category") or (g or {}).get("category") or "halal",
               "title": (g or {}).get("title") or r.get("title"), "title_bm": (g or {}).get("title_bm") or r.get("title"),
               "summary_en": r.get("summary_en") or (g or {}).get("summary_en", ""), "summary_bm": r.get("summary_bm") or (g or {}).get("summary_bm", ""),
               "link": (g or {}).get("link", ""), "issuer": r.get("issuer") or (g or {}).get("issuer", ""),
               "effective_date": str(r.get("edition") or (g or {}).get("effective_date") or ""), "status": "published", "source": r["id"]}
        keep = ("summary_en", "summary_bm", "issuer", "effective_date", "status", "source", "category")
        if g and all(str(g.get(k, "")) == str(row.get(k, "")) for k in keep):
            continue
        row["updated_at"] = now()
        out.append(row)
    if out:
        he_api.upsert("Guidelines", out)
    # Guidelines list exactly what the references library holds (Wan, 14 Oct
    # 2026): a guideline with no indexed reference behind it (the seeded
    # placeholders, a reference deleted or hidden, or one the AI took from a
    # group message) is removed. Uploading the document brings it back.
    ref_ids = {r["id"] for r in refs}
    linked = {row["id"] for row in out} | {g["id"] for g in gls if g.get("source") in ref_ids}
    orphans = [g["id"] for g in gls if g["id"] not in linked]
    if orphans:
        he_api.delete("Guidelines", orphans)
    print(f"guidelines: {len(out)} added or updated, {len(orphans)} without a reference removed")


# ---- Review: every 3 hours (job "references"), until each reference is whole --
MAX_TRIES = 5


def audit():
    try:
        refs = [r for r in he_api.read("References") if r.get("status") == "indexed"]
        chunks = he_api.read("RefChunks")
    except he_api.ApiError as e:
        print("audit skipped:", e)
        return
    have = {}
    for c in chunks:
        have[c.get("ref_id")] = have.get(c.get("ref_id"), 0) + 1
    redo = []
    for r in refs:
        why = []
        if have.get(r["id"], 0) == 0 or have.get(r["id"], 0) < int(r.get("chunks") or 0):
            why.append(f"passages {have.get(r['id'], 0)}/{r.get('chunks')}")
        summ = str(r.get("summary_en") or "").strip()
        if not summ or summ[-1] not in ".!?)\"'":
            why.append("summary missing or cut off")
        if str(r.get("key_points") or "").strip() in ("", "[]"):
            why.append("no key points")
        m = re.search(r"(\d+) pages unreadable", str(r.get("error") or ""))
        if m and int(m.group(1)) > 0:
            why.append(f"{m.group(1)} pages unreadable")
        if not why:
            continue
        t = re.search(r"try (\d+)", str(r.get("error") or ""))
        tries = int(t.group(1)) + 1 if t else 1
        if tries > MAX_TRIES:
            print(f"  {r['id']}: still incomplete after {MAX_TRIES} reviews ({', '.join(why)}); left as is")
            continue
        redo.append({**r, "status": "pending", "error": f"audit try {tries}: {', '.join(why)}"})
        print(f"  {r['id']}: re-reading ({', '.join(why)}), try {tries}")
    if redo:
        he_api.upsert("References", redo)
    print(f"review: {len(refs)} references checked, {len(redo)} queued to read again")


def run():
    try:
        rows = he_api.read("References")
    except he_api.ApiError as e:
        # The Sheet has not been given the new Code.gs yet (no References tab).
        print("references not set up yet:", e)
        return 0
    # Pending rows, plus rows that failed only because the runner lacked the
    # AES package (fixed 14 Oct 2026), so nobody has to press Re-read for them.
    refs = [r for r in rows if r.get("status") == "pending" or (r.get("status") == "error" and "cryptography" in str(r.get("error", "")))]
    if not refs:
        print("no references waiting")
        sync_guidelines()
        return 0
    provider = model = ""
    errs = []
    for r in refs:
        print("indexing", r["id"], r.get("title"))
        try:
            provider, model = index_one(r) or (provider, model)
        except Exception as e:  # noqa: BLE001
            errs.append(f"{r['id']}: {e}")
            he_api.upsert("References", [{**r, "status": "error", "error": str(e)[:300]}])
            print("  failed:", e, file=sys.stderr)
    he_api.run_log("index_references", provider, model, len(refs) - len(errs), not errs, "; ".join(errs)[:500])
    sync_guidelines()
    return 1 if errs else 0


if __name__ == "__main__":
    if "--audit" in sys.argv:
        audit()
    sys.exit(run())
