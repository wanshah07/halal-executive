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


CERT = """Read this halal certificate (Sijil Pengesahan Halal Malaysia, or a foreign certification body's certificate) and return its particulars exactly as printed. Never invent anything: a field that is not printed is "" and a field you cannot read is "[SAHKAN]". If the text is not a halal certificate at all, return {"certificate": null}.
- issuer: the issuing body as printed, with its authority/signatory if printed (e.g. "The Central Islamic Council of Thailand (CICOT), under the authority of the Sheikhul Islam of Thailand")
- legal_authority: the law, act or section it is issued under, as printed
- cert_no: the certificate number; reg_no: any registration / file / reference number other than the certificate number
- issue_date, valid_from, valid_to: ISO dates (YYYY-MM-DD)
- company: the certified company's NAME only (no address)
- office_address and factory_address (or premise address) as printed; "" when not printed
- scheme: Food Product, Food Premise, Cosmetic, Pharmaceutical, Logistics, Slaughterhouse, OEM, other
- state: the Malaysian state of the holder if printed
- products: the approved products or product types, one string per item, as printed
- scope: one sentence stating what the certificate certifies, as printed (e.g. production processes comply with Islamic law; use of the halal logo)
Return JSON {"certificate": {"issuer":"","legal_authority":"","cert_no":"","reg_no":"","issue_date":"","valid_from":"","valid_to":"","company":"","office_address":"","factory_address":"","scheme":"","state":"","products":[""],"scope":""}}"""

CERT_TITLE = re.compile(r"sijil|certificate|perakuan", re.I)  # what a certificate document's own title says before the first dash
NOTICE_TITLE = re.compile(r"pengumuman|pekeliling|circular|notis|notice|announcement", re.I)
CERT_TEXT = re.compile(r"sijil\s+pengesahan\s+halal|halal\s+certificat|certificate\s+of\s+halal|perakuan\s+halal|pengesahan\s+halal\s+malaysia", re.I)


def read_cert(text):
    """A certificate's particulars from its text, asked on their own. The
    filing call (CLASSIFY) does many things and sometimes leaves `certificate`
    empty; this one does only this (14 Oct 2026: the Heinz certificate was
    filed with no Certificates row for exactly that reason)."""
    if not (text or "").strip():
        return None, "", ""
    out = llm_router.complete_json([{"role": "system", "content": CERT}, {"role": "user", "content": text[:8000]}], max_tokens=1200)
    j = out["json"] if isinstance(out["json"], dict) else {}
    c = j.get("certificate") if isinstance(j.get("certificate"), dict) else (j if j.get("company") else None)
    return c, out["provider"], out["model"]


def read_cert_image(file_id):
    """A picture-reading AI reads the certificate that OCR could not
    (Wan, 19 Oct 2026). Apps Script (vision_read) picks the reader: Wanshah 3 when
    its gateway lists a model that reads pictures, otherwise Wanshah 1 or 2 (they
    do). With no reader, or when the picture cannot be read, this is just
    (None, "", "") and the caller carries on as before. Returns
    (certificate | None, provider, model)."""
    if not vision_ready():
        return None, "", "NO KEY"
    try:
        r = he_api.post("vision_read", id=file_id, system=CERT, prompt="Read the halal certificate in this picture.", json=True)
    except he_api.ApiError as e:
        print("  vision read not available:", str(e)[:120])
        return None, "", ""
    if not (r.get("ok") and r.get("read")):
        return None, "", ("NO KEY" if r.get("code") == "NO KEY" else "")
    j = r.get("json") if isinstance(r.get("json"), dict) else {}
    c = j.get("certificate") if isinstance(j.get("certificate"), dict) else (j if j.get("company") else None)
    return (c if c and c.get("company") else None), r.get("provider", ""), r.get("model", "")


_VISION = {}


