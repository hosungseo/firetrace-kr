"""Quick press-mention stream per 읍면동 from Naver title+snippet (no full text). Marked as 자동 추출·미검토."""
import json, re, collections
from incident import cli, raw_dir, out_dir, t0, read
INC = cli(__doc__)
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9)); T0 = t0(INC)
admin = json.load(open(out_dir(INC) / "admin.json"))["features"]
name2code = {}
for f in admin:
    p = f["properties"]
    name2code.setdefault(p["emd"], []).append(p["code"])
ALIAS = {"괴산리": "안평면", "현하리": "길안면", "백자리": "길안면", "하회마을": "풍천면", "하회리": "풍천면", "철파리": "의성읍", "고운사": "단촌면", "점곡휴게소": "점곡면", "병산서원": "풍천면"}
if INC["id"] != "uiseong-2025": ALIAS = {}
ACTIONS = {"spread": ["비화", "번졌", "번져", "확산", "넘어", "도달", "옮겨붙", "덮쳤"], "evacuation": ["대피", "피신", "이송"], "alert": ["재난문자", "안전안내문자", "재난안전문자", "긴급재난문자", "문자를 발송", "문자 발송"], "control": ["통제", "차단", "폐쇄", "운행 중단", "통행금지"], "containment": ["진화율", "주불", "잔불", "완진", "진화 완료"], "casualty": ["사망", "숨진", "숨졌", "실종", "부상"]}
names = sorted(set(name2code) | set(ALIAS), key=len, reverse=True)
npat = re.compile("|".join(map(re.escape, names)))
arts = read(raw_dir(INC) / "naver_news.json", [])
by = collections.defaultdict(lambda: {"count": collections.Counter(), "first": {}, "hourly": collections.Counter(), "samples": []})
total = 0
for a in arts:
    text = a["title"] + " " + a["desc"]
    found = set(npat.findall(text))
    if not found: continue
    t = round((datetime.fromisoformat(a["pub"]) - T0).total_seconds() / 60)
    acts = [k for k, ws in ACTIONS.items() if any(w in text for w in ws)]
    emds = set(ALIAS.get(n, n) for n in found)
    for emd in emds:
        for code in name2code.get(emd, []):
            if len(name2code.get(emd, [])) > 1: continue  # ambiguous name across counties → skip
            b = by[code]; total += 1
            b["hourly"][t // 60 * 60] += 1
            for ac in acts:
                b["count"][ac] += 1
                if ac not in b["first"] or t < b["first"][ac]: b["first"][ac] = t
            if len(b["samples"]) < 12 and acts:
                b["samples"].append({"t": t, "title": a["title"], "desc": a["desc"][:200], "url": a["url"], "actions": acts})
out = {"by_emd": {c: {"count": dict(b["count"]), "first": b["first"], "hourly": sorted(b["hourly"].items()), "samples": sorted(b["samples"], key=lambda s: s["t"]), "articles": sum(b["hourly"].values())} for c, b in by.items()},
       "meta": {"source": "네이버 뉴스 검색 API 제목+요약(150자 내외) 정규식 매칭", "articles_scanned": len(arts), "records": total, "caveat": "발행 시각 기준(사건 시각 아님). 요약문에 지명과 행위어가 함께 있을 뿐 같은 문장이라는 보장 없음. 자동 추출·미검토"}}
json.dump(out, open(out_dir(INC) / "mentions_snippets.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out["by_emd"]), "emd with mentions;", total, "records")
