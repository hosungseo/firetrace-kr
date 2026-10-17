"""Clean the full-text mention aggregate: drop records whose event time is the incident's ignition clock
re-attached to another 읍면동 (e.g. "22일 11:24 의성에서 난 불이 … 길안면까지 번졌다"), then recompute `first`.
Keeps the raw file untouched; writes the cleaned aggregate back to web/public/data/<id>/mentions.json."""
import json, sys
from datetime import datetime, timedelta, timezone

inc = sys.argv[1] if len(sys.argv) > 1 else "uiseong-2025"
KST = timezone(timedelta(hours=9))
reg = {i["id"]: i for i in json.load(open("web/public/data/incidents.json"))["incidents"]}[inc]
T0 = datetime.fromisoformat(reg["t0"])
raw = json.load(open("data/raw/mentions_auto.json"))
records = raw["records"] if isinstance(raw, dict) else raw
kfs = json.load(open(f"web/public/data/{inc}/kfs_fires.json"))["fires"]
ign = [(f["t"], f["emd"]) for f in kfs if f["gungu"] in [s.rstrip("시군구") for s in reg["sigungu"]]]
emd_name = {f["properties"]["code"]: f["properties"]["emd"] for f in json.load(open(f"web/public/data/{inc}/emd.json"))["features"]}

def is_ignition_echo(rec, code):
    if rec.get("t") is None: return False
    for t_ign, emd in ign:
        if abs(rec["t"] - t_ign) <= 3 and not emd_name.get(code, "").startswith(emd):
            return True
    return False

ACTIONS = ["spread", "evacuation", "alert", "control", "containment", "casualty"]
by = {}
dropped = 0
for r in records:
    for code in r.get("emd_codes") or []:
        if code not in emd_name: continue
        if is_ignition_echo(r, code):
            dropped += 1; continue
        b = by.setdefault(code, {"first": {a: None for a in ACTIONS}, "count": {a: 0 for a in ACTIONS}, "hourly": {}, "samples": []})
        for a in r.get("actions", []):
            if a not in ACTIONS: continue
            b["count"][a] += 1
            if r.get("t") is not None and (b["first"][a] is None or r["t"] < b["first"][a]): b["first"][a] = r["t"]
        if r.get("t") is not None:
            h = r["t"] // 60 * 60; b["hourly"][h] = b["hourly"].get(h, 0) + 1
        if len(b["samples"]) < 24:
            b["samples"].append({"t": r.get("t"), "sentence": r["sentence"], "url": r["url"], "outlet": r.get("outlet") or r["url"].split("/")[2], "actions": r.get("actions", [])})
out = {"by_emd": {c: {**b, "hourly": sorted(b["hourly"].items())} for c, b in by.items()}, "unmapped": sum(1 for r in records if not r.get("emd_codes")),
       "meta": {**(raw.get("meta", {}) if isinstance(raw, dict) else {}), "cleaning": f"ignition-clock echo filter: dropped {dropped} (sentence time within ±3 min of a 산림청 ignition time attached to a non-ignition 읍면동)", "records_after": sum(sum(b['count'].values()) for b in by.values())}}
json.dump(out, open(f"web/public/data/{inc}/mentions.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(by), "emd;", dropped, "ignition echoes dropped")
