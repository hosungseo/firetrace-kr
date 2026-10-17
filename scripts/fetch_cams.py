"""Fetch CAMS global air-quality reanalysis (PM2.5, AOD, CO) from Open-Meteo for the same 0.1° grid as the weather."""
import json, urllib.request, datetime

LATS = [round(36.15 + 0.1 * i, 2) for i in range(7)]
LONS = [round(128.35 + 0.1 * j, 2) for j in range(12)]
pts = [(la, lo) for la in LATS for lo in LONS]
VARS = "pm2_5,pm10,aerosol_optical_depth,carbon_monoxide"
out = []
for k in range(0, len(pts), 30):
    chunk = pts[k:k + 30]
    url = ("https://air-quality-api.open-meteo.com/v1/air-quality?"
           f"latitude={','.join(str(p[0]) for p in chunk)}&longitude={','.join(str(p[1]) for p in chunk)}"
           f"&start_date=2025-03-21&end_date=2025-03-31&hourly={VARS}&timezone=Asia%2FSeoul")
    res = json.load(urllib.request.urlopen(url, timeout=120))
    res = res if isinstance(res, list) else [res]
    for (la, lo), r in zip(chunk, res):
        out.append({"lat": la, "lon": lo, "hourly": r["hourly"]})
    print(k, len(res))
json.dump(out, open("data/raw/cams_grid.json", "w"))
json.dump({"source": "Open-Meteo Air Quality API (CAMS global atmospheric composition forecast, ECMWF), https://open-meteo.com/en/docs/air-quality-api", "fetched_utc": datetime.datetime.now(datetime.UTC).isoformat(), "period": "2025-03-21~31 hourly KST", "points": len(out), "licence": "CC BY 4.0 (Open-Meteo); CAMS data © ECMWF, Copernicus licence", "caveat": "CAMS global forecast/analysis product (~40 km, 3-hourly, interpolated by Open-Meteo to hourly and to a 0.1° request grid); PM2.5 includes all sources, not wildfire smoke only; model-based, not measured"}, open("data/raw/cams_grid.meta.json", "w"), indent=1)
mx = max((v, p["lat"], p["lon"], p["hourly"]["time"][i]) for p in out for i, v in enumerate(p["hourly"]["pm2_5"]) if v is not None)
print("max pm2.5", mx)