def vision_ready():
    """True when Wanshah 3 has a key in Apps Script: one cheap call per run
    (run() clears the answer), so nothing else asks while there is no key."""
    if "ready" not in _VISION:
        try:
            _VISION["ready"] = bool(he_api.post("vision_read", ping=True).get("ready"))
        except he_api.ApiError:
            _VISION["ready"] = False
    return _VISION["ready"]


def expired(v):
    """True when an ISO date (valid_to / expiry) is already past."""
    try:
        return dt.date.fromisoformat(str(v)[:10]) < dt.date.today()
    except ValueError:
        return False


def live_status(d, cert=None):
    """Admin uploads are published at once; a file from the WhatsApp group
    waits in Admin → Drafts until an admin publishes it (Wan, 15 Oct 2026).
    A halal certificate is the exception: it is published at once from the
    group too, or it never reaches Halal Certificates (Wan, 19 Oct 2026)."""
    if d.get("kind") == "certificate" or (cert and cert.get("company")):
        return "current"
    return "draft" if "from:group" in str(d.get("notes") or "") else "current"


def cert_row(cid, cert, d, url, modified, note, status="current"):
    prods = cert.get("products") or []
    return {"id": cid, "company": cert.get("company", ""), "cert_no": cert.get("cert_no", ""), "scheme": cert.get("scheme", ""), "category": d.get("category", "halal"),
            "state": cert.get("state", ""), "valid_from": cert.get("valid_from", ""), "valid_to": cert.get("valid_to", ""),
            "products": "; ".join(str(x) for x in prods) if isinstance(prods, list) else str(prods),
            "drive_url": url, "doc_id": d["id"], "status": status, "updated_at": modified, "notes": note,
            **{k: str(cert.get(k) or "")[:2000] for k in ("issuer", "legal_authority", "reg_no", "issue_date", "office_address", "factory_address", "scope")}}


def safe(s):
    return re.sub(r"[\\/:*?\"<>|]+", "-", s).strip()[:120]


