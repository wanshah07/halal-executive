"""Keep the Sheet's FHCB tab in step with the bundled JAKIM MyIHAB list
(src/data/fhcb.json: 101 bodies, 51 countries).

Admin → FHCB used to wait for someone to press Load; now every run adds the
rows the Sheet lacks (Wan, 25 Oct 2026: "for FHCB, in admin site also update").
Rows are only ADDED: one that exists keeps its Sheet values (a body Wan edited
stays as he edited it), and one Admin deleted (Settings seed_deleted) never comes
back. The 3-column table JAKIM publishes carries no row ids, so ids are the
seed's own (FHCB-001 ...), which is also what Admin's Load uses.
"""
import json
import pathlib
import sys

import he_api

SEED = pathlib.Path(__file__).resolve().parent.parent / "src" / "data" / "fhcb.json"


def main():
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    try:
        have = {str(r.get("id")) for r in he_api.read("FHCB")}
    except he_api.ApiError as e:
        print("FHCB tab not readable (older Code.gs?):", e, file=sys.stderr)
        return 0
    try:
        gone = set(json.loads((he_api.get_data().get("settings") or {}).get("seed_deleted") or "[]"))
    except (ValueError, Exception):  # settings unreadable: add nothing we cannot be sure about
        gone = None
    if gone is None:
        print("settings not readable; FHCB not touched")
        return 0
    add = [r for r in seed if str(r["id"]) not in have and f"FHCB:{r['id']}" not in gone]
    if not add:
        print(f"FHCB tab is complete: {len(have)} rows, nothing to add")
        return 0
    he_api.upsert("FHCB", add)
    print(f"FHCB: {len(add)} rows added from the JAKIM MyIHAB list ({', '.join(r['country'] for r in add)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
