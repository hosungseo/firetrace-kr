"""Derive compact frontend data: fire-complex hotspots, cumulative burned-area estimate, weather grid."""
import json, collections, math
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
T0 = datetime(2025, 3, 21, tzinfo=KST)
SAT = {"VIIRS_SNPP_SP": "S-NPP", "VIIRS_NOAA20_SP": "NOAA-20", "MODIS_SP": "MODIS"}

def minutes(r):
    t = datetime.strptime(r["acq_date"] + r["acq_time"].zfill(4), "%Y-%m-%d%H%M").replace(tzinfo=timezone.utc)
    return round((t - T0).total_seconds() / 60)

# 1) keep the largest connected component (the Uiseong complex); drops Pohang industrial heat etc.
rows = json.load(open("data/raw/firms.json"))
G = 0.02
cells = collections.defaultdict(list)
for r in rows:
    cells[(round(float(r["latitude"]) / G), round(float(r["longitude"]) / G))].append(r)
comp, best = {}, []
for c in cells:
    if c in comp:
        continue
    stack, members = [c], []
    comp[c] = True
    while stack:
        a = stack.pop(); members += cells[a]
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                b = (a[0] + di, a[1] + dj)
                if b in cells and b not in comp:
                    comp[b] = True; stack.append(b)
    if len(members) > len(best):
        best = members
fire = sorted(best, key=minutes)
hotspots = [[round(float(r["longitude"]), 4), round(float(r["latitude"]), 4), minutes(r),
             round(float(r["frp"]), 1), SAT[r["source"]]] for r in fire]

# 2) cumulative burned-area estimate from VIIRS pixels (375 m) rasterised on a ~375 m grid
DLAT = 0.375 / 111.0
DLON = 0.375 / (111.0 * math.cos(math.radians(36.4)))
CELL_KM2 = 0.375 * 0.375
# group overpasses into windows (passes < 3 h apart = one window) so rates aren't inter-satellite noise
by_t = collections.defaultdict(list)
for h in hotspots:
    if h[4] != "MODIS":
        by_t[h[2]].append(h)
windows = []
for t in sorted(by_t):
    if windows and t - windows[-1][-1] < 180:
        windows[-1].append(t)
    else:
        windows.append([t])
burned, series = set(), []
prev_t, prev_a = None, 0.0
for w in windows:
    pts = [h for t in w for h in by_t[t]]
    for h in pts:
        burned.add((round(h[1] / DLAT), round(h[0] / DLON)))
    area = len(burned) * CELL_KM2 * 100  # hectares
    t = w[-1]
    rate = None if prev_t is None else round((area - prev_a) / ((t - prev_t) / 60), 1)
    series.append({"t": t, "t_start": w[0], "area_ha": round(area), "rate_ha_h": rate, "n": len(pts),
                   "frp": round(sum(h[3] for h in pts))})
    prev_t, prev_a = t, area

# 3) weather grid -> compact arrays; plus a "fire-front" series (weather at the active-fire centroid)
wx = json.load(open("data/raw/weather_grid.json"))
times = wx[0]["hourly"]["time"]
hours = [round((datetime.fromisoformat(s).replace(tzinfo=KST) - T0).total_seconds() / 60) for s in times]
grid = [{"lat": p["lat"], "lon": p["lon"],
         "ws": p["hourly"]["wind_speed_10m"], "wd": p["hourly"]["wind_direction_10m"],
         "gust": p["hourly"]["wind_gusts_10m"], "rh": p["hourly"]["relative_humidity_2m"],
         "temp": p["hourly"]["temperature_2m"], "rain": p["hourly"]["precipitation"]} for p in wx]

first = hotspots[0]
front = []
for i, hm in enumerate(hours):
    recent = [h for h in hotspots if hm - 12 * 60 <= h[2] <= hm]
    if recent:
        lon = sum(h[0] for h in recent) / len(recent); lat = sum(h[1] for h in recent) / len(recent)
    else:
        lon, lat = first[0], first[1]
    g = min(grid, key=lambda p: (p["lat"] - lat) ** 2 + (p["lon"] - lon) ** 2)
    front.append({"t": hm, "ws": g["ws"][i], "gust": g["gust"][i], "wd": g["wd"][i], "rh": g["rh"][i],
                  "temp": g["temp"][i], "rain": g["rain"][i], "lat": g["lat"], "lon": g["lon"]})


# 4) KMA ASOS station observations (hourly + daily max instantaneous wind)
STN_POS = {"278": (128.6886, 36.3561), "136": (128.7073, 36.5729), "276": (129.0400, 36.4351),
           "277": (129.4093, 36.5333), "271": (128.9145, 36.9436), "138": (129.3800, 36.0326)}  # approx.
num = lambda v: None if v in ("", None) else float(v)
kma = json.load(open("data/raw/kma_asos.json"))
stations = []
for stn, name in kma["stations"].items():
    hrs = kma["hourly"][stn]
    gusts = []
    for d in kma["daily"][stn]:
        hm = d.get("maxInsWsHrmt", "")
        if d.get("maxInsWs") and len(hm) == 4:
            tm = datetime.fromisoformat(d["tm"]).replace(hour=int(hm[:2]), minute=int(hm[2:]), tzinfo=KST)
            gusts.append({"t": round((tm - T0).total_seconds() / 60), "v": float(d["maxInsWs"]),
                          "wd": num(d.get("maxInsWsWd")), "min_rh": num(d.get("minRhm"))})
    stations.append({"id": int(stn), "name": name, "lon": STN_POS[stn][0], "lat": STN_POS[stn][1],
                     "ws": [num(h["ws"]) for h in hrs], "wd": [num(h["wd"]) for h in hrs],
                     "rh": [num(h["hm"]) for h in hrs], "ta": [num(h["ta"]) for h in hrs],
                     "rn": [num(h["rn"]) for h in hrs], "daily_gust": gusts})

# 5) CAMS smoke (PM2.5 / AOD) on the same grid, plus the value at the fire front
cams = json.load(open("data/raw/cams_grid.json"))
smoke = [{"lat": p["lat"], "lon": p["lon"], "pm25": p["hourly"]["pm2_5"], "aod": p["hourly"]["aerosol_optical_depth"]} for p in cams]
for i, f in enumerate(front):
    g = min(smoke, key=lambda p: (p["lat"] - f["lat"]) ** 2 + (p["lon"] - f["lon"]) ** 2)
    f["pm25"] = g["pm25"][i] if i < len(g["pm25"]) else None

out = {"t0": T0.isoformat(), "hotspots": hotspots, "area": series,
       "weather": {"hours": hours, "grid": grid, "front": front},
       "stations": stations,
       "smoke": smoke,
       "meta": {"first_detection": {"lon": first[0], "lat": first[1], "t": first[2]},
                "hotspot_count": len(hotspots), "cell_km2": CELL_KM2}}
for p in ("data/derived/fire.json", "web/public/data/fire.json"):
    json.dump(out, open(p, "w"), separators=(",", ":"))
print(len(hotspots), "hotspots;", len(series), "passes; final est", series[-1]["area_ha"], "ha")
print("max gust", max(f["gust"] for f in front), "min rh", min(f["rh"] for f in front))
for s in series:
    print((T0 + timedelta(minutes=s["t"])).strftime("%m-%d %H:%M"), s["area_ha"], s["rate_ha_h"], s["n"])