def run():
    _VISION.clear()
    docs = he_api.read("Documents")
    inbox = [d for d in docs if d.get("status") == "inbox"]
    by_hash = {d["content_hash"]: d for d in docs if d.get("content_hash") and d.get("status") in ("current", "draft", "archived", "expired")}
    current = [d for d in docs if d.get("status") in ("current", "draft")]
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
            cert = j.get("certificate") if isinstance(j.get("certificate"), dict) else None
            if not (cert and cert.get("company") and cert.get("issuer")) and (d.get("kind") == "certificate" or CERT_TEXT.search(f["text"] or "") or (cert and cert.get("company"))):
                cert, p2, m2 = read_cert(f["text"])
                provider, model = p2 or provider, m2 or model
                if not (cert and cert.get("company")) and d.get("kind") == "certificate":
                    cert, p3, m3 = read_cert_image(d["drive_file_id"])  # OCR gave nothing usable: Wanshah 3 reads the picture
                    if cert:
                        provider, model = p3, m3
            # An expired certificate (or a document past its printed expiry) is
            # kept in Drive "90 Archive" for the record and never becomes a draft.
            if (cert and expired(cert.get("valid_to"))) or expired(j.get("expiry")):
                moved = he_api.drive_file(d["drive_file_id"], name=f"{date} EXPIRED {title}{ext}", path=f"90 Archive/{d.get('category', 'halal')}", description=f"{d['id']} · expired")
                he_api.upsert("Documents", [{**d, "title": title, "content_hash": h, "drive_url": moved["url"], "updated_at": moved["modified"], "status": "expired",
                                             "notes": f"expired {(cert or {}).get('valid_to') or j.get('expiry')}; {provider}:{model}"}])
                by_hash[h] = d
                print(d["id"], "expired, archived:", title); n += 1
                continue
            status = live_status(d, cert)
            old = next((c for c in cands if c["id"] == j.get("of_id")), None) if j.get("relation") == "version_of" and j.get("confidence") in ("high", "medium") else None
            version = int(old.get("version") or 1) + 1 if old else 1
            moved = he_api.drive_file(d["drive_file_id"], name=f"{date} v{version} {title}{ext}", path=f"10 Documents/{d.get('category', 'halal')}", description=f"{d['id']} · {j.get('reason', '')}")
            he_api.upsert("Documents", [{**d, "title": title, "content_hash": h, "version": version, "supersedes_id": old["id"] if old else "", "drive_url": moved["url"], "updated_at": moved["modified"], "status": status,
                                         "notes": ("from:group; " if status == "draft" else "") + (f"expiry {j['expiry']}; " if j.get("expiry") else "") + f"{provider}:{model} {j.get('confidence', '')}"}])
            if old:
                om = he_api.drive_file(old["drive_file_id"], path=f"90 Archive/{old.get('category', 'halal')}")
                he_api.upsert("Documents", [{**old, "status": "archived", "updated_at": om["modified"], "notes": f"superseded by {d['id']}"}])
                current = [c for c in current if c["id"] != old["id"]]
            d.update(content_hash=h, version=version, status=status, title=title); current.append(d); by_hash[h] = d
            if cert and cert.get("company"):
                cno = str(cert.get("cert_no") or "").strip().upper()
                # The same certificate number is one row, however many times it is posted.
                prev = next((c for c in certs if (old and c.get("doc_id") == old["id"]) or (cno and str(c.get("cert_no") or "").strip().upper() == cno)), None)
                cid = prev["id"] if prev else ids_cert()
                he_api.upsert("Certificates", [cert_row(cid, cert, d, moved["url"], moved["modified"], f"{provider}:{model} full-read {j.get('confidence', '')}",
                                                        status=prev.get("status") if prev and prev.get("status") == "current" else status)])
                if not prev:
                    certs.append({"id": cid, "cert_no": cert.get("cert_no", ""), "doc_id": d["id"], "status": status})
                print("  certificate", cid, cert.get("company"), cert.get("valid_to"), status)
            print(d["id"], "filed as", moved["name"], "(supersedes %s)" % old["id"] if old else "")
            n += 1
        except (he_api.ApiError, llm_router.LLMError, KeyError) as e:
            errs.append(f"{d['id']}: {e}"); print("skip", d["id"], e, file=sys.stderr)

    # Sweep: a current certificate document that still has no Certificates row
    # (filed before read_cert existed, or the reading failed last time).
    # Rows from before the full template are read again, once ("full-read"),
    # but only once the Sheet has the new columns (new Code.gs deployed).
    if certs and "issuer" not in certs[0]:
        print("Certificates tab has no issuer column yet: deploy the new Code.gs; details are read after that.")
        certs_ready = False
    else:
        certs_ready = True
    # Certificate drafts left from before the rule above are published now
    # (an expired one stays out).
    for c in he_api.read("Certificates"):
        if c.get("status") == "draft" and not expired(c.get("valid_to")):
            he_api.upsert("Certificates", [{**c, "status": "current"}]); print("certificate", c["id"], "published (was draft)"); n += 1
    lapsed = {str(c.get("doc_id")) for c in he_api.read("Certificates") if expired(c.get("valid_to"))}
    for d in he_api.read("Documents"):
        if d.get("status") == "draft" and d.get("kind") == "certificate" and str(d["id"]) not in lapsed:
            he_api.upsert("Documents", [{**d, "status": "current"}]); print(d["id"], "certificate document published (was draft)"); n += 1
    # A document the model called a certificate whose title says otherwise (a
    # JAKIM announcement, an info booklet) is filed under its real kind, and a
    # title-only certificate row made for it earlier is hidden (the file stays).
    certs = he_api.read("Certificates")
    for d in he_api.read("Documents"):
        if d.get("kind") != "certificate" or d.get("status") not in ("current", "draft"):
            continue
        head = str(d.get("title") or "").split("–")[0]
        rows = [c for c in certs if str(c.get("doc_id")) == str(d["id"])]
        if CERT_TITLE.search(head) or any("title-only" not in str(c.get("notes") or "") for c in rows):
            continue
        kind = "circular" if NOTICE_TITLE.search(head) else "other"
        he_api.upsert("Documents", [{**d, "kind": kind}])
        for c in rows:
            he_api.upsert("Certificates", [{**c, "status": "hidden"}])
        print(d["id"], "is not a certificate; filed as", kind); n += 1
    certs = he_api.read("Certificates")
    kios = vision_ready()  # title-only rows are tried again with Wanshah 3 once it has a key, once each
    have = {str(c.get("doc_id")) for c in certs if c.get("issuer") or "full-read" in str(c.get("notes") or "") or ("title-only" in str(c.get("notes") or "") and ("vision-tried" in str(c.get("notes") or "") or not kios))}
    for d in [x for x in he_api.read("Documents") if certs_ready and x.get("status") in ("current", "draft") and x.get("kind") == "certificate" and str(x["id"]) not in have]:
        try:
            f = he_api.drive_get(d["drive_file_id"], text=True)
            cert, p2, m2 = read_cert(f["text"])
            vision_failed = False
            if not (cert and cert.get("company")):
                cert, p2, m2 = read_cert_image(d["drive_file_id"])  # Wanshah 3 reads the picture itself
                vision_failed = not cert and m2 != "NO KEY"
                if not cert:
                    m2 = ""
            if not (cert and cert.get("company")):
                # Unreadable scan: list it by the holder named in its title, so it
                # shows on its card with the file; details can be re-read in Admin.
                parts = [x.strip() for x in str(d.get("title") or "").split("–")]
                holder = parts[1] if len(parts) > 1 and parts[1] and CERT_TITLE.search(parts[0]) else ""
                if not holder:
                    print(d["id"], "certificate text could not be read and the title names no holder; left for the admin"); continue
                prev = next((c for c in certs if str(c.get("doc_id")) == str(d["id"])), None)
                cid = prev["id"] if prev else ids_cert()
                he_api.upsert("Certificates", [cert_row(cid, {"company": holder}, d, d.get("drive_url", ""), f.get("modified", ""), "title-only: the file could not be read" + ("; vision-tried" if vision_failed else "") + "; re-read it in Admin",
                                                        status="current")])
                if not prev:
                    certs.append({"id": cid, "cert_no": "", "doc_id": d["id"], "notes": "title-only"})
                print("  certificate (title only)", cid, holder); n += 1; continue
            if expired(cert.get("valid_to")):
                he_api.upsert("Documents", [{**d, "status": "expired", "notes": f"expired {cert.get('valid_to')}"}])
                print(d["id"], "expired certificate; not listed"); continue
            provider, model = p2, m2
            cno = str(cert.get("cert_no") or "").strip().upper()
            prev = next((c for c in certs if str(c.get("doc_id")) == str(d["id"]) or (cno and str(c.get("cert_no") or "").strip().upper() == cno)), None)
            cid = prev["id"] if prev else ids_cert()
            he_api.upsert("Certificates", [cert_row(cid, cert, d, d.get("drive_url", ""), f.get("modified", ""), f"{provider}:{model} full-read",
                                                    status=(prev or {}).get("status") or d.get("status") or "current")])
            if not prev:
                certs.append({"id": cid, "cert_no": cert.get("cert_no", ""), "doc_id": d["id"]})
            print("  certificate (sweep)", cid, cert.get("company"), cert.get("valid_to")); n += 1
        except (he_api.ApiError, llm_router.LLMError, KeyError) as e:
            errs.append(f"{d['id']}: {e}"); print("skip", d["id"], e, file=sys.stderr)

    he_api.run_log("drive_organiser", provider, model, n, not errs, "; ".join(errs)[:500])
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(run())
