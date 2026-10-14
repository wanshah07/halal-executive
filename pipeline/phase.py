"""Report a phase of a Pipeline run to Admin → Progress.

  python phase.py <job> <state> <text>     (state: running | done | failed)

Never fails the run: if Apps Script cannot be reached the line is printed only.
"""
import sys

import he_api

if __name__ == "__main__":
    job, state, text = sys.argv[1], sys.argv[2], " ".join(sys.argv[3:])
    print(f"[{job}] {state}: {text}", flush=True)
    try:
        he_api.progress(job, text, state=state)
    except Exception as e:
        print("progress not saved:", e, file=sys.stderr)
