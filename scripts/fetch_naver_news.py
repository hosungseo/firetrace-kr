"""Collect Naver news articles about the 2025 Gyeongbuk wildfire published 3/22~3/31 (KST)."""
import json, os, re, time, html, urllib.parse, urllib.request
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone, timedelta

env = dict(l.strip().split("=", 1) for l in open(os.path.expanduser("~/.openclaw/secrets/naver-api.env")) if "=" in l)
HDR = {"X-Naver-Client-Id": env["NAVER_CLIENT_ID"], "X-Naver-Client-Secret": env["NAVER_CLIENT_SECRET"]}
KST = timezone(timedelta(hours=9))
LO, HI = datetime(2025, 3, 22, tzinfo=KST), datetime(2025, 4, 1, tzinfo=KST)
REGIONS = ["의성", "안동", "청송", "영양", "영덕"]
TERMS = ["산불", "산불 대피", "산불 진화율", "산불 강풍", "산불 사망", "산불 재난문자", "산불 확산", "산불 헬기"]
QUERIES = [f"{r} {t}" for r in REGIONS for t in TERMS] + [
    "경북 산불", "경북 산불 확산", "괴산리 산불", "고운사 산불", "하회마을 산불", "주왕산 산불", "산불 특별재난지역 의성", "의성 산불 성묘객"]

def search(q, start):
    url = "https://openapi.naver.com/v1/search/news.json?" + urllib.parse.urlencode({"query": q, "display": 100, "start": start, "sort": "sim"})
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=20))["items"]
        except Exception as e:
            print("retry", q, start, e); time.sleep(1 + i)
    return []

clean = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s))
arts = {}
for q in QUERIES:
    hit = 0
    for start in range(1, 1001, 100):
        items = search(q, start)
        for it in items:
            pub = parsedate_to_datetime(it["pubDate"]).astimezone(KST)
            if LO <= pub < HI:
                key = it["originallink"] or it["link"]
                if key not in arts:
                    arts[key] = {"title": clean(it["title"]), "desc": clean(it["description"]), "url": key,
                                 "naver": it["link"], "pub": pub.isoformat(), "queries": []}
                    hit += 1
                arts[key]["queries"].append(q)
        if len(items) < 100:
            break
        time.sleep(0.12)
    print(f"{q}: +{hit} (total {len(arts)})")
json.dump(sorted(arts.values(), key=lambda a: a["pub"]), open("data/raw/naver_news.json", "w"), ensure_ascii=False)
