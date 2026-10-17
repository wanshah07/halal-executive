"""Client for the Apps Script endpoint (apps-script/Code.gs).

Everything the pipeline needs from Google (Sheet rows, Drive bytes, file
moves) goes through that one URL with INGEST_TOKEN, so no service account
and no Google client libraries are needed on the runner.

Env: HE_API_URL, HE_INGEST_TOKEN
"""
import json
import os
import time

import requests

API = os.environ.get("HE_API_URL", "").rstrip("/")
TOKEN = os.environ.get("HE_INGEST_TOKEN", "")


class ApiError(RuntimeError):
    pass


# Replies worth one more try: the script lock, Apps Script quotas and timeouts,
# and a 200 whose body is not one of Code.gs's own {ok: ...} replies (seen
# 15-17 Oct 2026 on `read FAQ` and `run_log`, intermittently, failing whole phases).
TRANSIENT = ("lock", "timed out", "timeout", "too many", "service invoked", "busy", "try again", "unexpected reply")


def _snippet(r):
    try:
        t = r.text
    except Exception:  # noqa: BLE001
        return ""
    return " ".join(t.split())[:160]


def post(action, **payload):
    if not API or not TOKEN:
        raise ApiError("HE_API_URL and HE_INGEST_TOKEN must be set")
    body = json.dumps({"action": action, "token": TOKEN, **payload})
    last = None
    for attempt in range(4):
        try:
            r = requests.post(API, data=body.encode("utf-8"), headers={"Content-Type": "text/plain;charset=utf-8"}, timeout=120, allow_redirects=True)
            j = r.json()
            if not isinstance(j, dict) or "ok" not in j:
                # Not a Code.gs reply at all: say what came back instead of a bare "HTTP 200".
                keys = ",".join(sorted(j)[:8]) if isinstance(j, dict) else type(j).__name__
                raise ApiError(f"{action}: unexpected reply (HTTP {r.status_code}, keys: {keys}): {_snippet(r)}")
            if not j.get("ok"):
                raise ApiError(f"{action}: {j.get('error') or 'ok:false with no error'}")
            return j
        except ApiError as e:
            if not any(w in str(e).lower() for w in TRANSIENT):
                raise  # a real refusal (unauthorised, tab not writable): retrying cannot help
            last = e
        except (requests.RequestException, ValueError) as e:  # network or non-JSON (Apps Script HTML error page)
            last = e
        time.sleep(2 ** attempt)
    raise last if isinstance(last, ApiError) else ApiError(f"{action}: {last}")


def get_data():
    r = requests.get(API, params={"action": "data", "t": int(time.time())}, timeout=120)
    r.raise_for_status()
    return r.json()


def raw_list(status="new", source=None, limit=50, attachments=None):
    """attachments: True = only rows with a file, False = only rows without, None = all."""
    return post("raw_list", status=status, source=source, limit=limit, attachments=attachments)["rows"]


def raw_update(ids, **patch):
    return post("raw_update", ids=ids, patch=patch)


def read(tab):
    return post("read", tab=tab)["rows"]


def upsert(tab, rows):
    return post("upsert", tab=tab, rows=rows)


def delete(tab, ids):
    return post("delete", tab=tab, ids=ids)


def progress(job, text, state="running", done=0, left=0):
    """What is running now, for Admin → Progress (Code.gs keeps the last 40 lines)."""
    return post("progress", job=job, text=text, state=state, done=done, left=left)


def run_log(job, provider, model, processed, ok, error=""):
    """One line in the Runs tab. Best effort: losing the log line must never
    turn a finished phase red (resolve_sahkan did its work and then failed on
    this call on 17 Oct 2026)."""
    try:
        return post("run_log", job=job, provider=provider, model=model, processed=processed, ok=ok, error=error)
    except ApiError as e:
        print(f"[warn] run_log not written: {e}")
        return None


def drive_get(file_id, text=True, bytes_=False):
    return post("drive_get", id=file_id, text=text, bytes=bytes_)


def drive_file(file_id, name=None, path=None, description=None):
    return post("drive_file", id=file_id, name=name, path=path, description=description)
