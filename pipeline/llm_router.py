"""MIRELD and AFIQ: the faster one leads, each covering the other.

Both are OpenAI-compatible chat gateways:
  MIRELD  https://api.mireld.my/v1   key MIRELD_API_KEY  model MIRELD_MODEL
  AFIQ    https://rootsys.cloud/v1   key AFIQ_API_KEY    model AFIQ_MODEL

The model variables are optional: empty or "auto" picks from the gateway's
/models list, and a model the gateway withdraws is re-picked on the spot.

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
import random
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


# Speed-led routing (Wan, 14 Oct 2026): each call's time per provider goes
# into STATE/speed.json as a moving average (a failure counts as slow). Once
# both have 3 timed calls the faster one leads 4 calls in 5 and the other
# keeps 1 in 5, so the lead moves by itself when the other gets quicker.
# STATE is kept between runs by the workflow's cache step.
SPEED_SHARE = 0.8


def _speed():
    try:
        return json.loads((STATE / "speed.json").read_text())
    except (OSError, ValueError):
        return {}


def record_speed(name, secs, ok):
    try:
        STATE.mkdir(parents=True, exist_ok=True)
        allp = _speed()
        s = allp.get(name) or {"s": 0, "n": 0, "fails": 0}
        t = secs if ok else max(secs, (s.get("s") or 30) * 1.5, 60)
        s["s"] = round(s["s"] * 0.7 + t * 0.3, 2) if s.get("n") else round(t, 2)
        s["n"] = min(s.get("n", 0) + 1, 1000)
        s["fails"] = 0 if ok else s.get("fails", 0) + 1
        allp[name] = s
        (STATE / "speed.json").write_text(json.dumps(allp))
    except OSError:
        pass


def pick_first(avail):
    sp = _speed()
    timed = [p for p in avail if (sp.get(p) or {}).get("n", 0) >= 3]
    if len(avail) > 1 and len(timed) == len(avail):
        ranked = sorted(avail, key=lambda p: sp[p]["s"])
        return ranked[0] if random.random() < SPEED_SHARE else ranked[1]
    return avail[_turn() % len(avail)]


def available():
    return [p for p in ORDER if os.environ.get(PROVIDERS[p]["key"])]


# Chat models in preference order when MIRELD_MODEL / AFIQ_MODEL is empty or
# "auto". Same list as Code.gs. A comma list in the variable is tried in order.
PREFER = ["glm-5.3", "kimi-k3", "deepseek-v4-pro", "glm-5.2", "gpt-6-astra", "claude", "gpt-5", "gpt-4.1", "gpt-4o", "deepseek", "qwen", "llama"]
NOT_CHAT = re.compile(r"(embed|image|dall|tts|whisper|audio|moderation|rerank|vision-only)", re.I)
_picked = {}


def resolve_model(name, fresh=False):
    """Exact id, comma list, or auto from the gateway's own /models list."""
    if name in _picked and not fresh:
        return _picked[name]
    p = PROVIDERS[name]
    want = (os.environ.get(p["model"]) or "auto").strip()
    wants = [] if want.lower() == "auto" else [w.strip() for w in want.split(",") if w.strip()]
    if len(wants) == 1 and not fresh:
        _picked[name] = wants[0]
        return wants[0]
    r = requests.get(f"{p['base']}/models", headers={"Authorization": f"Bearer {os.environ.get(p['key'])}"}, timeout=p["timeout"])
    if r.status_code >= 300:
        raise LLMError(f"{name} /models HTTP {r.status_code}")
    ids = [m.get("id", "") for m in r.json().get("data", [])]
    chat = [i for i in ids if i and not NOT_CHAT.search(i)]
    pick = next((w for w in wants if w in ids), None)
    if not pick:
        pick = next((i for pre in PREFER for i in chat if i.lower().startswith(pre)), None)
    pick = pick or (chat[0] if chat else (ids[0] if ids else None))
    if not pick:
        raise LLMError(f"{name}: no models listed")
    _picked[name] = pick
    return pick


def _post(p, key, model, messages, json_mode, max_tokens, temperature):
    payload = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    return requests.post(f"{p['base']}/chat/completions", json=payload, headers={"Authorization": f"Bearer {key}"}, timeout=p["timeout"])


def _call(name, messages, json_mode=False, max_tokens=2000, temperature=0.2, model=None):
    p = PROVIDERS[name]
    key = os.environ.get(p["key"])
    if not key:
        raise LLMError(f"{name}: no key")
    fixed = model is not None
    model = model or resolve_model(name)
    r = _post(p, key, model, messages, json_mode, max_tokens, temperature)
    # Model withdrawn or renamed: re-read /models once and retry with the new pick.
    if r.status_code in (400, 404) and "model" in r.text.lower() and not fixed:
        again = resolve_model(name, fresh=True)
        if again != model:
            model = again
            r = _post(p, key, model, messages, json_mode, max_tokens, temperature)
    if r.status_code >= 300:
        raise LLMError(f"{name} HTTP {r.status_code}: {r.text[:200]}")
    j = r.json()
    text = (((j.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    if not text.strip():
        raise LLMError(f"{name}: empty completion")
    return {"text": text, "provider": name, "model": model}


def parse_json(text):
    """JSON out of a completion: strips <think> blocks and code fences, then
    falls back to the outermost {...}."""
    t = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        s, e = t.find("{"), t.rfind("}")
        if s < 0 or e <= s:
            raise LLMError("non-JSON completion: " + t[:160].replace("\n", " "))
        return json.loads(t[s:e + 1])


def complete(messages, json_mode=False, **kw):
    """Alternate providers; fall back to the other on any error, including a
    reply that cannot be read as JSON when JSON was asked for."""
    avail = available()
    if not avail:
        raise LLMError("no provider keys set (MIRELD_API_KEY / AFIQ_API_KEY)")
    first = pick_first(avail)
    order = [first] + [p for p in avail if p != first]
    errors = []
    for name in order:
        t0 = time.time()
        try:
            out = _call(name, messages, json_mode=json_mode, **kw)
            if json_mode:
                try:
                    out["json"] = parse_json(out["text"])
                except (LLMError, ValueError) as e:
                    # Some gateways ignore response_format: ask once more
                    # without it before handing the request on.
                    retry = _call(name, messages + [{"role": "user", "content": "Reply with the JSON object only, no other text."}], json_mode=False, **kw)
                    out = {**retry, "json": parse_json(retry["text"])}
            record_speed(name, time.time() - t0, True)
            if errors:
                out["fallback_from"] = order[0]
                out["first_error"] = errors[0]
            return out
        except (LLMError, requests.RequestException, ValueError) as e:
            record_speed(name, time.time() - t0, False)
            errors.append(f"{name}: {e}")
            print(f"[router] {name} failed: {str(e)[:200]}")
            time.sleep(1)
    raise LLMError("all providers failed: " + " | ".join(errors))


def complete_json(messages, **kw):
    """complete() with the reply parsed as JSON into out["json"]."""
    return complete(messages, json_mode=True, **kw)


if __name__ == "__main__":
    for n in ORDER:
        key = os.environ.get(PROVIDERS[n]["key"])
        try:
            r = requests.get(PROVIDERS[n]["base"] + "/models", headers={"Authorization": f"Bearer {key}"} if key else {}, timeout=20)
            ids = [m["id"] for m in r.json().get("data", [])] if r.ok else []
            print(n, r.status_code, ids[:20] if ids else r.text[:120])
            if key:
                print("  auto-picks:", resolve_model(n, fresh=True))
        except Exception as e:  # noqa: BLE001
            print(n, "unreachable:", e)
