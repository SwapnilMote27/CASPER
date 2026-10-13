"""
Download the current catalogue of ACTIVE PAYLOADS from Space-Track.org (one request)
and save it as all_active_spacetrack.txt. find_close_pairs.py reads that file.

Uses the same login variables as fetch_spacetrack.py:
  SPACETRACK_USER and SPACETRACK_PASS

This file is big (several MB). Download it rarely (once a day at most) and follow
Space-Track's current usage terms.
"""
import os
import sys
from pathlib import Path

import requests

LOGIN_URL = "https://www.space-track.org/ajaxauth/login"
QUERY_URL = (
    "https://www.space-track.org/basicspacedata/query/class/gp/"
    "OBJECT_TYPE/PAYLOAD/DECAY_DATE/null-val/EPOCH/%3Enow-10/"
    "orderby/NORAD_CAT_ID%20asc/format/3le"
)
OUTPUT = Path(__file__).with_name("all_active_spacetrack.txt")


def main():
    user = os.environ.get("SPACETRACK_USER")
    password = os.environ.get("SPACETRACK_PASS")
    if not user or not password:
        print("Set SPACETRACK_USER and SPACETRACK_PASS first.")
        sys.exit(1)

    with requests.Session() as session:
        login = session.post(
            LOGIN_URL, data={"identity": user, "password": password}, timeout=(10, 30)
        )
        login.raise_for_status()
        if "Failed" in login.text:
            print("Space-Track login failed. Check the user name and password.")
            sys.exit(1)

        print("Downloading... this can take a minute.")
        response = session.get(QUERY_URL, timeout=(10, 300))
        response.raise_for_status()

    text = response.text.strip()
    if not text or "1 " not in text:
        print("No TLE data returned:", text[:200])
        sys.exit(1)

    OUTPUT.write_text(text + "\n", encoding="utf-8")
    print(f"Saved {len(text.splitlines()) // 3} satellites to {OUTPUT.name}")


if __name__ == "__main__":
    main()