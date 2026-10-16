"""Fetch hourly ERA5-based weather from Open-Meteo for a wind-field grid over the fire area."""
import json, urllib.request

LATS = [round(36.15 + 0.1 * i, 2) for i in range(7)]    # 36.15 ~ 36.75
LONS = [round(128.35 + 0.1 * j, 2) for j in range(12)]  # 128.35 ~ 129.45
pts = [(la, lo) for la in LATS for lo in LONS]
VARS = "wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,temperature_2m,precipitation"

out = []
for k in range(0, len(pts), 40):
    chunk = pts[k:k + 40]
    url = ("https://archive-api.open-meteo.com/v1/archive?"
           f"latitude={','.join(str(p[0]) for p in chunk)}&longitude={','.join(str(p[1]) for p in chunk)}"
           f"&start_date=2025-03-21&end_date=2025-03-31&hourly={VARS}&wind_speed_unit=ms&timezone=Asia%2FSeoul")
    res = json.load(urllib.request.urlopen(url, timeout=120))
    res = res if isinstance(res, list) else [res]
    for (la, lo), r in zip(chunk, res):
        out.append({"lat": la, "lon": lo, "hourly": r["hourly"]})
    print(k, len(res))
json.dump(out, open("data/raw/weather_grid.json", "w"))
