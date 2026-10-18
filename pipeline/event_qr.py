"""Read the QR code on the poster of events that have no registration link.

Events made before the QR reader existed, and events whose poster was added
by hand, have a poster in Drive and an empty `link`. This decodes each
poster's QR code (qr_links.py) and writes the address into `link`. It never
replaces a link that is already there, never touches a finished event, and
never changes anything else on the row.

  python event_qr.py             fill the empty links
  python event_qr.py --dry-run   only print what it would write
"""
import argparse
import base64
import datetime as dt
import re
import sys

import he_api
import qr_links


def drive_id(url):
    m = re.search(r"(?:/d/|[?&]id=)([\w-]{20,})", str(url or ""))
    return m.group(1) if m else ""


def finished(e, today):
    for k in ("date_end", "date_start"):
        try:
            return dt.date.fromisoformat(str(e.get(k) or "")[:10]) < today
        except ValueError:
            continue
    return False


def main(dry):
    today = dt.date.today()
    rows = [e for e in he_api.read("Events") if e.get("status") != "hidden" and not str(e.get("link") or "").strip() and not finished(e, today)]
    fid_of = {e["id"]: drive_id(e.get("poster_file") or e.get("poster_url")) for e in rows}
    todo = [e for e in rows if fid_of[e["id"]]]
    print(f"{len(todo)} upcoming events with a poster and no link (of {len(rows)} without a link)")
    fixed = 0
    for e in todo:
        try:
            got = he_api.drive_get(fid_of[e["id"]], text=False, bytes_=True)
            urls = qr_links.links_from_bytes(base64.b64decode(got.get("b64") or ""), e.get("title", "")) if got.get("b64") else []
        except (he_api.ApiError, ValueError) as err:
            print(f"  {e['id']}: poster not read: {err}", file=sys.stderr)
            continue
        if not urls:
            print(f"  {e['id']} {str(e.get('title'))[:50]!r}: no QR code found")
            continue
        print(f"  {e['id']} {str(e.get('title'))[:50]!r}: {urls[0]}" + (f" (+{len(urls) - 1} more)" if len(urls) > 1 else ""))
        if not dry:
            # A whole-row upsert, so the row is re-read first: Admin may have
            # edited it since the list above was read.
            cur = next((x for x in he_api.read("Events") if x["id"] == e["id"]), None)
            if cur and not str(cur.get("link") or "").strip():
                he_api.upsert("Events", [dict(cur, link=urls[0])])
                fixed += 1
    print(f"filled {fixed} link(s)" if not dry else "dry run: nothing written")
    try:
        he_api.run_log("event_qr", "-", "opencv", fixed, True)
    except Exception:  # noqa: BLE001
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    main(ap.parse_args().dry_run)
