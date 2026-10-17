# Consult round 2: build the claims mapping for the response-gap analysis

Your round-1 review is saved at `logs/astra-consult-1.md`; read it first. Decisions taken by the maintainer (Claude) after reading it:

ADOPTED (being implemented now, do not redo): hover no longer changes representative values; `rate_ha_h` shown only for completed windows and relabelled as post-hoc new-grid increase; "활성/연소 흔적" → "최근 12시간 탐지 / 12시간 이전 탐지"; exposure counter relabelled as 열점 탐지 읍면동 인구 with disclaimer; 99,282.5 vs 99,289 shown as unresolved; CAMS + PM2.5 row off by default and relabelled as a ~40 km forecast product with null-safe drawing; press-volume row renamed 수집 기사 수(표본); weather refetched with an explicit `models=era5`; derive_emd re-run on the unsimplified boundaries with VIIRS/MODIS first-detection separated; final-stat window clipped to the display period; 산림청 markers same-size "위치 근사".
REJECTED: removing 3D/oblique view (owner's explicit requirement; it stays as an option, default view will be less exaggerated). Removing the daily imagery (kept as an option with the overpass-time caveat).

YOUR JOB NOW (you have write access, use it):
Produce `data/raw/claims.json` — the manually reviewed claim-level dataset that `scripts/derive_response.py` will consume. Source files: `data/raw/events.json` (70 events, verbatim quotes), `data/raw/events_notes.md` (19 discrepancies), `web/public/data/admin.json` (65 읍면동 with `code`, `sigungu`, `emd`), `web/public/data/emd.json` (`first_hit` per 읍면동, minutes since 2025-03-21T00:00+09:00), `web/public/data/kfs_fires.json`.

Schema (one object per claim; split compound events like e45 into separate claims; keep both 길안면 entry claims e25 16:10 현하리 / 17:02 백자리 as separate claims):
```
{
  "claim_id": "e45a",
  "event_id": "e45",
  "action": "spread_entry | evacuation_order | alert_sms | road_control | shelter_opened | containment | casualty | official_stat | other",
  "event_time": "2025-03-25T19:09:00+09:00" | null,
  "time_precision": "minute | hour | day | unknown",
  "approximate": true|false,
  "published_time": "ISO or null  (earliest source publication time actually visible in the source; null if only a date is known — never fabricate midnight)",
  "published_date": "YYYY-MM-DD or null",
  "source_kind": "gov_document | gov_statement_via_press | press",
  "scope": "village | emd | city | route | province | national",
  "emd_codes": ["4717035000"],   // 10-digit codes from admin.json; [] when scope is city/province/national or unknown
  "sigungu": "안동시",
  "place_text": "as written in the source",
  "quote": "verbatim supporting quote (copy from events.json)",
  "source_url": "...",
  "notes": "any ambiguity, conflicting times, why you chose this mapping"
}
```
Rules: do not invent times; if a quote gives no time, `event_time: null` and `time_precision: "unknown"` (keep `published_date`). Map place names to 읍면동 codes only when the text names the 읍/면/동 or a 리 you can confidently place inside one (state the 리→읍면 reasoning in `notes`); otherwise use a wider scope. Write the file with `ensure_ascii=False`, sorted by event_time then claim_id.

Also produce `data/raw/claims_review.md`: (1) the per-읍면동 comparison table for every 읍면동 that has at least one `spread_entry` or response claim, with columns 진입 기록 시각 / 대응 기록 시각 / 위성 첫 탐지(`first_hit`) / 계산 가능한 시차(min) or `unknown` with the reason; (2) a short list of claims you think are unreliable and why; (3) the exact metric definitions you recommend `derive_response.py` emit (names, units, when to output null).

Do not modify any other file. Do not commit. End with a plain summary: number of claims, number of 읍면동 with comparable records, and the three cases you consider strongest.
