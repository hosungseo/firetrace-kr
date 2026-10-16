"""Compact Naver news for the frontend: hourly counts + article list tagged by region."""
import json, collections
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

KST = timezone(timedelta(hours=9))
T0 = datetime(2025, 3, 21, tzinfo=KST)
REGIONS = ["의성", "안동", "청송", "영양", "영덕"]
OUTLET = {"www.yna.co.kr": "연합뉴스", "www.news1.kr": "뉴스1", "www.newsis.com": "뉴시스", "www.ytn.co.kr": "YTN",
          "news.kbs.co.kr": "KBS", "www.yonhapnewstv.co.kr": "연합뉴스TV", "www.newspim.com": "뉴스핌", "news.sbs.co.kr": "SBS",
          "www.imaeil.com": "매일신문", "www.hankyung.com": "한국경제", "www.yeongnam.com": "영남일보", "www.edaily.co.kr": "이데일리",
          "imnews.imbc.com": "MBC", "news.jtbc.co.kr": "JTBC", "www.hani.co.kr": "한겨레", "www.khan.co.kr": "경향신문",
          "www.chosun.com": "조선일보", "www.donga.com": "동아일보", "www.joongang.co.kr": "중앙일보", "www.kyongbuk.co.kr": "경북일보",
          "www.idaegu.com": "대구일보", "www.kbmaeil.com": "경북매일", "www.ohmynews.com": "오마이뉴스", "www.mk.co.kr": "매일경제"}

arts = [a for a in json.load(open("data/raw/naver_news.json")) if "산불" in a["title"] + a["desc"] or "불" in a["title"]]
rows, hourly = [], collections.Counter()
for a in arts:
    t = round((datetime.fromisoformat(a["pub"]) - T0).total_seconds() / 60)
    host = urlparse(a["url"]).netloc
    regs = [i for i, r in enumerate(REGIONS) if r in a["title"]]
    rows.append([t, a["title"], OUTLET.get(host, host.removeprefix("www.")), a["url"], regs])
    hourly[t // 60] += 1
rows.sort(key=lambda r: r[0])
out = {"regions": REGIONS, "hourly": [[h * 60, n] for h, n in sorted(hourly.items())], "articles": rows,
       "meta": {"count": len(rows), "source": "네이버 뉴스 검색 API (관련도순 상위 1,000건 × 48개 검색어, 발행 2025-03-22~31)"}}
json.dump(out, open("web/public/data/news.json", "w"), ensure_ascii=False, separators=(",", ":"))
peak = max(hourly.items(), key=lambda kv: kv[1])
print(len(rows), "articles; peak hour", (T0 + timedelta(hours=peak[0])).strftime("%m-%d %H시"), peak[1])
