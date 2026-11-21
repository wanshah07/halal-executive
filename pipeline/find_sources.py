"""Find an official source for each open point in the FAQ (Admin: "Points not yet in your references").

Wan, 21 Nov 2026: "find the source yourself and connect with a Facebook group". For every point in
FAQ.verify_notes that no uploaded reference states, this pass:

  1. gathers candidate pages ONLY on official hosts (*.gov.my): a fixed list of seed pages
     (JAKIM halal portal, LOM, NPRA, and any WEB_SEEDS), the PDFs those pages link to, the official
     links people posted in the groups (Raw rows from Facebook, WhatsApp and Telegram), and what a
     web search returns for the point once its results are filtered to official hosts;
  (a Brave Search API key in the BRAVE_API_KEY secret makes the search reliable; without it a plain Bing page
  request is tried, which automated runs are often refused: the run log then says "search unusable")
  2. reads each page (HTML or PDF, page by page), keeps passages, ranks them for the point with the
     same BM25 and Malay <-> English pairs the References tab uses;
  3. asks the router (MIRELD / AFIQ) for ONE sentence that states the point, with the passage number
     and the exact quote;
  4. writes the sentence back as the NOTE, with its source cited (host, page title, page, link). It does
     NOT touch any answer: the admin presses Add to FAQ (rule 56), so nothing reaches the public
     page without a click. A point with no official source is left as it was and tried again in 3 days.

A blog, a news site or a Facebook post is a lead, never a source: it can only lead to an official page,
and the quote must be found word for word in that official page itself.

  python find_sources.py [--limit 12] [--minutes 8]
"""
import argparse
import base64
import datetime as dt
import html
import io
import json
import os
import pathlib
import re
import sys
import time
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

import requests

import he_api
import llm_router
import resolve_sahkan as rs

STATE = pathlib.Path(os.environ.get("STATE_DIR", pathlib.Path(__file__).parent / ".state"))
CACHE = STATE / "web_cache.json"
TRIED = STATE / "find_sources.json"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
# Official hosts only. Government sites end in .gov.my; WEB_ALLOW adds exact extra hosts (comma separated).
EXTRA_ALLOW = {h.strip().lower() for h in os.environ.get("WEB_ALLOW", "").split(",") if h.strip()}
SEEDS = [
    "https://www.halal.gov.my/index.php?data=&utama=panduan&view=",
    "https://www.halal.gov.my/index.php?data=bW9kdWxlcy9jb2xsYXBzaWJsZV9jb250ZW50Ozs7Ow==&utama=panduan&view=",
    "https://www.halal.gov.my/index.php?data=bW9kdWxlcy9wZWtlbGlsaW5nOzs7Ow==",
    "https://www.halal.gov.my/index.php?data=bW9kdWxlcy9hbm5vdW5jZW1lbnQ7Ozs=",
    "https://www.halal.gov.my/index.php?data=bW9kdWxlcy9jb2xsYXBzaWJsZV9jb250ZW50Ozs7Ow==&utama=info",
    "https://lom.agc.gov.my/",
    "https://www.npra.gov.my/index.php/en/",
] + [u.strip() for u in os.environ.get("WEB_SEEDS", "").split(",") if u.strip()]
SEARCH_HOSTS = ["halal.gov.my", "moh.gov.my", "lom.agc.gov.my", "npra.gov.my", "gov.my"]
MAX_PDF = 12 * 1024 * 1024
MAX_PAGES_PER_PDF = 80
CACHE_DAYS = 7
RETRY_DAYS = 3
URL_RE = re.compile(r"https?://[^\s<>\"')\]]+", re.I)


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def official(url):
    try:
        h = (urlparse(url).hostname or "").lower()
    except ValueError:
        return False
    return bool(h) and (h.endswith(".gov.my") or h == "gov.my" or h in EXTRA_ALLOW)


def host_of(url):
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def jload(path, default):
    try:
        return json.loads(path.read_text("utf8"))
    except (OSError, ValueError):
        return default


def jsave(path, obj):
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, ensure_ascii=False), "utf8")
    except OSError as e:
        print("could not save", path.name, e, file=sys.stderr)


# ---- reading a page -------------------------------------------------------------------------
def html_text(raw):
    """(title, text, links) from HTML with the standard library only."""
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.S | re.I)
    links = re.findall(r"""href\s*=\s*["']([^"'#]+)["']""", raw, re.I)
    t = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n+", "\n", t).strip()
    return html.unescape(re.sub(r"\s+", " ", title.group(1)).strip()) if title else "", t, links


