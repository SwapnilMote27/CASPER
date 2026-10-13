"""
Makes /satellite and /analytics fast. Run once from the backend folder:
    python -m pip install orjson
    python patch_main_speed.py

What it does to main.py (backup saved as main.py.speed.bak, safe to run twice):
  1. renames the two heavy functions so they only BUILD the data
  2. adds a cache that serves the last result instantly and refreshes it in the
     background (stale-while-revalidate), with the JSON already serialised
  3. pre-computes both results when the server starts
The response format of /satellite and /analytics is unchanged.
"""
import ast
import shutil
from pathlib import Path

MAIN = Path(__file__).with_name("main.py")
BACKUP = Path(__file__).with_name("main.py.speed.bak")

raw = MAIN.read_bytes()
crlf = b"\r\n" in raw
text = raw.decode("utf-8").replace("\r\n", "\n")

if "swr_cache" in text:
    print("Already patched. Nothing to do.")
    raise SystemExit(0)

replacements = [
    ('@app.get("/satellite")\ndef get_satellite():', "def build_satellite():"),
    ('@app.get("/analytics")\ndef get_analytics():', "def build_analytics():"),
]
for old, new in replacements:
    if old not in text:
        print("Could not find:", old.splitlines()[0], "(edit by hand, see the instructions)")
        raise SystemExit(1)
    text = text.replace(old, new, 1)

text = text.rstrip("\n") + '''


# ============================================================
# SPEED: cached, pre-serialised responses
# ============================================================

import threading
import time

from fastapi import Response

try:
    import orjson

    def to_json_bytes(data):
        return orjson.dumps(data)  # fast; NaN becomes null (valid JSON)

except ImportError:  # works without orjson, just slower
    import json

    def to_json_bytes(data):
        return json.dumps(data).encode("utf-8")


def swr_cache(seconds, builder):
    """Serve the last result instantly; refresh in the background when it is old.
    The very first call computes and everyone else waits for it (no duplicate work)."""
    state = {"value": None, "time": 0.0}
    lock = threading.Lock()

    def get():
        if state["value"] is None:
            with lock:
                if state["value"] is None:
                    state["value"] = builder()
                    state["time"] = time.time()
            return state["value"]

        if time.time() - state["time"] > seconds and lock.acquire(blocking=False):

            def refresh():
                try:
                    state["value"] = builder()
                    state["time"] = time.time()
                except Exception as error:
                    print("Background refresh failed:", error)
                finally:
                    lock.release()

            threading.Thread(target=refresh, daemon=True).start()

        return state["value"]

    return get


satellite_json = swr_cache(300, lambda: to_json_bytes(build_satellite()))
analytics_json = swr_cache(120, lambda: to_json_bytes(build_analytics()))


@app.get("/satellite")
def get_satellite():
    return Response(content=satellite_json(), media_type="application/json")


@app.get("/analytics")
def get_analytics():
    return Response(content=analytics_json(), media_type="application/json")


@app.on_event("startup")
def warm_up_cache():
    """Compute both results once at start-up so the first page load is fast."""

    def warm():
        for getter in (satellite_json, analytics_json):
            try:
                getter()
            except Exception as error:
                print("Warm-up failed:", error)

    threading.Thread(target=warm, daemon=True).start()
'''

try:
    ast.parse(text)
except SyntaxError as error:
    print("Patched file would have a syntax error, nothing was changed:", error)
    raise SystemExit(1)

shutil.copy(MAIN, BACKUP)
MAIN.write_bytes((text.replace("\n", "\r\n") if crlf else text).encode("utf-8"))
print("Done. Restart the backend: uvicorn main:app --reload")
print("The first load after a restart still computes once; after that it is instant.")