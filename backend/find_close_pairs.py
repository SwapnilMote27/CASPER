"""
Find REAL satellite pairs that are close to each other, so the Conjunctions page has
genuine examples in the MONITOR (20-100 km) and HIGH RISK (<= 20 km) bands.

Needs:  pip install numpy scipy sgp4
Input:  all_active_spacetrack.txt   (from fetch_spacetrack_all.py)
Output: satellites_close.json       (read by the backend automatically)

It uses the same 3-hour, 5-minute grid as main.py, starting now, and prefers pairs that
STAY close for the whole window (formation flyers, constellation neighbours, docked
vehicles) because those will still be close the next time the page is screened.

Run:  python find_close_pairs.py
Then restart the backend.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from sgp4.api import Satrec, SatrecArray, jday

HERE = Path(__file__).parent
SOURCE = HERE / "all_active_spacetrack.txt"
OUTPUT = HERE / "satellites_close.json"

HOURS = 3
STEP_MINUTES = 5
SEARCH_KM = 100.0   # keep pairs that come within this distance
PER_BAND = 3        # how many pairs to pick for each band
MIN_KM = 0.3        # below this the two are almost certainly docked / duplicates
GROUP = "Close-approach examples"


def read_tles(path):
    lines = [ln.rstrip() for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines() if ln.strip()]
    items = []
    for i in range(0, len(lines) - 2, 3):
        name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
        if l1.startswith("1 ") and l2.startswith("2 "):
            name = name[2:] if name.startswith("0 ") else name
            items.append((name, l1, l2))
    return items


def pick(pairs, used, count):
    chosen = []
    for pair in pairs:
        i, j = int(pair["i"]), int(pair["j"])
        if i in used or j in used:
            continue
        used.update((i, j))
        chosen.append(pair)
        if len(chosen) == count:
            break
    return chosen


def main():
    if not SOURCE.exists():
        print("all_active_spacetrack.txt not found. Run fetch_spacetrack_all.py first.")
        return

    items = read_tles(SOURCE)
    sats, kept = [], []
    for name, l1, l2 in items:
        try:
            sats.append(Satrec.twoline2rv(l1, l2))
            kept.append((name, l1, l2))
        except Exception:
            continue
    print(f"Loaded {len(sats)} satellites")

    now = datetime.now(timezone.utc)
    times = [now + timedelta(minutes=STEP_MINUTES * k) for k in range(HOURS * 60 // STEP_MINUTES + 1)]
    jd, fr = zip(*[jday(t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond / 1e6) for t in times])
    errors, positions, _ = SatrecArray(sats).sgp4(np.array(jd), np.array(fr))

    # satellites SGP4 cannot propagate get a unique faraway position so they never pair up
    bad = (errors != 0) | np.isnan(positions).any(axis=2)
    far = (np.arange(len(sats))[:, None, None] + 1) * 1.0e6
    positions = np.where(bad[:, :, None], far + 1.0e9, positions)

    # 1) every pair that gets within SEARCH_KM at any time step
    found = []
    for t in range(positions.shape[1]):
        tree = cKDTree(positions[:, t, :])
        pairs = tree.query_pairs(SEARCH_KM, output_type="ndarray")
        if len(pairs):
            found.append(pairs)
    if not found:
        print("No pairs within", SEARCH_KM, "km in this window.")
        OUTPUT.write_text("[]", encoding="utf-8")
        return
    all_pairs = np.unique(np.concatenate(found), axis=0)
    print(f"{len(all_pairs)} pairs came within {SEARCH_KM:.0f} km at some time step")

    # 2) minimum and maximum separation of those pairs over the whole window
    records = []
    for start in range(0, len(all_pairs), 50000):
        block = all_pairs[start:start + 50000]
        dist = np.linalg.norm(positions[block[:, 0]] - positions[block[:, 1]], axis=2)
        for (i, j), d in zip(block, dist):
            records.append({"i": i, "j": j, "min": float(d.min()), "max": float(d.max())})

    records = [r for r in records if r["min"] >= MIN_KM]
    # persistent pairs first (small max), then the closest
    high = sorted([r for r in records if r["min"] <= 20.0], key=lambda r: (r["max"], r["min"]))
    monitor = sorted([r for r in records if 20.0 < r["min"] <= 100.0], key=lambda r: (r["max"], r["min"]))

    used = set()
    chosen_high = pick(high, used, PER_BAND)
    chosen_monitor = pick(monitor, used, PER_BAND)

    output = []
    print("\nSelected pairs (separation over the next 3 h):")
    for band, chosen in (("<= 20 km  (HIGH RISK band)", chosen_high), ("20-100 km (MONITOR band)", chosen_monitor)):
        print(f"\n{band}")
        if not chosen:
            print("  none found in this window")
        for r in chosen:
            a, b = kept[r["i"]], kept[r["j"]]
            print(f"  {a[0]}  <->  {b[0]}   min {r['min']:.1f} km, max {r['max']:.1f} km")
            for me, other in ((a, b), (b, a)):
                norad = int(me[1][2:7])
                output.append(
                    {
                        "name": me[0],
                        "norad_id": norad,
                        "country": GROUP,
                        "role": f"Flies close to {other[0]}",
                        "line1": me[1],
                        "line2": me[2],
                    }
                )

    OUTPUT.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"\nWrote {len(output)} satellites to {OUTPUT.name}. Restart the backend.")


if __name__ == "__main__":
    main()