def pdf_pages(data):
    from pypdf import PdfReader
    r = PdfReader(io.BytesIO(data))
    out = []
    for i, p in enumerate(r.pages[:MAX_PAGES_PER_PDF], 1):
        try:
            tx = re.sub(r"\s+", " ", p.extract_text() or "").strip()
        except Exception:  # noqa: BLE001  a page that will not decode is skipped, not fatal
            tx = ""
        if tx:
            out.append((i, tx))
    return out


def fetch(url, cache):
    """{"url","title","pages":[[n,text]],"links":[...],"at"} or None. Cached CACHE_DAYS."""
    c = cache.get(url)
    if c and dt.datetime.fromisoformat(c["at"]) > now() - dt.timedelta(days=CACHE_DAYS):
        return c
    if not official(url):
        return None
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "ms-MY,ms;q=0.9,en;q=0.8"}, timeout=25, allow_redirects=True, stream=True)
        if r.status_code != 200 or not official(r.url):
            return None
        buf = bytearray()
        for chunk in r.iter_content(65536):          # one raw.read() can return a part of the file
            buf += chunk
            if len(buf) > MAX_PDF:
                return None
        data = bytes(buf)
        ctype = (r.headers.get("content-type") or "").lower()
        if "pdf" in ctype or url.lower().split("?")[0].endswith(".pdf") or data[:5] == b"%PDF-":
            pages = pdf_pages(data)
            rec = {"url": url, "title": pathlib.Path(urlparse(url).path).name, "pages": pages, "links": [], "at": now().isoformat()}
        else:
            enc = r.encoding or "utf-8"
            title, text, links = html_text(data.decode(enc, "replace"))
            links = [urljoin(r.url, l) for l in links]
            rec = {"url": url, "title": title or host_of(url), "pages": [[1, text]] if text else [], "links": links[:300], "at": now().isoformat()}
    except Exception as e:  # noqa: BLE001  one unreadable page or PDF never stops the run
        print("  fetch failed", url[:90], type(e).__name__)
        return None
    cache[url] = rec
    return rec


# ---- finding candidate pages ----------------------------------------------------------------
def bing_url(u):
    """Bing wraps every result: .../ck/a?...&u=a1<base64url of the real address>."""
    if "bing.com/ck/a" in u:
        v = (parse_qs(urlparse(html.unescape(u)).query).get("u") or [""])[0]
        if v.startswith("a1"):
            b = v[2:]
            try:
                return base64.urlsafe_b64decode(b + "=" * (-len(b) % 4)).decode("utf8")
            except (ValueError, UnicodeDecodeError):
                return ""
    return u


def brave(q):
    """Official-host results from the Brave Search API (BRAVE_API_KEY): a real API, so it does not depend on an
    engine tolerating automated page requests. [] when there is no key or the call fails."""
    key = os.environ.get("BRAVE_API_KEY", "").strip()
    if not key:
        return None
    try:
        r = requests.get("https://api.search.brave.com/res/v1/web/search", params={"q": f"{q} site:gov.my", "count": 15, "country": "MY"},
                         headers={"X-Subscription-Token": key, "Accept": "application/json"}, timeout=25)
        r.raise_for_status()
        return [x["url"] for x in (r.json().get("web") or {}).get("results", []) if official(x.get("url", ""))][:8]
    except (requests.RequestException, ValueError, KeyError) as e:
        print("  brave search failed:", type(e).__name__)
        return None


def search(q):
    """Official-host results of a web search for q. A result set with nothing official in it is treated as
    "search unusable" (Bing answered with unrelated pages to automated requests in the build session), never
    as evidence."""
    b = brave(q)
    if b is not None:
        return b, True
    found, usable = [], False
    for h in SEARCH_HOSTS[:4]:
        try:
            r = requests.get("https://www.bing.com/search", params={"q": f"site:{h} {q}", "setlang": "en", "cc": "MY"},
                             headers={"User-Agent": UA, "Accept-Language": "en-MY,en;q=0.8"}, timeout=25)
        except requests.RequestException:
            continue
        for m in re.finditer(r'<li class="b_algo".*?<h2[^>]*><a[^>]*href="([^"]+)"', r.text, re.S):
            u = bing_url(m.group(1))
            if official(u):
                usable = True
                if u not in found:
                    found.append(u)
        time.sleep(1.5)
    return found[:8], usable


