"""
Extra satellites for CASPER. Works offline: no internet needed at run time.

Satellites are read from satellites.json (created by pick_satellites.py, or
written by hand). Each one is treated exactly like ISS, Tianhe, Wentian and
Leopard: it appears in /satellite (orbit + pairwise screening) and in /analytics.

satellites.json format:
[
  {"name": "TERRA", "norad_id": 25994, "country": "USA", "role": "Earth observation",
   "line1": "1 25994U ...", "line2": "2 25994 ..."}
]
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sgp4.api import Satrec, jday

DATA_FILE = Path(__file__).with_name("satellites.json")
# Real close-approach examples found by find_close_pairs.py (optional)
CLOSE_FILE = Path(__file__).with_name("satellites_close.json")

# Same window as the existing orbits: 90 min before now to 90 min after.
BACK_SECONDS = 5400
TOTAL_SECONDS = 10800
ORBIT_STEP_SECONDS = 20  # coarser than the 10 s used for the 4 built-in satellites


def _jd(t):
    return jday(
        t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond / 1e6
    )


def load_extra_satellites(existing_norad_ids):
    """Read satellites.json; skip duplicates and satellites SGP4 cannot propagate now."""
    raw = []
    for data_file in (DATA_FILE, CLOSE_FILE):
        if not data_file.exists():
            continue
        try:
            raw.extend(json.loads(data_file.read_text(encoding="utf-8")))
        except (OSError, ValueError) as error:
            print(f"{data_file.name} could not be read:", error)
    if not raw:
        return []

    seen = set(existing_norad_ids)
    names = set()
    now_jd, now_fr = _jd(datetime.now(timezone.utc))
    extras = []

    for item in raw:
        try:
            norad = int(item["norad_id"])
            name = str(item["name"]).strip().upper()
            sat = Satrec.twoline2rv(item["line1"], item["line2"])
        except (KeyError, ValueError, TypeError) as error:
            print("Skipping invalid entry in satellites.json:", error)
            continue

        if norad in seen or name in names:
            continue

        err, _r, _v = sat.sgp4(now_jd, now_fr)
        if err != 0:
            print(f"Skipping {name}: SGP4 error {err} (TLE too old or invalid)")
            continue

        seen.add(norad)
        names.add(name)
        extras.append(
            {
                "name": name,
                "norad_id": norad,
                "country": item.get("country", "Other"),
                "role": item.get("role", ""),
                "line1": item["line1"],
                "line2": item["line2"],
            }
        )
    return extras


def build_extra_orbits(extras, now):
    """Orbit arrays for Live Earth, same shape as the built-in satellites."""
    result = []
    steps = TOTAL_SECONDS // ORBIT_STEP_SECONDS + 1

    for extra in extras:
        sat = Satrec.twoline2rv(extra["line1"], extra["line2"])
        orbit = []

        for i in range(steps):
            t = now - timedelta(seconds=BACK_SECONDS) + timedelta(
                seconds=i * ORBIT_STEP_SECONDS
            )
            jd, fr = _jd(t)
            err, r, _v = sat.sgp4(jd, fr)
            if err == 0:
                orbit.append(
                    {
                        "time_utc": t.isoformat(),
                        "position_km": {
                            "x": round(r[0], 3),
                            "y": round(r[1], 3),
                            "z": round(r[2], 3),
                        },
                    }
                )

        result.append(
            {
                "name": extra["name"],
                "norad_id": extra["norad_id"],
                "country": extra["country"],
                "role": extra["role"],
                "period_min": round(2 * math.pi / sat.no_kozai, 1),
                "orbit": orbit,
            }
        )
    return result


def analytics_key(name):
    return name.strip().upper()


def build_analytics_series(extra, start_time, calculate_orbital_elements):
    """Orbital-element time series (same shape and 10 s step as /analytics)."""
    sat = Satrec.twoline2rv(extra["line1"], extra["line2"])
    series = []

    for i in range(1081):
        t = start_time + timedelta(seconds=i * 10)
        jd, fr = _jd(t)
        err, r, v = sat.sgp4(jd, fr)
        if err != 0:
            continue
        el = calculate_orbital_elements(
            {"x": r[0], "y": r[1], "z": r[2]},
            {"x": v[0], "y": v[1], "z": v[2]},
        )
        series.append(
            {
                "time_utc": t.isoformat(),
                "raan_deg": el["raan_deg"],
                "inclination_deg": el["inclination_deg"],
                "argument_of_perigee_deg": el["argument_of_perigee_deg"],
                "semi_major_axis_km": el["semi_major_axis_km"],
                "eccentricity": el["eccentricity"],
            }
        )
    return series