"""GDELT DOC 2.0 international coverage of the fire. Keyless; hard limit 1 request / 5 s (we wait 7 s)."""
import json, time, urllib.parse, urllib.request, datetime, os
BASE = "https://api.gdeltproject.org/api/v2/doc/doc"
WIN = "&startdatetime=20250321000000&enddatetime=20250405000000&format=json"
CALLS = [
    ("volume", 'query="South Korea" wildfire&mode=timelinevol'),
    ("countries", 'query="South Korea" wildfire&mode=timelinesourcecountry'),
    ("articles_en", 'query="South Korea" wildfire&mode=artlist&maxrecords=250&sort=datedesc'),
    ("articles_local", 'query=(Uiseong OR Andong) fire&mode=artlist&maxrecords=250&sort=datedesc'),
    ("articles_ja", 'query=韓国 山火事&mode=artlist&maxrecords=250&sort=datedesc'),
    ("articles_zh", 'query=韩国 山火&mode=artlist&maxrecords=250&sort=datedesc'),
]
os.makedirs("data/raw/intl", exist_ok=True)
out = {}
for name, q in CALLS:
    url = BASE + "?" + q.replace("query=", "query=" + "", 1) + WIN
    # encode only the query value
    k, v = q.split("&", 1)
    url = BASE + "?query=" + urllib.parse.quote(k[len("query="):]) + "&" + v + WIN
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "firetrace-kr research (contact via repo)"})
            body = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
            try:
                out[name] = json.loads(body)
            except json.JSONDecodeError:
                out[name] = {"_raw": body[:2000]}
            print(name, "ok", len(body))
            break
        except urllib.error.HTTPError as e:
            txt = e.read()[:200].decode("utf-8", "replace")
            print(name, "HTTP", e.code, txt[:80]); out[name] = {"_error": f"HTTP {e.code}: {txt}"}
            time.sleep(20)
    time.sleep(7)
json.dump(out, open("data/raw/intl/gdelt_claude.json", "w"), ensure_ascii=False)
json.dump({"source": "GDELT DOC 2.0 API " + BASE, "fetched_utc": datetime.datetime.now(datetime.UTC).isoformat(), "licence": "GDELT: free/open with attribution", "calls": [c[0] for c in CALLS], "caveat": "GDELT monitors a sample of world online news; volume is % of monitored articles, not absolute"}, open("data/raw/intl/gdelt_claude.meta.json", "w"), indent=1)
for n, v in out.items():
    if isinstance(v, dict) and "timeline" in v: print(n, "timeline pts", sum(len(s.get("data", [])) for s in v["timeline"]))
    if isinstance(v, dict) and "articles" in v: print(n, "articles", len(v["articles"]))
