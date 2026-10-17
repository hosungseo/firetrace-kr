"""Per-읍면동 record order: reported fire entry vs reported response vs first satellite detection.

Consumes the manually reviewed claims (data/raw/claims.json, produced in the astra round-2 consult)
and emd.json (first_hit / first_viirs / first_modis per 읍면동). Emits web/public/data/response.json.
Gaps are only computed between claims whose time precision is minute/hour; otherwise null with a reason.
"""
import json
from incident import cli, raw_dir, out_dir, t0
INC = cli(__doc__)
if not INC.get("reviewed"):
    raise SystemExit("Reviewed records required for this derivation")
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
T0 = t0(INC)
ENTRY = {"spread_entry"}
RESPONSE = {"evacuation_order", "alert_sms", "road_control", "shelter_opened"}
COMPARABLE = {"minute", "hour"}

def minutes(iso):
    return None if not iso else round((datetime.fromisoformat(iso) - T0).total_seconds() / 60)

claims = json.load(open(raw_dir(INC) / "claims.json"))
emd = {f["properties"]["code"]: f["properties"] for f in json.load(open(out_dir(INC) / "emd.json"))["features"]}

for c in claims:
    c["t"] = minutes(c.get("event_time"))
    c["t_pub"] = minutes(c.get("published_time"))

by_emd = {}
for c in claims:
    if c.get("scope") not in ("emd", "village"):
        continue
    for code in c.get("emd_codes") or []:
        by_emd.setdefault(code, []).append(c)

# Reviewed claim pairs (data/raw/claims_review.md §3). Pairs are chosen by hand, never by min(time):
# a 읍면동 can have earlier undated records, different 리, or responses of different kinds.
PAIRS = [
    {"code": "4776035000", "spread": "e39a", "response": "e43a", "role": "order_issued", "spatial": "emd"},
    {"code": "4776035000", "spread": "e39a", "response": "e45a", "role": "sms_sent", "spatial": "route_endpoint_to_emd"},
    {"code": "4777034000", "spread": "e39c", "response": "e45a", "role": "sms_sent", "spatial": "route_endpoint_to_emd"},
    {"code": "4717039000", "spread": "e25a", "response": "e25c", "role": "sms_sent", "spatial": "village_to_emd"},
    {"code": "4717039000", "spread": "e25b", "response": None, "role": None, "spatial": "village_to_emd"},
    {"code": "4717034000", "spread": None, "response": "e34", "role": "sms_sent", "spatial": "village_to_emd"},
    {"code": "4773032000", "spread": "e24a", "response": None, "role": None, "spatial": "village_to_emd"},
]
by_id = {c["claim_id"]: c for c in claims}

def pick(cid):
    return by_id.get(cid) if cid else None

def gap(a, b):
    """b - a in minutes, only when both exist and both are minute/hour precise."""
    if not a or not b:
        return None, "기록 없음"
    if a["time_precision"] not in COMPARABLE or b["time_precision"] not in COMPARABLE:
        return None, "시각 정밀도 부족"
    return b["t"] - a["t"], None

def slim(c):
    return c and {"claim_id": c["claim_id"], "action": c["action"], "t": c["t"], "precision": c["time_precision"], "approximate": bool(c.get("approximate")),
                  "place": c.get("place_text"), "quote": c.get("quote"), "url": c.get("source_url"), "source_kind": c.get("source_kind"), "published": c.get("published_time") or c.get("published_date")}

pairs = []
for pr in PAIRS:
    p = emd[pr["code"]]
    sp, rs = pick(pr["spread"]), pick(pr["response"])
    g_resp, why = gap(sp, rs)
    sat = p["first_hit"]
    sat_sp = (sat - sp["t"]) if (sp and sp["t"] is not None and sp["time_precision"] in COMPARABLE and sat is not None) else None
    sat_rs = (sat - rs["t"]) if (rs and rs["t"] is not None and rs["time_precision"] in COMPARABLE and sat is not None) else None
    pairs.append({"code": pr["code"], "sigungu": p["sigungu"], "emd": p["emd"], "total": p["total"], "age70share": p["age70share"],
                  "spread": slim(sp), "response": slim(rs), "role": pr["role"], "spatial": pr["spatial"],
                  "satellite": {"t": sat, "viirs": p.get("first_viirs"), "modis": p.get("first_modis")},
                  "gap_response_minus_spread": g_resp, "gap_reason": why,
                  "gap_satellite_minus_spread": sat_sp, "gap_satellite_minus_response": sat_rs,
                  "approximate": bool((sp and sp.get("approximate")) or (rs and rs.get("approximate")))})

rows = []
for code, cs in by_emd.items():
    p = emd.get(code)
    if not p:
        continue
    rows.append({"code": code, "sigungu": p["sigungu"], "emd": p["emd"], "total": p["total"], "age70share": p["age70share"],
                 "satellite": {"t": p["first_hit"], "viirs": p.get("first_viirs"), "modis": p.get("first_modis")},
                 "claims": [slim(c) for c in sorted(cs, key=lambda c: (c["t"] is None, c["t"] or 0))]})
rows.sort(key=lambda r: (r["satellite"]["t"] is None, r["satellite"]["t"] or 0))

# 읍면동 that the satellite touched but for which no press-level record exists
no_record = [{"code": k, "sigungu": v["sigungu"], "emd": v["emd"], "first_hit": v["first_hit"]} for k, v in emd.items() if v["first_hit"] is not None and k not in by_emd]

wide = [c for c in claims if c.get("scope") in ("city", "province", "national") and c["action"] in RESPONSE | ENTRY]
out = {"pairs": pairs, "rows": rows, "no_record": sorted(no_record, key=lambda r: r["first_hit"]), "wide_scope": [{"claim_id": c["claim_id"], "action": c["action"], "t": c["t"], "precision": c["time_precision"], "sigungu": c.get("sigungu"), "scope": c["scope"], "place": c.get("place_text"), "quote": c.get("quote"), "url": c.get("source_url")} for c in wide],
       "note": "진입·대응 시각은 보도·공식 발표에 적힌 시각이며 실제 발생·수신 시각이 아니다. 위성 시각은 '처음 관측된' 시각이지 도달 시각이 아니다. 시차는 분·시 단위 기록끼리만 계산한다."}
json.dump(out, open(out_dir(INC) / "response.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(pairs), "reviewed pairs;", len(rows), "읍면동 with claims;", len(no_record), "touched without record;", len(wide), "wide-scope claims")
for q in pairs:
    print(f'{q["sigungu"]} {q["emd"]}: spread {q["spread"] and q["spread"]["t"]} | response {q["response"] and q["response"]["t"]} ({q["role"]}) | sat {q["satellite"]["t"]} | R−S {q["gap_response_minus_spread"]} ({q["gap_reason"]}) H−S {q["gap_satellite_minus_spread"]} H−R {q["gap_satellite_minus_response"]}')
