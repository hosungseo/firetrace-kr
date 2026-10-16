"""Fetch KMA ASOS hourly + daily observations for stations around the fire (data.go.kr)."""
import json, os, time, urllib.parse, urllib.request

KEY = urllib.parse.quote(open(os.path.expanduser("~/.openclaw/secrets/data-go-kr-firetrace-key")).read().strip(), safe="")
STATIONS = {278: "의성", 136: "안동", 276: "청송군", 277: "영덕", 271: "봉화", 138: "포항"}
BASE = "https://apis.data.go.kr/1360000"

def get(url):
    for i in range(4):
        try:
            res = json.load(urllib.request.urlopen(url, timeout=30))
            return res["response"]["body"]["items"]["item"]
        except Exception as e:
            print("retry", i, e); time.sleep(1 + i)
    raise RuntimeError(url)

hourly, daily = {}, {}
for stn, name in STATIONS.items():
    hourly[stn] = get(f"{BASE}/AsosHourlyInfoService/getWthrDataList?serviceKey={KEY}&pageNo=1&numOfRows=999&dataType=JSON"
                      f"&dataCd=ASOS&dateCd=HR&startDt=20250321&startHh=00&endDt=20250331&endHh=23&stnIds={stn}")
    time.sleep(0.4)
    daily[stn] = get(f"{BASE}/AsosDalyInfoService/getWthrDataList?serviceKey={KEY}&pageNo=1&numOfRows=99&dataType=JSON"
                     f"&dataCd=ASOS&dateCd=DAY&startDt=20250321&endDt=20250331&stnIds={stn}")
    time.sleep(0.4)
    print(stn, name, len(hourly[stn]), len(daily[stn]))
json.dump({"stations": STATIONS, "hourly": hourly, "daily": daily}, open("data/raw/kma_asos.json", "w"), ensure_ascii=False)
