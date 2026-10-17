# Task: extract timed, place-bound sentences from the full text of Naver-indexed articles

Repo: this directory. Reuse `scripts/public_data_http.py` (cache, ≤2 req/s, backoff). Time base: minutes since 2025-03-21T00:00+09:00.

Input: `data/raw/naver_news.json` (11,483 articles: title, desc, url, naver link, pub ISO). Target set: articles whose `title+desc` mentions any 읍면동 name from `web/public/data/admin.json` (`properties.emd`, 65 names; ~3,150 articles). Also include articles mentioning any of 괴산리, 현하리, 백자리, 하회마을, 고운사, 병산서원, 주왕산, 점곡휴게소, 영덕아산병원, 청송교도소.

## Step 1 — fetch full text (cache everything)
For each target article fetch the `url` (original link). Extract the article body with a stdlib-only heuristic: `<p>` blocks and the `<article>`/`id="articleBody"`/`class*="article"` containers; strip tags; collapse whitespace. Save `data/raw/article_text/<sha256(url)>.txt` + meta (url, final_url, http status, fetch utc, chars). Skip paywalled/JS-only pages (<300 chars body) and record them. Hard cap 45 minutes of fetching; after that, continue with what you have. Report how many succeeded.

## Step 2 — sentence-level extraction (`scripts/extract_mentions.py`, stdlib only)
Split body into sentences (。.!? and Korean sentence enders 다./요.). Keep sentences that contain (a) a 읍면동 name or one of the landmark names above, AND (b) a clock expression (`(오전|오후)?\s?\d{1,2}시(\s?\d{1,2}분)?(께|쯤|경|경에)?`, or `정오`, `자정`) AND (c) an action keyword from this list:
- spread: 비화, 번졌, 번져, 확산, 넘어, 도달, 옮겨붙, 덮쳤
- evacuation: 대피, 피신, 이송
- alert: 재난문자, 안전안내문자, 재난안전문자, 긴급재난문자, 문자를 발송, 경보
- control: 통제, 차단, 폐쇄, 운행 중단, 통행금지
- containment: 진화율, 주불, 잔불, 완진, 진화 완료
- casualty: 사망, 숨진, 숨졌, 실종, 부상
Resolve the date for each clock expression from the article's pub date and words like 전날/이날/오늘/어제/24일 (an explicit `NN일` wins). Output one record per (sentence, 읍면동) with:
`{ "url", "outlet"(domain), "published", "sentence", "emd_codes": [...], "place_text", "time_text", "event_time": ISO or null, "t": minutes or null, "date_basis": "explicit_day|article_day|previous_day|unknown", "actions": ["evacuation", ...] }`
Map 리/landmark → 읍면동 using `data/raw/claims_review.md` §1 mappings where stated (괴산리→안평면, 현하리·백자리→길안면, 하회리→풍천면, 철파리→의성읍, 고운사→단촌면, 점곡휴게소→점곡면) and admin.json for 읍면동 names; leave `emd_codes: []` when only a 시군 is named.
Dedupe identical sentences across syndicated copies (keep earliest published; store `copies` count).

## Step 3 — outputs
- `data/raw/mentions_auto.json` (all records) + meta.
- `web/public/data/mentions.json`: `{ "by_emd": { "<code>": { "first": {action: t_min|null}, "count": {action: n}, "hourly": [[t_hour_start, n]], "samples": [ up to 12 records with t, sentence (≤220 chars), url, outlet, actions ] } }, "unmapped": n, "meta": {...} }`.
- `data/raw/mentions_quality.md`: 30 random records you checked by eye with ✓/✗ and the main failure modes; estimated precision.
Do not modify any existing file except appending a section to `README.md`. No git commit. End with counts: articles fetched/failed, sentences kept, records per action, 읍면동 covered.
