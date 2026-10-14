"""File attachments in Drive with time and version; archive what is superseded.

For every Documents row in status `inbox` (written by process_raw.py from a
classified attachment):

1. Read the file through Apps Script (`drive_get`): bytes hash + OCR text.
2. Same content hash as an existing row → duplicate; the row is marked
   `duplicate` and the Inbox file is deleted from the listing (left in Inbox).
3. Otherwise ask the router whether it is a new version of an existing
   current document (same certificate holder / same circular, newer date) or a
   new document. The model sees the OCR text of the candidate and the titles
   plus text snippets of current documents in the same category.
4. New version → version = old + 1, old row → `archived`, old file moved to
   `90 Archive/<category>`; new file renamed "YYYY-MM-DD vN Title.ext" and
   moved to `10 Documents/<category>`. New document → version 1, same naming.
5. A certificate also gets a Certificates row (holder, number, scheme, state,
   validity, product list) so the Halal Certificates segment can fold/unfold it.
6. `updated_at` is Drive's modifiedTime after the move, so the Sheet and the
   Drive "Last modified" column agree.

  python drive_organiser.py            (daily job, and after each process run)
"""
import datetime as dt
import json
import os
import re
import sys

import he_api
import llm_router

CLASSIFY = """You compare a newly received document with the current documents already on file for halal executives in Malaysia. Decide if the new one is a NEW VERSION of one of them (same subject: same certificate holder and scheme, or same circular / guideline / form, with a later date or revision) or a NEW DOCUMENT. Use the OCR text; do not guess from the file name alone. Also extract a clean title ("<Type> – <Holder or subject> – <scheme or ref>"), the document date (ISO, or empty) and an expiry date if printed.
If the document is a halal certificate (Sijil Pengesahan Halal Malaysia or a foreign body's certificate), also fill `certificate`: holder company name as printed, certificate number, scheme (Food Product, Food Premise, Cosmetic, Pharmaceutical, Logistics, Slaughterhouse, OEM, other), Malaysian state of the holder if printed, valid_from and valid_to (ISO), and the product or premise list as printed (one string per item). Leave `certificate` null for anything else. Never invent a number: an unreadable field is "[SAHKAN]".
Return JSON: {"relation":"version_of|new","of_id":"existing id or null","title":"","doc_date":"","expiry":"","confidence":"high|medium|low","reason":"","certificate":null|{"company":"","cert_no":"","scheme":"","state":"","valid_from":"","valid_to":"","products":[""]}}"""


def safe(s):
    return re.sub(r"[\\/:*?\"<>|]+", "-", s).strip()[:120]


