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


def post(action, **payload):
    if not API or not TOKEN:
        raise ApiError("HE_API_URL and HE_INGEST_TOKEN must be set")
    body = json.dumps({"action": action, "token": TOKEN, **payload})
    last = None
    for attempt in range(4):
        try:
            r = requests.post(API, data=body.encode("utf-8"), headers={"Content-Type": "text/plain;charset=utf-8"}, timeout=120, allow_redirects=True)
            j = r.json()
            if not j.get("ok"):
                raise ApiError(j.get("error", f"HTTP {r.status_code}"))
            return j
        except (requests.RequestException, ValueError) as e:  # network or non-JSON (Apps Script HTML error page)
            last = e
            time.sleep(2 ** attempt)
    raise ApiError(f"{action}: {last}")


def get_data():
    r = requests.get(API, params={"action": "data", "t": int(time.time())}, timeout=120)
    r.raise_for_status()
    return r.json()


def raw_list(status="new", source=None, limit=50):
    return post("raw_list", status=status, source=source, limit=limit)["rows"]


def raw_update(ids, **patch):
    return post("raw_update", ids=ids, patch=patch)


def read(tab):
    return post("read", tab=tab)["rows"]


def upsert(tab, rows):
    return post("upsert", tab=tab, rows=rows)


def delete(tab, ids):
    return post("delete", tab=tab, ids=ids)


def run_log(job, provider, model, processed, ok, error=""):
    return post("run_log", job=job, provider=provider, model=model, processed=processed, ok=ok, error=error)


def drive_get(file_id, text=True, bytes_=False):
    return post("drive_get", id=file_id, text=text, bytes=bytes_)


def drive_file(file_id, name=None, path=None, description=None):
    return post("drive_file", id=file_id, name=name, path=path, description=description)
