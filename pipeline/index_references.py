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
    he_api.upsert("References", [{**r, "pages": pages_n, "chunks": len(chunks), "summary_en": summ.get("summary_en", r.get("summary_en", "")),
                                  "summary_bm": summ.get("summary_bm", r.get("summary_bm", "")), "key_points": json.dumps(summ.get("key_points", []), ensure_ascii=False),
                                  "edition": r.get("edition") or summ.get("edition", ""), "status": "indexed", "indexed_at": now(), "error": ""}])
    print(f"  {r['id']}: {pages_n} pages, {len(chunks)} passages")
    return provider, model


def run():
    try:
        rows = he_api.read("References")
    except he_api.ApiError as e:
        # The Sheet has not been given the new Code.gs yet (no References tab).
        print("references not set up yet:", e)
        return 0
    refs = [r for r in rows if r.get("status") == "pending"]
    if not refs:
        print("no references waiting")
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
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(run())
