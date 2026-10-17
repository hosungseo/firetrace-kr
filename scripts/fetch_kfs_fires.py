"""Fetch 산림청 산불발생통계 (per-fire records) for 2025-03-01 ~ 2025-04-30 from data.go.kr."""
import os, json, time, urllib.parse, urllib.request, datetime

KEY = urllib.parse.quote(open(os.path.expanduser("~/.openclaw/secrets/data-go-kr-firetrace-key")).read().strip(), safe="")
BASE = "https://apis.data.go.kr/1400000/forestStusService/getfirestatsservice"
rows = []
for page in range(1, 50):
    u = BASE + "?serviceKey=" + KEY + "&" + urllib.parse.urlencode({"numOfRows": 100, "pageNo": page, "searchStDt": "20250301", "searchEdDt": "20250430", "_type": "json"})
    body = json.load(urllib.request.urlopen(u, timeout=40))["response"]["body"]
    items = body["items"]["item"] if body.get("items") else []
    rows += items
    if len(rows) >= int(body["totalCount"]) or not items:
        break
    time.sleep(0.4)
json.dump(rows, open("data/raw/kfs_fires.json", "w"), ensure_ascii=False)
json.dump({"source": "산림청_산불발생통계(대국민포털) data.go.kr 3070842, getfirestatsservice", "fetched_utc": datetime.datetime.now(datetime.UTC).isoformat(), "period": "2025-03-01~2025-04-30", "rows": len(rows), "licence": "data.go.kr 표기 기준(활용신청 승인 2026-10-17)", "caveat": "발생 일시·시군구·읍면·동리·지번·원인·피해면적(ha). 좌표 없음(지번 주소뿐). 피해면적은 산림청 집계 기준"}, open("data/raw/kfs_fires.meta.json", "w"), ensure_ascii=False, indent=1)
print(len(rows), "fires")
gb = [r for r in rows if r["locsi"] == "경북" and r["locgungu"] in ("의성", "안동", "청송", "영양", "영덕")]
for r in sorted(gb, key=lambda r: (r["startmonth"], r["startday"], r["starttime"])):
    print(f'{r["startmonth"]}-{r["startday"]:02d} {r["starttime"]} ~ {r["endmonth"]}-{r["endday"]:02d} {r["endtime"]} {r["locgungu"]} {r["locmenu"]} {r["locdong"]} {r["locbunji"]} | {r["firecause"]} | {r["damagearea"]} ha')
