"""Fetch pinned 2025-01 boundaries and derive the five-county ~50 m GeoJSON.

Uses only Python's standard library. Run from any directory. Cached reruns are offline.
"""
import collections
import json
import math

from public_data_http import ROOT, fetch_json, write_json

COMMIT = "7360288277dfd12d74e54b959c59bdd66f852e3a"
SOURCE = (f"https://raw.githubusercontent.com/vuski/admdongkor/{COMMIT}/"
          "ver20250101/HangJeongDong_ver20250101.geojson")
EXPECTED = {"의성군": "47730", "안동시": "47170", "청송군": "47750",
            "영양군": "47760", "영덕군": "47770"}
TERMS = "CC BY 4.0 (vuski/admdongkor processed data); upstream Statistics Korea SGIS: KOGL Type 1, attribution required."
ATTRIBUTION = ("본 데이터는 통계청 통계지리정보서비스(SGIS, https://sgis.kostat.go.kr)에서 "
               "공공누리 제1유형으로 개방한 행정동 경계를 가공한 것이며(가공: vuski/admdongkor, "
               "https://github.com/vuski/admdongkor), CC BY 4.0으로 배포됩니다.")
# Equirectangular local metric; distance variation across the study area is <1%.
SX = 111_195 * math.cos(math.radians(36.5))
SY = 111_195


def distance_sq(p, a, b):
    px, py = (p[0] - a[0]) * SX, (p[1] - a[1]) * SY
    bx, by = (b[0] - a[0]) * SX, (b[1] - a[1]) * SY
    length = bx * bx + by * by
    fraction = max(0, min(1, (px * bx + py * by) / length)) if length else 0
    return (px - fraction * bx) ** 2 + (py - fraction * by) ** 2


def douglas_peucker(points, tolerance=50):
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        if end - start <= 1:
            continue
        best = max(range(start + 1, end),
                   key=lambda i: distance_sq(points[i], points[start], points[end]))
        if distance_sq(points[best], points[start], points[end]) > tolerance ** 2:
            keep.add(best)
            stack.extend([(start, best), (best, end)])
    return [points[i] for i in sorted(keep)]


def simplify_ring(ring):
    if ring[0] != ring[-1] or len(ring) < 4:
        raise ValueError("Invalid source polygon ring")
    # Split a closed ring into two open arcs, avoiding identical DP endpoints.
    split = max(range(1, len(ring) - 1),
                key=lambda i: distance_sq(ring[i], ring[0], ring[0]))
    reduced = douglas_peucker(ring[:split + 1])[:-1] + douglas_peucker(ring[split:])
    if len({tuple(p) for p in reduced[:-1]}) < 3:
        reduced = ring
    return [[round(p[0], 6), round(p[1], 6)] for p in reduced]


def simplify(geometry):
    kind = geometry["type"]
    if kind == "Polygon":
        coords = [simplify_ring(r) for r in geometry["coordinates"]]
    elif kind == "MultiPolygon":
        coords = [[simplify_ring(r) for r in poly] for poly in geometry["coordinates"]]
    else:
        raise ValueError(f"Unexpected geometry: {kind}")
    return {"type": kind, "coordinates": coords}


def main():
    original, provenance = fetch_json(SOURCE, terms=TERMS)
    selected = []
    codes = collections.defaultdict(set)
    for feature in original["features"]:
        p = feature["properties"]
        if p["sidonm"] == "경상북도" and p["sggnm"] in EXPECTED:
            # Verify BOTH source code attributes against names, before filtering.
            assert p["adm_cd2"][:5] == p["sgg"] == EXPECTED[p["sggnm"]]
            codes[p["sggnm"]].add(p["sgg"])
            selected.append(feature)
    assert set(codes) == set(EXPECTED)
    next_url = "https://raw.githubusercontent.com/vuski/admdongkor/master/ver20250401/HangJeongDong_ver20250401.geojson"
    following, following_meta = fetch_json(next_url, terms=TERMS)
    next_selected = [f for f in following["features"]
                     if f["properties"]["sidonm"] == "경상북도" and f["properties"]["sggnm"] in EXPECTED]
    indexed = lambda fs: {f["properties"]["adm_cd2"]: (f["properties"]["adm_nm"], f["geometry"]) for f in fs}
    assert indexed(selected) == indexed(next_selected), "Adjacent snapshots differ in the study area"
    raw = {"type": "FeatureCollection", "features": selected}
    write_json(ROOT / "data/raw/admin_source.geojson", raw)
    out = {"type": "FeatureCollection", "attribution": ATTRIBUTION, "features": []}
    for f in selected:
        p = f["properties"]
        prefix = p["sidonm"] + " " + p["sggnm"] + " "
        assert p["adm_nm"].startswith(prefix)
        out["features"].append({"type": "Feature", "properties": {
            "sido": p["sidonm"], "sigungu": p["sggnm"],
            "emd": p["adm_nm"][len(prefix):], "code": p["adm_cd2"]},
            "geometry": simplify(f["geometry"])})
    target = ROOT / "web/public/data/admin.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    assert target.stat().st_size <= 1_500_000
    write_json(ROOT / "data/raw/admin_source.meta.json", {
        "source_url": SOURCE,
        "commit_url": f"https://github.com/vuski/admdongkor/commit/{COMMIT}",
        "licence_url": "https://github.com/vuski/admdongkor/blob/master/LICENSE-DATA",
        "fetched_at_utc": provenance["fetched_at_utc"], "licence_or_terms": TERMS,
        "attribution": ATTRIBUTION, "row_count": len(selected),
        "national_source_row_count": len(original["features"]),
        "verified_sigungu_codes": {k: sorted(v) for k, v in sorted(codes.items())},
        "count_per_sigungu": dict(sorted(collections.Counter(f["properties"]["sggnm"] for f in selected).items())),
        "source_version": "2025-01-01", "simplification_tolerance_metres": 50,
        "next_snapshot_crosscheck": {"source_url": next_url,
            "fetched_at_utc": following_meta["fetched_at_utc"], "row_count": len(next_selected),
            "name_code_match": True, "geometry_match": True},
        "derived_bytes": target.stat().st_size,
        "caveat": [
            "January 2025 snapshot. Repository's next 2025-04-01 changelog only lists a 2025-03-10 Jeonju merger, outside this study area. No listed study-area change during March.",
            "code is the source's 10-digit MOIS adm_cd2, not the 8-digit Statistics Korea adm_cd.",
            "Independent ring Douglas-Peucker in local metric, rounded to six decimals; shared-edge topology is not guaranteed. Display boundaries, not survey/legal boundaries.",
            "Licence is from the repository's current LICENSE-DATA and README retrieved on the fetch date; preserve SGIS and vuski attribution."]})
    print(f"admin: {len(selected)} features; {target.stat().st_size:,} bytes")
    print(json.dumps(dict(collections.Counter(f["properties"]["sggnm"] for f in selected)), ensure_ascii=False))


if __name__ == "__main__":
    main()
