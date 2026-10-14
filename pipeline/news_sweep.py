"""Halal news: fetch, classify, keep 72 hours, then drop.

Sources are RSS/Atom feeds and Google News queries (NEWS_FEEDS env overrides
the list, comma-separated). Each new headline is classified by the router
(MIRELD / AFIQ) for relevance and category with a one-line EN + BM summary,
written to the News tab with expires_at = fetched_at + 72 h. Every run also
deletes rows past expiry, and Code.gs purgeExpiredNews() does the same hourly
so a missed run never leaves stale news on the page.

  python news_sweep.py            (every 6 h)
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time

import feedparser

import he_api
import llm_router
from prompts import NEWS_SYSTEM

TTL_H = int(os.environ.get("NEWS_TTL_HOURS", "72"))
# Google News sorts a search by relevance, so without "when:3d" a halal
# search returns 100 old stories and nothing from the last 72 hours
# (measured 14 Oct 2026). Each query below returned fresh items that day.
def _gn(q, lang):
    hl, ceid = ("en-MY", "MY:en") if lang == "en" else ("ms-MY", "MY:ms")
    return f"https://news.google.com/rss/search?q={q}+when:3d&hl={hl}&gl=MY&ceid={ceid}"


DEFAULT_FEEDS = [
    _gn("halal+Malaysia", "en"), _gn("halal+Malaysia", "ms"),
    _gn("halal+JAKIM", "en"), _gn("halal+JAKIM", "ms"),
    _gn("sijil+halal", "ms"), _gn("logo+halal", "en"), _gn("logo+halal", "ms"),
    _gn("halal+industri", "ms"), _gn("produk+halal+Malaysia", "ms"),
    _gn("HDC+halal+OR+MIHAS", "en"), _gn("halal+certification+Malaysia", "en"),
    _gn("NPRA+kosmetik", "ms"), _gn("KKM+keselamatan+makanan+Malaysia", "ms"),
    _gn("halal+cosmetics+Malaysia", "en"),
]


def iso(t):
    return dt.datetime.fromtimestamp(time.mktime(t), dt.timezone.utc).replace(microsecond=0).isoformat() if t else ""


def run():
    feeds = [f for f in os.environ.get("NEWS_FEEDS", "").split(",") if f.strip()] or DEFAULT_FEEDS
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    existing = he_api.read("News")
    expired = [r["id"] for r in existing if r.get("expires_at") and dt.datetime.fromisoformat(str(r["expires_at"]).replace("Z", "+00:00")) < now]
    if expired:
        he_api.delete("News", expired); print("expired", len(expired))
    have = {r["id"] for r in existing}
    fresh, seen_titles = [], {re.sub(r"\s+-\s+[^-]+$", "", r.get("title", "")).strip().lower() for r in existing}
    for url in feeds:
        try:
            for e in feedparser.parse(url).entries[:40]:
                nid = "NEWS-" + hashlib.sha1(e.link.encode()).hexdigest()[:10]
                pub = iso(getattr(e, "published_parsed", None))
                if nid in have or (pub and dt.datetime.fromisoformat(pub) < now - dt.timedelta(hours=TTL_H)):
                    continue
                tkey = re.sub(r"\s+-\s+[^-]+$", "", e.title).strip().lower()
                if tkey in seen_titles:
                    continue
                seen_titles.add(tkey)
                have.add(nid)
                fresh.append({"id": nid, "title": e.title, "url": e.link, "source": getattr(getattr(e, "source", None), "title", "") or url.split("/")[2], "published_at": pub or now.isoformat()})
        except Exception as ex:  # noqa: BLE001
            print("feed failed", url, ex, file=sys.stderr)
    if not fresh:
        he_api.run_log("news_sweep", "", "", 0, True); print("no new headlines"); return 0
    provider, model, rows, err = "", "", [], ""
    for i in range(0, len(fresh), 20):
        chunk = fresh[i:i + 20]
        try:
            out = llm_router.complete_json([{"role": "system", "content": NEWS_SYSTEM}, {"role": "user", "content": json.dumps([{"i": k, "title": c["title"], "source": c["source"]} for k, c in enumerate(chunk)], ensure_ascii=False)}], max_tokens=3000)
        except llm_router.LLMError as e:
            err = str(e); print("LLM failed:", err, file=sys.stderr); break
        provider, model = out["provider"], out["model"]
        for it in out["json"].get("items", []):
            if it.get("relevant") and 0 <= int(it.get("i", -1)) < len(chunk):
                c = chunk[int(it["i"])]
                rows.append({**c, "fetched_at": now.isoformat(), "expires_at": (now + dt.timedelta(hours=TTL_H)).isoformat(), "summary_en": it.get("summary_en", ""), "summary_bm": it.get("summary_bm", ""), "category": it.get("category", "halal")})
    if rows:
        he_api.upsert("News", rows)
    he_api.run_log("news_sweep", provider, model, len(rows), not err, err)
    print(f"added {len(rows)} of {len(fresh)} headlines via {provider}/{model}" + (f"; FAILED {err}" if err else ""))
    return 1 if err else 0


if __name__ == "__main__":
    sys.exit(run())