def run():
    docs = he_api.read("Documents")
    inbox = [d for d in docs if d.get("status") == "inbox"]
    if not inbox:
        print("nothing in inbox"); he_api.run_log("drive_organiser", "", "", 0, True); return 0
    by_hash = {d["content_hash"]: d for d in docs if d.get("content_hash") and d.get("status") in ("current", "archived")}
    current = [d for d in docs if d.get("status") == "current"]
    certs = he_api.read("Certificates")
    _ci = [0]
    for c in certs:
        try:
            _ci[0] = max(_ci[0], int(str(c["id"]).split("-")[1]))
        except (IndexError, ValueError, KeyError):
            pass
    def ids_cert():
        _ci[0] += 1
        return f"CERT-{_ci[0]:04d}"
    provider, model, n, errs = "", "", 0, []

    for d in inbox:
        try:
            f = he_api.drive_get(d["drive_file_id"], text=True)
            h = f["sha256"]
            if h in by_hash and by_hash[h]["id"] != d["id"]:
                he_api.upsert("Documents", [{**d, "content_hash": h, "status": "duplicate", "notes": f"same bytes as {by_hash[h]['id']}", "updated_at": f["modified"]}])
                print(d["id"], "duplicate of", by_hash[h]["id"]); n += 1; continue
            cands = [c for c in current if c.get("category") == d.get("category")]
            cand_text = []
            for c in cands[:25]:
                try:
                    t = he_api.drive_get(c["drive_file_id"], text=True)["text"][:800]
                except he_api.ApiError:
                    t = ""
                cand_text.append({"id": c["id"], "title": c["title"], "version": c.get("version"), "text": t})
            out = llm_router.complete_json([{"role": "system", "content": CLASSIFY}, {"role": "user", "content": json.dumps({"new": {"name": f["name"], "text": f["text"][:6000]}, "current": cand_text}, ensure_ascii=False)}], max_tokens=800)
            provider, model, j = out["provider"], out["model"], out["json"]
            j = j if isinstance(j, dict) else {}  # a list or text reply is treated as "no answer"
            title = safe(j.get("title") or d["title"] or f["name"])
            date = (j.get("doc_date") or d.get("received_at") or "")[:10] or dt.date.today().isoformat()
            ext = os.path.splitext(f["name"])[1] or ""
            old = next((c for c in cands if c["id"] == j.get("of_id")), None) if j.get("relation") == "version_of" and j.get("confidence") in ("high", "medium") else None
            version = int(old.get("version") or 1) + 1 if old else 1
            moved = he_api.drive_file(d["drive_file_id"], name=f"{date} v{version} {title}{ext}", path=f"10 Documents/{d.get('category', 'halal')}", description=f"{d['id']} · {j.get('reason', '')}")
            he_api.upsert("Documents", [{**d, "title": title, "content_hash": h, "version": version, "supersedes_id": old["id"] if old else "", "drive_url": moved["url"], "updated_at": moved["modified"], "status": "current", "notes": (f"expiry {j['expiry']}; " if j.get("expiry") else "") + f"{provider}:{model} {j.get('confidence', '')}"}])
            if old:
                om = he_api.drive_file(old["drive_file_id"], path=f"90 Archive/{old.get('category', 'halal')}")
                he_api.upsert("Documents", [{**old, "status": "archived", "updated_at": om["modified"], "notes": f"superseded by {d['id']}"}])
                current = [c for c in current if c["id"] != old["id"]]
            d.update(content_hash=h, version=version, status="current", title=title); current.append(d); by_hash[h] = d
            cert = j.get("certificate")
            if cert and cert.get("company"):
                cno = str(cert.get("cert_no") or "").strip().upper()
                # The same certificate number is one row, however many times it is posted.
                prev = next((c for c in certs if (old and c.get("doc_id") == old["id"]) or (cno and str(c.get("cert_no") or "").strip().upper() == cno)), None)
                cid = prev["id"] if prev else ids_cert()
                he_api.upsert("Certificates", [{"id": cid, "company": cert.get("company", ""), "cert_no": cert.get("cert_no", ""), "scheme": cert.get("scheme", ""), "category": d.get("category", "halal"),
                                                 "state": cert.get("state", ""), "valid_from": cert.get("valid_from", ""), "valid_to": cert.get("valid_to", ""), "products": "; ".join(cert.get("products") or []),
                                                 "drive_url": moved["url"], "doc_id": d["id"], "status": "current", "updated_at": moved["modified"], "notes": f"{provider}:{model} {j.get('confidence', '')}"}])
                if not prev:
                    certs.append({"id": cid, "cert_no": cert.get("cert_no", ""), "doc_id": d["id"]})
                print("  certificate", cid, cert.get("company"), cert.get("valid_to"))
            print(d["id"], "filed as", moved["name"], "(supersedes %s)" % old["id"] if old else "")
            n += 1
        except (he_api.ApiError, llm_router.LLMError, KeyError) as e:
            errs.append(f"{d['id']}: {e}"); print("skip", d["id"], e, file=sys.stderr)

    he_api.run_log("drive_organiser", provider, model, n, not errs, "; ".join(errs)[:500])
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(run())
