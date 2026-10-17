"""Compact 산림청 per-fire records (2025-03/04) for the frontend; coordinates come from 읍면 centroids when admin.json exists."""
import json, os
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
T0 = datetime(2025, 3, 21, tzinfo=KST)
rows = json.load(open("data/raw/kfs_fires.json"))
g = lambda r, k: str(r.get(k, "")).strip()

def stamp(r, p):
    t = g(r, p + "time") or "00:00:00"
    return datetime(int(r[p + "year"]), int(r[p + "month"]), int(r[p + "day"]), int(t[:2]), int(t[3:5]), tzinfo=KST)

# optional 읍면 centroid lookup from Codex's admin.json (sigungu+emd -> [lon, lat])
cent = {}
if os.path.exists("web/public/data/admin.json"):
    for f in json.load(open("web/public/data/admin.json"))["features"]:
        p = f["properties"]
        coords = []
        def walk(c):
            if isinstance(c[0], (int, float)): coords.append(c)
            else:
                for x in c: walk(x)
        walk(f["geometry"]["coordinates"])
        cent[(p["sigungu"].rstrip("시군구"), p["emd"].rstrip("읍면동"))] = [round(sum(c[0] for c in coords) / len(coords), 4), round(sum(c[1] for c in coords) / len(coords), 4)]

out = []
for r in rows:
    s, e = stamp(r, "start"), stamp(r, "end")
    out.append({"si": r["locsi"], "gungu": r["locgungu"], "emd": g(r, "locmenu"), "ri": g(r, "locdong"), "jibun": g(r, "locbunji"),
                "start": s.isoformat(), "end": e.isoformat(), "t": round((s - T0).total_seconds() / 60), "t_end": round((e - T0).total_seconds() / 60),
                "cause": r["firecause"], "area_ha": float(r["damagearea"]),
                "lonlat": cent.get((r["locgungu"], g(r, "locmenu")))})
out.sort(key=lambda o: o["t"])
json.dump({"source": "산림청 산불발생통계(대국민포털) API, 2025-03-01~04-30 발생분", "count": len(out), "fires": out,
           "note": "좌표는 읍면 경계 중심(지번 미지오코딩). 피해면적은 산림청 집계(ha)."},
          open("web/public/data/kfs_fires.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "fires;", sum(1 for o in out if o["lonlat"]), "with centroid")
