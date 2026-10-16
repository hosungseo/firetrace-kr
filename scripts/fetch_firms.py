"""Fetch NASA FIRMS archive hotspots for the 2025 Gyeongbuk (Uiseong) wildfire window."""
import csv, io, os, json, time, urllib.request
from datetime import date, timedelta

KEY = open(os.path.expanduser("~/.openclaw/secrets/firms-map-key")).read().strip()
BBOX = "128.2,35.9,129.6,36.8"  # W,S,E,N
SOURCES = ["VIIRS_SNPP_SP", "VIIRS_NOAA20_SP", "MODIS_SP"]
START, DAYS = date(2025, 3, 21), 11  # 3/21 ~ 3/31

rows = []
for src in SOURCES:
    d = START
    while d < START + timedelta(days=DAYS):
        span = min(5, (START + timedelta(days=DAYS) - d).days)
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{src}/{BBOX}/{span}/{d.isoformat()}"
        text = urllib.request.urlopen(url, timeout=60).read().decode()
        got = list(csv.DictReader(io.StringIO(text)))
        for r in got:
            r["source"] = src
        rows += got
        print(src, d, span, len(got))
        d += timedelta(days=span)
        time.sleep(0.5)

json.dump(rows, open("data/raw/firms.json", "w"))
print("total", len(rows))
