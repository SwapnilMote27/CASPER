"""
Build satellites.json from a TLE file you saved in your browser. Needs NO internet.

STEP 1 (browser): save TLE text files in this folder. Either ONE big file named
  active_tles.txt  (CelesTrak "Active Satellites", TLE format), or SEVERAL small ones
  named  tles_<anything>.txt  (for example tles_weather.txt, tles_resource.txt,
  tles_science.txt, tles_stations.txt) from https://celestrak.org/NORAD/elements/
  Small group files are kinder to CelesTrak and less likely to be blocked.
STEP 2: run   python pick_satellites.py
STEP 3: restart the backend.

To add a satellite, add a row to SELECTION: (country, NORAD id, expected name, role).
Re-run this script (with a fresh active_tles.txt) every few days to refresh the orbits.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
SOURCES = [HERE / "active_tles.txt"] + sorted(HERE.glob("tles_*.txt"))
OUTPUT = HERE / "satellites.json"

# ISS, Tianhe, Wentian and Leopard are already in main.py.
# 'expected' may list alternatives separated by | (names differ between sources).
SELECTION = [
    ("USA", 20580, "HST", "Space telescope"),
    ("USA", 25994, "TERRA", "Earth observation"),
    ("USA", 27424, "AQUA", "Earth observation"),
    ("USA", 37849, "NPP|SUOMI", "Weather and climate"),
    ("USA", 49260, "LANDSAT 9", "Land imaging"),
    ("USA", 41866, "GOES 16", "Weather (geostationary)"),
    ("International (NASA/ESA)", 46984, "FREILICH|SENTINEL-6", "Sea-level altimetry"),
    ("Europe (ESA/EU)", 40697, "SENTINEL-2A", "Land monitoring"),
    ("Europe (ESA/EU)", 39634, "SENTINEL-1A", "Radar imaging"),
    ("Russia", 40069, "METEOR-M 2", "Weather"),
    ("Russia", 41105, "ELEKTRO-L 2", "Weather (geostationary)"),
    ("China", 43010, "FENGYUN 3D", "Weather"),
    ("China", 39150, "GAOFEN 1", "Earth observation"),
    ("Japan", 41836, "HIMAWARI 9", "Weather (geostationary)"),
    ("Japan", 39766, "ALOS 2", "Radar land observation"),
    ("India", 44804, "CARTOSAT-3", "Earth observation"),
    ("India", 40930, "ASTROSAT", "Space telescope"),
    ("India", 41752, "INSAT-3DR", "Weather (geostationary)"),
    ("France", 38012, "PLEIADES", "High-resolution imaging"),
    ("Germany", 31698, "TERRASAR-X", "Radar imaging"),
    ("Italy", 31598, "SKYMED", "Radar imaging"),
    ("United Kingdom", 40076, "TECHDEMOSAT|TDS", "Technology demonstration"),
    ("Canada", 32382, "RADARSAT-2", "Radar imaging"),
    ("Brazil", 40336, "CBERS 4", "Earth observation"),
    ("South Korea", 39227, "KOMPSAT-5", "Radar imaging"),
    ("Argentina", 43641, "SAOCOM 1A", "Radar imaging"),
    ("Israel", 29079, "EROS B", "Imaging"),
    ("Turkey", 39030, "GOKTURK 2", "Imaging"),
    ("UAE", 43676, "KHALIFASAT", "Imaging"),
]


def norm(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())


def main():
    files = [p for p in SOURCES if p.exists()]
    if not files:
        print("No TLE files found. Save active_tles.txt or tles_<name>.txt files here first.")
        return

    catalogue = {}
    for path in files:
        lines = [ln.rstrip() for ln in path.read_text(encoding="utf-8", errors="ignore").splitlines() if ln.strip()]
        before = len(catalogue)
        for i in range(0, len(lines) - 2, 3):
            name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
            name = re.sub(r"^0 ", "", name)  # Space-Track 3le files prefix names with '0 '
            if l1.startswith("1 ") and l2.startswith("2 "):
                catalogue[int(l1[2:7])] = (name, l1, l2)
        print(f"Read {path.name}: {len(catalogue) - before} new satellites")
    print(f"Total available: {len(catalogue)}")

    result = []
    for country, norad, expected, role in SELECTION:
        entry = catalogue.get(norad)
        if entry is None:
            print(f"  MISSING  {expected} ({norad}): not in your TLE files")
            continue
        name, l1, l2 = entry
        if not any(norm(option) in norm(name) for option in expected.split("|")):
            print(f"  MISMATCH {norad}: expected '{expected}', file says '{name}'. Skipped.")
            continue
        result.append(
            {"name": name, "norad_id": norad, "country": country, "role": role, "line1": l1, "line2": l2}
        )
        print(f"  ok       {name} ({norad}) {country}")

    OUTPUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"\nWrote {len(result)} satellites to {OUTPUT.name}. Restart the backend.")


if __name__ == "__main__":
    main()