def leads(max_rows=400):
    """Official links people posted in the groups (Facebook, WhatsApp, Telegram): leads, never sources."""
    out = []
    for st in ("new", "processed"):
        try:
            rows = he_api.raw_list(status=st, limit=max_rows // 2)
        except Exception as e:  # noqa: BLE001
            print("  leads: could not read Raw:", str(e)[:80]); continue
        for r in rows:
            for u in URL_RE.findall(str(r.get("text") or "")):
                u = u.rstrip(".,;:")
                if official(u) and u not in out:
                    out.append(u)
    return out[:60]


# ---- one point ------------------------------------------------------------------------------
SYSTEM = """You find the official statement behind one open point of a FAQ answer for halal executives in Malaysia, using ONLY the numbered passages (each from an official Malaysian government page or PDF).

The point is a fact the answer needs but did not state. If a passage states it: "text" = ONE declarative sentence that states the fact (not a question, not "the passage says"), in the SAME LANGUAGE as the point (English, or Bahasa Malaysia in the Malaysian register: boleh, ubat, syarikat, kualiti, pembungkusan; never Indonesian), regulatory terms kept original. "n" = the passage number. "quote" = the words of that passage that state the fact, copied word for word (max 25 words). Every number, date, fee, clause and name in "text" must appear in the quote or in the point.
If no passage states it: "text" = null. Never use outside knowledge, never guess, never infer from silence.

Return JSON only: {"text":"","n":1,"quote":""}"""


def is_bm(s):
    return len(re.findall(r"\b(yang|dan|atau|adalah|dengan|untuk|dalam|tidak|boleh|sama ada|oleh|pada|bagi|label|alamat|syarikat|halal)\b", s.lower())) >= 3 and \
        len(re.findall(r"\b(the|and|whether|is|are|of|for|with|that|which)\b", s.lower())) < 3


def passages(question, point, pages_by_url):
    docs, df, seen = [], {}, set()
    for url, rec in pages_by_url.items():
        for n, text in rec["pages"]:
            for i in range(0, len(text), 950):
                chunk = text[i:i + 1100]
                key = rs.norm(chunk)[:150]
                if len(chunk) < 80 or key in seen:   # the portal's menu text repeats on every page: count it once
                    continue
                seen.add(key)
                tk = rs.toks(chunk)
                tf = {}
                for w in tk:
                    tf[w] = tf.get(w, 0) + 1
                for w in tf:
                    df[w] = df.get(w, 0) + 1
                docs.append({"url": url, "title": rec["title"], "page": str(n), "text": chunk, "tf": tf, "len": len(tk), "host": host_of(url), "pdf": url.lower().split("?")[0].endswith(".pdf")})
    if not docs:
        return []
    avg = sum(d["len"] for d in docs) / len(docs)
    top = rs.rank(point + " " + question, docs, df, avg, k=6)
    return [{"n": i + 1, **d} for i, d in enumerate(top)]


def accept(point, out, ps):
    """(sentence with source, passage) or (None, why)."""
    text = out.get("text")
    if not isinstance(text, str) or not text.strip():
        return None, "no official passage states it"
    text = re.sub(r"\s+", " ", text).strip()
    by_n = {p["n"]: p for p in ps}
    p = by_n.get(int(out["n"])) if str(out.get("n") or "").isdigit() else None
    q = rs.norm(out.get("quote"))
    if not p:
        return None, f"cites passage {out.get('n')} that was not sent"
    if len(q) < 8 or q not in rs.norm(p["text"]):
        return None, "quote not found word for word in the passage"
    if not rs.related(point, out.get("quote")):
        return None, "the quote is not about the point"
    if len(text) > 320 or rs.has_marker(text) or text.endswith("?"):
        return None, "sentence too long, a question, or carries a marker"
    bm = is_bm(point)
    if bm and rs.INDO.search(text):
        return None, "Indonesian wording"
    extra = rs.numbers(text) - rs.numbers(out.get("quote")) - rs.numbers(point)
    if extra:
        return None, f"numbers not in the quote: {sorted(extra)}"
    where = (f"{'ms.' if bm else 'p.'} {p['page']}, " if p["pdf"] else "") + p["url"]
    label = "Sumber" if bm else "Source"
    return f"{text.rstrip('.')}. ({label}: {p['host']}, {p['title'][:70]}, {where})", p


def sourced(note):
    return bool(re.search(r"\((Source|Sumber): [a-z0-9.-]+\.gov\.my", note))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=12, help="points looked at per run")
    ap.add_argument("--minutes", type=float, default=8)
    a = ap.parse_args()
    t_end = time.time() + a.minutes * 60
    faq = he_api.read("FAQ")
    if faq and "verify_notes" not in faq[0]:
        print("FAQ tab has no verify_notes column yet; nothing to do."); return 0
    tried = jload(TRIED, {})
    cache = jload(CACHE, {})
    cutoff = (now() - dt.timedelta(days=RETRY_DAYS)).isoformat()
    todo = []   # (row, index of note, note)
    for r in faq:
        if r.get("status") == "hidden":
            continue
        try:
            notes = json.loads(r.get("verify_notes") or "[]")
        except ValueError:
            continue
        for i, n in enumerate(notes if isinstance(notes, list) else []):
            n = str(n)
            if n.strip() and not sourced(n) and tried.get(rs.norm(n)[:80], "") < cutoff:
                todo.append((r, i, n))
    print(f"{len(todo)} open points without an official source yet")
    if not todo:
        return 0
    todo = todo[: a.limit]

    # candidate pages: seeds (+ the PDFs they link to), group leads, then a search per point
    pages, blocked = {}, 0
    seed_pages = [fetch(u, cache) for u in SEEDS]
    for rec in filter(None, seed_pages):
        pages[rec["url"]] = rec
    link_budget = 14
    for rec in list(pages.values()):
        for l in rec["links"]:
            if link_budget and official(l) and l.lower().split("?")[0].endswith(".pdf") and l not in pages and time.time() < t_end:
                p = fetch(l, cache)
                link_budget -= 1
                if p:
                    pages[l] = p
    for u in leads():
        if time.time() > t_end:
            break
        p = fetch(u, cache)
        if p:
            pages[u] = p
    print(f"{len(pages)} official pages read from the seed list and the group leads")

    provider, model, done, found, errs = "", "", 0, 0, []
    by_row = {}
    for r, i, n in todo:
        if time.time() > t_end:
            print("time box reached; the rest wait for the next run"); break
        q = " ".join([str(r.get("question_en") or ""), str(r.get("question_bm") or "")])[:300]
        extra, usable = search(n[:200])
        if not usable:
            blocked += 1
        local = dict(pages)
        for u in extra:
            if u not in local:
                p = fetch(u, cache)
                if p:
                    local[u] = p
        ps = passages(q, n, local)
        res = None
        if ps:
            user = ("Passages:\n" + "\n\n".join(f"[{p['n']}] {p['title']} ({p['host']}), page {p['page']}\n{p['text']}" for p in ps)
                    + f"\n\nPoint: {n}\nFAQ question: {q}")
            try:
                r_ = llm_router.complete_json([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], max_tokens=700, temperature=0.1)
                provider, model = r_["provider"], r_["model"]
                out = r_["json"] if isinstance(r_["json"], dict) else {}
                res, why = accept(n, out, ps)
                if not res:
                    print(f"  [no] {r['id']}: {why}")
            except (llm_router.LLMError, KeyError, TypeError, ValueError) as e:
                errs.append(f"{r['id']}: {str(e)[:80]}")
                continue
        done += 1
        if res:
            by_row.setdefault(r["id"], (r, {}))[1][i] = res
            found += 1
            print(f"  [source] {r['id']}: {res[:160]}")
        else:
            tried[rs.norm(n)[:80]] = now().isoformat()
    for rid, (r, repl) in by_row.items():
        notes = json.loads(r.get("verify_notes") or "[]")
        for i, s in repl.items():
            notes[i] = s
        # Only the notes change: the answers, the status and approved_at stay as they are (rule 56).
        he_api.upsert("FAQ", [dict(r, verify_notes=json.dumps(notes, ensure_ascii=False), updated_at=r.get("updated_at"))])
    jsave(TRIED, tried)
    # keep the cache small: newest 60 pages
    if len(cache) > 60:
        cache = dict(sorted(cache.items(), key=lambda kv: kv[1]["at"], reverse=True)[:60])
    jsave(CACHE, cache)
    he_api.run_log("find_sources", provider, model, found, not errs, f"looked at {done} points, sourced {found}, {len(pages)} official pages, search unusable for {blocked}; " + "; ".join(errs)[:300])
    print(f"done: {done} points looked at, {found} sourced from official pages, search unusable for {blocked} of them, {len(errs)} errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
