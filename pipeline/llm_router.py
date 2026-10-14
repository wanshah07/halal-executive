"""MIRELD and AFIQ, alternating, each covering the other.

Both are OpenAI-compatible chat gateways:
  MIRELD  https://api.mireld.my/v1   key MIRELD_API_KEY  model MIRELD_MODEL
  AFIQ    https://rootsys.cloud/v1   key AFIQ_API_KEY    model AFIQ_MODEL

Selection is automatic. The turn counter persists in pipeline/.state/turn
(or STATE_DIR) so consecutive runs alternate; inside one run every call
also alternates. Any failure on the chosen provider (timeout, HTTP error,
empty or non-JSON completion) sends the same request to the other one. Only
when both fail does the caller see an exception, and the run is logged as
failed so the queue is left intact for the next run.

Caller note (argus CLAUDE.md, 19 Sep 2026): api.mireld.my completed TLS and
then sent nothing to a GitHub Actions runner, while it answered 401 from a
Claude session and the Composio sandbox. So on a runner expect MIRELD to
time out and AFIQ to carry the run; the router handles that without config.
MIRELD_TIMEOUT keeps the wait short where that is known to happen.
"""
import json
import os
import pathlib
import re
import time

import requests

PROVIDERS = {
    "MIRELD": {"base": "https://api.mireld.my/v1", "key": "MIRELD_API_KEY", "model": "MIRELD_MODEL", "timeout": int(os.environ.get("MIRELD_TIMEOUT", "60"))},
    "AFIQ":   {"base": "https://rootsys.cloud/v1",  "key": "AFIQ_API_KEY",   "model": "AFIQ_MODEL",   "timeout": int(os.environ.get("AFIQ_TIMEOUT", "120"))},
}
ORDER = ["MIRELD", "AFIQ"]
STATE = pathlib.Path(os.environ.get("STATE_DIR", pathlib.Path(__file__).parent / ".state"))


class LLMError(RuntimeError):
    pass


def _turn():
    STATE.mkdir(parents=True, exist_ok=True)
    f = STATE / "turn"
    n = int(f.read_text() or "0") if f.exists() else 0
    f.write_text(str(n + 1))
    return n


def available():
    return [p for p in ORDER if os.environ.get(PROVIDERS[p]["key"])]


def _call(name, messages, json_mode=False, max_tokens=2000, temperature=0.2, model=None):
    p = PROVIDERS[name]
    key = os.environ.get(p["key"])
    model = model or os.environ.get(p["model"])
    if not key:
        raise LLMError(f"{name}: no key")
    if not model:
        raise LLMError(f"{name}: no model (set {p['model']})")
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    r = requests.post(f"{p['base']}/chat/completions", json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=p["timeout"])
    if r.status_code >= 300:
        raise LLMError(f"{name} HTTP {r.status_code}: {r.text[:200]}")
    j = r.json()
    text = (((j.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    if not text.strip():
        raise LLMError(f"{name}: empty completion")
    return {"text": text, "provider": name, "model": model}


def complete(messages, json_mode=False, **kw):
    """Alternate providers; fall back to the other on any error."""
    avail = available()
    if not avail:
        raise LLMError("no provider keys set (MIRELD_API_KEY / AFIQ_API_KEY)")
    first = avail[_turn() % len(avail)]
    order = [first] + [p for p in avail if p != first]
    errors = []
    for name in order:
        try:
            out = _call(name, messages, json_mode=json_mode, **kw)
            if errors:
                out["fallback_from"] = order[0]
                out["first_error"] = errors[0]
            return out
        except (LLMError, requests.RequestException, ValueError) as e:
            errors.append(f"{name}: {e}")
            time.sleep(1)
    raise LLMError("all providers failed: " + " | ".join(errors))


def complete_json(messages, **kw):
    """complete() plus tolerant JSON extraction (fenced or bare)."""
    out = complete(messages, json_mode=True, **kw)
    t = out["text"].strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1)
    try:
        out["json"] = json.loads(t)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s < 0 or e < 0:
            raise LLMError(f"{out['provider']}: non-JSON completion")
        out["json"] = json.loads(t[s:e + 1])
    return out


if __name__ == "__main__":
    for n in ORDER:
        key = os.environ.get(PROVIDERS[n]["key"])
        try:
            r = requests.get(PROVIDERS[n]["base"] + "/models", headers={"Authorization": f"Bearer {key}"} if key else {}, timeout=20)
            ids = [m["id"] for m in r.json().get("data", [])] if r.ok else []
            print(n, r.status_code, ids[:20] if ids else r.text[:120])
        except Exception as e:  # noqa: BLE001
            print(n, "unreachable:", e)
