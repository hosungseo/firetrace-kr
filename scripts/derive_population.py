"""Compact 읍면동 resident population (2025-03) for the frontend."""
import json
rows = json.load(open("data/raw/population_emd.json"))
num = lambda v: None if v in ("", None) else int(v)
out = []
for r in rows:
    age = lambda sex, dec: num(r.get(f"{sex}{dec}AgeNmprCnt")) or 0
    a60 = sum(age(s, d) for s in ("male", "feml") for d in (60, 70, 80, 90, 100))
    a70 = sum(age(s, d) for s in ("male", "feml") for d in (70, 80, 90, 100))
    decades = [sum(age(s, d) for s in ("male", "feml")) for d in (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100)]
    out.append({"code": r["admmCd"], "sigungu": r["sggNm"], "emd": r["dongNm"], "total": num(r["totNmprCnt"]),
                "age60plus": a60, "age70plus": a70, "decades": decades, "male": num(r["maleNmprCnt"]), "female": num(r["femlNmprCnt"])})
json.dump({"period": "2025-03", "source": "행정안전부 주민등록 인구(읍면동, 거주자)", "rows": out}, open("web/public/data/population.json", "w"), ensure_ascii=False, separators=(",", ":"))
tot = sum(o["total"] for o in out); a70 = sum(o["age70plus"] for o in out)
print(len(out), "emd; total", tot, "70+", a70, f"({a70/tot:.0%})")
for sg in ("의성군", "안동시", "청송군", "영양군", "영덕군"):
    t = sum(o["total"] for o in out if o["sigungu"] == sg); s = sum(o["age70plus"] for o in out if o["sigungu"] == sg)
    print(sg, t, f"70+ {s/t:.0%}")
