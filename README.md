# 산불 추적 (firetrace-kr)

2025 경북 산불(의성 발화)을 위성 열점·기상·보도로 재구성하는 타임라인 지도. FireTrace 한국판.

- `scripts/fetch_firms.py` — NASA FIRMS 아카이브 열점 (키: `~/.openclaw/secrets/firms-map-key`)
- `scripts/fetch_weather.py` — Open-Meteo ERA5 시간별 기상 격자 (키 불필요)
- `scripts/derive.py` — 산불 군집 추출·면적/확산속도·불 앞 날씨 → `web/public/data/fire.json`
- `data/raw/events.json` → `web/public/data/events.json` — 보도·공식 기록 (원문 링크·인용 필수)
- `web/` — Vite + React + MapLibre. `npm run dev`

열점 면적은 하한 추정(위성 통과 시각·375m 화소, 연기·구름 누락). 공식 피해 면적과 다르다.
