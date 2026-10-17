"""Official/press-reported figure series (진화율, 영향구역, 사망, 대피) from events.json `numbers` → web/public/data/official.json."""
import json
from incident import cli, raw_dir, out_dir, t0
INC = cli(__doc__)
if not INC.get("reviewed"):
    raise SystemExit("Reviewed records required for this derivation")
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9)); T0 = t0(INC)
ev = json.load(open(raw_dir(INC) / "events.json"))
mins = lambda iso: round((datetime.fromisoformat(iso) - T0).total_seconds() / 60)

def pick(keys):
    out = []
    for e in ev:
        n = e.get("numbers") or {}
        for k in keys:
            if k in n and isinstance(n[k], (int, float)):
                out.append({"t": mins(e["time"]), "v": n[k], "key": k, "id": e["id"], "precision": e.get("time_precision"), "official": bool(e.get("official")), "title": e["title"], "outlet": e["sources"][0]["outlet"] if e["sources"] else None})
                break
    return sorted(out, key=lambda r: r["t"])

series = {
    "containment_pct": pick(["containment_pct", "avg_containment_pct", "containment_pct_min"]),
    "impact_area_ha": pick(["impact_area_ha", "impact_area_ha_18h"]),
    "fireline_km": pick(["fireline_km"]),
    "deaths": pick(["deaths", "deaths_gyeongbuk"]),
    "evacuees": pick(["evacuees", "evacuees_uiseong", "evacuees_approx", "evacuees_kbmaeil", "evacuated_total"]),
}
# per-county containment snapshots (3/27 09:00, 3/28 07:00)
county = []
for e in ev:
    n = e.get("numbers") or {}
    if "uiseong_pct" in n:
        county.append({"t": mins(e["time"]), "id": e["id"], "pct": {k.replace("_pct", ""): v for k, v in n.items() if k.endswith("_pct") and k not in ("containment_pct", "avg_containment_pct")}})
out = {"series": series, "county_containment": county,
       "note": "보도·공식 발표에 적힌 수치를 시각순으로 나열. 집계 기준(경북/전국, 산림/영향구역)이 섞여 있어 같은 선에 그리면 안 되는 값은 key로 구분."}
json.dump(out, open(out_dir(INC) / "official.json", "w"), ensure_ascii=False, separators=(",", ":"))
for k, v in series.items():
    print(k, len(v), [(r["t"], r["v"]) for r in v][:12])
