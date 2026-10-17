"""Join 읍면동 boundaries (Codex admin.json) with resident population and the first time a satellite hotspot fell inside each polygon."""
import json

admin = json.load(open("web/public/data/admin.json"))
pop = {r["code"]: r for r in json.load(open("web/public/data/population.json"))["rows"]}
fire = json.load(open("web/public/data/fire.json"))

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
              "age70share": round(pr["age70plus"] / pr["total"], 3) if pr and pr["total"] else None})
    xs = [c[0] for poly in rings(f["geometry"]) for c in poly[0]]; ys = [c[1] for poly in rings(f["geometry"]) for c in poly[0]]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    first, count = None, 0
    for lon, lat, t, frp, sat in fire["hotspots"]:
        if not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]): continue
        if any(inside((lon, lat), poly) for poly in rings(f["geometry"])):
            count += 1
            if first is None or t < first: first = t
    p["first_hit"] = first
    p["hotspots"] = count
json.dump(admin, open("web/public/data/emd.json", "w"), ensure_ascii=False, separators=(",", ":"))
hit = [f["properties"] for f in admin["features"] if f["properties"]["first_hit"] is not None]
print(len(admin["features"]), "emd;", unmatched, "without population;", len(hit), "touched by hotspots")
print("touched residents", sum(p["total"] or 0 for p in hit), "70+", sum(p["age70plus"] or 0 for p in hit))
for p in sorted(hit, key=lambda p: p["first_hit"])[:40]:
    print(f'{p["first_hit"]//1440+21}일 {p["first_hit"]%1440//60:02d}:{p["first_hit"]%60:02d} {p["sigungu"]} {p["emd"]} pop {p["total"]} 70+ {p["age70share"]} hotspots {p["hotspots"]}')
