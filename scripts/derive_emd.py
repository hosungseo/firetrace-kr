"""Join 읍면동 boundaries (Codex admin.json) with resident population and the first time a satellite hotspot fell inside each polygon."""
import json
from incident import cli, raw_dir, out_dir, t0
INC = cli(__doc__)
RAW = raw_dir(INC)
OUT = out_dir(INC)

admin = json.load(open(OUT / "admin.json"))          # simplified, for display
source = json.load(open(RAW / "admin_source.geojson"))      # unsimplified, for point-in-polygon
src_by_code = {}
for f in source["features"]:
    pr = f["properties"]
    code = str(pr.get("code") or pr.get("adm_cd2") or "")
    src_by_code[code] = f["geometry"]
pop = {r["code"]: r for r in json.load(open(OUT / "population.json"))["rows"]}
fire = json.load(open(OUT / "fire.json"))

def rings(geom):
    if geom["type"] == "Polygon": return [geom["coordinates"]]
    return geom["coordinates"]  # MultiPolygon

def inside(pt, poly):  # poly = [outer, holes...]; ray casting
    x, y = pt
    def in_ring(r):
        c = False
        for i in range(len(r)):
            x1, y1 = r[i]; x2, y2 = r[i - 1]
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
        return c
    return in_ring(poly[0]) and not any(in_ring(h) for h in poly[1:])

unmatched = 0
for f in admin["features"]:
    p = f["properties"]
    pr = pop.get(p["code"])
    if pr is None: unmatched += 1
    p.update({"total": pr["total"] if pr else None, "age70plus": pr["age70plus"] if pr else None,
              "age70share": round(pr["age70plus"] / pr["total"], 3) if pr and pr["total"] and pr["age70plus"] is not None else None})
    xs = [c[0] for poly in rings(f["geometry"]) for c in poly[0]]; ys = [c[1] for poly in rings(f["geometry"]) for c in poly[0]]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    geom = src_by_code.get(p["code"], f["geometry"])
    xs = [c[0] for poly in rings(geom) for c in poly[0]]; ys = [c[1] for poly in rings(geom) for c in poly[0]]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    first, first_v, first_m, count, daily = None, None, None, 0, {}
    for lon, lat, t, frp, sat, *_ in fire["hotspots"]:
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]): continue
        if any(inside((lon, lat), poly) for poly in rings(geom)):
            count += 1
            daily[t // 1440] = daily.get(t // 1440, 0) + 1
            if first is None or t < first: first = t
            if sat == "MODIS":
                if first_m is None or t < first_m: first_m = t
            elif first_v is None or t < first_v: first_v = t
    p["first_hit"] = first          # earliest detection by any sensor (observation time, not arrival time)
    p["first_viirs"] = first_v      # VIIRS 375 m
    p["first_modis"] = first_m      # MODIS ~1 km
    p["hotspots"] = count
    p["daily"] = [[d * 1440, n] for d, n in sorted(daily.items())]   # hotspot detections per KST day
    p["decades"] = pr["decades"] if pr else None                       # residents by age decade (0s..100s)
json.dump(admin, open(OUT / "emd.json", "w"), ensure_ascii=False, separators=(",", ":"))
hit = [f["properties"] for f in admin["features"] if f["properties"]["first_hit"] is not None]
print(len(admin["features"]), "emd;", unmatched, "without population;", len(hit), "touched by hotspots")
print("touched residents", sum(p["total"] or 0 for p in hit), "70+", sum(p["age70plus"] or 0 for p in hit))
