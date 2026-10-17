# Task: collect additional public data for the 2025 Gyeongbuk (Uiseong) wildfire timeline app

Repo: this directory (`firetrace-kr`). Read `README.md`, `scripts/derive.py`, `data/raw/events.json` (70 verified press/official events) first. Study area: 경북 의성군·안동시·청송군·영양군·영덕군, period 2025-03-22 ~ 2025-03-30 (KST). Python 3 for scripts; no new npm deps.

Rules
- Never print, log or commit any API key. Keys, if needed, live in `~/.openclaw/secrets/` and are read at runtime only.
- Do not touch `web/src/`, `web/public/data/fire.json`, `events.json`, `news.json`. Write new raw data under `data/raw/`, new scripts under `scripts/`, new derived files under `web/public/data/` with NEW filenames.
- Every raw file must have a sibling `*.meta.json` with: source URL, fetch time (UTC), licence/terms as shown on the source page, row count, and any caveat.
- Missing values stay null (never 0). Keep original timestamps as strings alongside any parsed minutes.
- Be polite to servers: ≤ 2 req/s, retry with backoff, cache responses on disk so re-runs are free.
- If a source is impossible (login wall, no history, captcha), write `data/raw/<name>.blocked.md` explaining exactly what you tried and the verbatim error, then move on.

## A. 재난문자 (emergency alert SMS) history — highest priority
Goal: every 재난문자 sent 2025-03-22 00:00 ~ 2025-03-30 23:59 KST whose receiving area includes any of 의성군, 안동시, 청송군, 영양군, 영덕군 (plus 경상북도 전체 broadcasts).
Source candidates, in order:
1. 국민재난안전포털 safekorea.go.kr 재난문자 archive. The public page `https://www.safekorea.go.kr/idsiSFK/neo/sfk/cs/sfc/dis/disasterMsgList.jsp` is backed by a JSON endpoint (search by date range and region); inspect the page JS / network calls to find it (look for `disasterMsgList`, `idxArchive`, `*.do` POST with JSON body). Historical search back to 2025 is expected to work.
2. safetydata.go.kr `V2/api/DSSP-IF-00247` — only if a key exists at `~/.openclaw/secrets/safetydata-*`; otherwise skip (do NOT apply for one).
Output `data/raw/disaster_sms.json`: array of `{ id, sent_at: "2025-03-25T16:55:00+09:00", sender: "안동시", regions: ["경상북도 안동시 전체"], level: "긴급재난|안전안내|위급재난", text: "...", source_url }`. Then `scripts/derive_sms.py` → `web/public/data/sms.json` compact array `[t_minutes_since_2025-03-21T00:00+09:00, sender, level, text, regions]` sorted by time. Report count per day and per sender.
Cross-check: `data/raw/events.json` contains press-reported alert times (type `alert`/`evacuation`, e.g. 안동시 재난문자 3/25 16:55, 영덕 19:09). List any mismatch between scraped sends and press-reported times in `data/raw/disaster_sms_notes.md`.

## B. 읍면동 administrative boundaries for the 5 시군
Source: GitHub `vuski/admdongkor` (행정동 경계 GeoJSON, pick the version valid for 2025-03). Filter to 시군구 codes for 의성군(47730) 안동시(47170) 청송군(47750) 영양군(47760) 영덕군(47770) — verify codes from the file's own attributes, don't trust these numbers blindly. Simplify geometry to ~50 m tolerance (write a tiny Douglas-Peucker or use shapely only if already installed; check `python3 -c "import shapely"`). Output `web/public/data/admin.json` (GeoJSON FeatureCollection, properties: `sido, sigungu, emd, code`) ≤ 1.5 MB. Also `data/raw/admin_source.meta.json` with the commit/file URL and licence.

## C. 산림 임상도 (forest type / fuel) availability check — research only, 20 min cap
Find whether 산림청 FGIS (map.forest.go.kr / 산림공간정보서비스) or data.go.kr exposes a public WMS/WMTS/tile URL or downloadable GeoJSON/SHP for 임상도 (침엽수/활엽수/혼효림) covering 경북. If a WMS exists, record the GetCapabilities URL, layer name, CRS and whether it works without a key (test one GetMap request). Write findings to `data/raw/forest_type.notes.md`. Do not download anything over 200 MB.

## Finish
- `python3 scripts/derive_sms.py` must run clean from the repo root.
- Append a short section "## 2026-10-17 공공데이터 추가 (Codex)" to `README.md` listing new files, sources and caveats.
- Do NOT git commit. End with a plain summary: what was collected (counts), what was blocked and why, exact file paths.
