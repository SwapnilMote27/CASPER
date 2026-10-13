"""
CASPER extended satellite catalogue (new file; existing routes untouched).
 
GET /catalog?start=<ISO UTC>
Returns one curated satellite per major space-faring country, plus a few
important science/weather satellites, each with a propagated orbit in the
SAME shape as your /satellite arrays: {time_utc, position_km: {x, y, z}} (TEME).
 
Data source: CelesTrak TLEs, propagated with SGP4. Nothing is invented:
if a satellite cannot be fetched or its name does not match the expected
name, it is left out and reported in "warnings".
 
Install:  pip install sgp4 requests
Register: in main.py add
    from catalog import router as catalog_router
    app.include_router(catalog_router)
"""
import re
import time
from datetime import datetime, timedelta, timezone
 
import requests
from fastapi import APIRouter, Query
from sgp4.api import Satrec, jday
 
router = APIRouter()
 
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php"
CACHE_SECONDS = 6 * 3600  # CelesTrak asks clients not to poll often
POINTS = 240
 
# (country, NORAD id, expected name fragment, role)
# ISS, Tianhe and Wentian are already served by /satellite, so not repeated.
CATALOG = [
    ("USA", 20580, "HST", "Space telescope"),
    ("USA", 25994, "TERRA", "Earth observation"),
    ("USA", 27424, "AQUA", "Earth observation"),
    ("USA", 37849, "SUOMI NPP", "Weather and climate"),
    ("USA", 49260, "LANDSAT 9", "Land imaging"),
    ("USA", 41866, "GOES 16", "Weather (geostationary)"),
    ("International (NASA/ESA)", 46984, "SENTINEL-6", "Sea-level altimetry"),
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
    ("France", 38012, "PLEIADES 1A", "High-resolution imaging"),
    ("Germany", 31698, "TERRASAR-X", "Radar imaging"),
    ("Italy", 31598, "COSMO-SKYMED 1", "Radar imaging"),
    ("United Kingdom", 40026, "TECHDEMOSAT-1", "Technology demonstration"),
    ("Canada", 32382, "RADARSAT-2", "Radar imaging"),
    ("Brazil", 40336, "CBERS 4", "Earth observation"),
    ("South Korea", 39227, "KOMPSAT-5", "Radar imaging"),
    ("Argentina", 43641, "SAOCOM 1A", "Radar imaging"),
    ("Israel", 29079, "EROS B", "Imaging"),
    ("Turkey", 39030, "GOKTURK 2", "Imaging"),
    ("UAE", 43616, "KHALIFASAT", "Imaging"),
]
 
_tle_cache = {}  # norad -> (fetched_at, name, line1, line2)
 
 
def _norm(text):
    return re.sub(r"[^A-Z0-9]", "", text.upper())
 
 
def _fetch_tle(norad):
    """Single-satellite fallback (one quick attempt)."""
    cached = _tle_cache.get(norad)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1:]
    try:
        response = requests.get(
            CELESTRAK_URL,
            params={"CATNR": norad, "FORMAT": "TLE"},
            headers={"User-Agent": "CASPER-research-prototype"},
            timeout=(5, 8),
        )
        response.raise_for_status()
        lines = [ln.strip() for ln in response.text.strip().splitlines() if ln.strip()]
        if len(lines) < 3 or not lines[1].startswith("1 "):
            raise ValueError("no TLE returned")
        _tle_cache[norad] = (time.time(), lines[0], lines[1], lines[2])
        return lines[0], lines[1], lines[2]
    except Exception:
        if cached:  # stale copy is better than nothing
            return cached[1:]
        raise
 
 
_bulk = {"at": 0.0, "data": {}}
 
 
def _load_bulk():
    """One request for the whole 'active' list instead of ~29 separate ones."""
    if _bulk["data"] and time.time() - _bulk["at"] < CACHE_SECONDS:
        return _bulk["data"]
    try:
        response = requests.get(
            CELESTRAK_URL,
            params={"GROUP": "active", "FORMAT": "TLE"},
            headers={"User-Agent": "CASPER-research-prototype"},
            timeout=(10, 40),
        )
        response.raise_for_status()
        lines = [ln.rstrip() for ln in response.text.splitlines() if ln.strip()]
        data = {}
        for i in range(0, len(lines) - 2, 3):
            name, l1, l2 = lines[i].strip(), lines[i + 1], lines[i + 2]
            if l1.startswith("1 ") and l2.startswith("2 "):
                data[int(l1[2:7])] = (name, l1, l2)
        if data:
            _bulk["at"] = time.time()
            _bulk["data"] = data
    except Exception:
        pass  # keep any older copy; per-satellite fallback follows
    return _bulk["data"]
 
 
def _tle_epoch(line1):
    year = int(line1[18:20])
    year += 2000 if year < 57 else 1900
    day = float(line1[20:32])
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=day - 1)
 
 
def _parse_start(start):
    if start:
        try:
            return datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(
                timezone.utc
            )
        except ValueError:
            pass
    return datetime.now(timezone.utc)
 
 
@router.get("/catalog")
def catalog(start: str = Query(None, description="ISO UTC start time")):
    start_dt = _parse_start(start)
    satellites, warnings = [], []
 
    bulk = _load_bulk()
    budget_end = time.time() + 40  # never let the request run away
 
    fetched = []
    for _country, norad, _expected, _role in CATALOG:
        tle, fetch_error = bulk.get(norad), None
        if tle is None:
            if time.time() < budget_end:
                try:
                    tle = _fetch_tle(norad)
                except Exception as error:
                    fetch_error = str(error)[:120]
            else:
                fetch_error = "skipped: time budget used up"
        fetched.append((tle, fetch_error))
 
    for (country, norad, expected, role), (tle, fetch_error) in zip(CATALOG, fetched):
        if tle is None:
            warnings.append(f"{expected} ({norad}): not fetched ({fetch_error})")
            continue
        name, l1, l2 = tle
 
        if _norm(expected) not in _norm(name):
            warnings.append(
                f"NORAD {norad}: expected '{expected}' but CelesTrak says '{name}'. Skipped."
            )
            continue
 
        sat = Satrec.twoline2rv(l1, l2)
        period_min = 2 * 3.141592653589793 / sat.no_kozai
        window_min = min(max(period_min, 180.0), 1500.0)  # one full orbit, at least 3 h
        step_s = window_min * 60.0 / (POINTS - 1)
 
        orbit = []
        for i in range(POINTS):
            t = start_dt + timedelta(seconds=i * step_s)
            jd, fr = jday(
                t.year, t.month, t.day, t.hour, t.minute, t.second + t.microsecond / 1e6
            )
            err, r, _v = sat.sgp4(jd, fr)
            if err != 0:
                continue
            orbit.append(
                {
                    "time_utc": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "position_km": {"x": r[0], "y": r[1], "z": r[2]},
                }
            )
 
        if len(orbit) < 2:
            warnings.append(f"{name} ({norad}): propagation failed")
            continue
 
        satellites.append(
            {
                "name": name.strip(),
                "norad_id": norad,
                "country": country,
                "role": role,
                "period_min": round(period_min, 1),
                "tle_epoch_utc": _tle_epoch(l1).strftime("%Y-%m-%d %H:%M"),
                "orbit": orbit,
            }
        )
 
    return {
        "source": "CelesTrak TLE, propagated with SGP4",
        "start_utc": start_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "satellites": satellites,
        "warnings": warnings,
    }
 