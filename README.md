# 산불 추적 (firetrace-kr)

2025 경북 산불(의성 발화)을 위성 열점·기상·보도로 재구성하는 타임라인 지도. FireTrace 한국판.

- `scripts/fetch_firms.py` — NASA FIRMS 아카이브 열점 (키: `~/.openclaw/secrets/firms-map-key`)
- `scripts/fetch_weather.py` — Open-Meteo ERA5 시간별 기상 격자 (키 불필요)
- `scripts/derive.py` — 산불 군집 추출·면적/확산속도·불 앞 날씨 → `web/public/data/fire.json`
- `data/raw/events.json` → `web/public/data/events.json` — 보도·공식 기록 (원문 링크·인용 필수)
- `web/` — Vite + React + MapLibre. `npm run dev`

열점 면적은 하한 추정(위성 통과 시각·375m 화소, 연기·구름 누락). 공식 피해 면적과 다르다.

## 2026-10-17 공공데이터 추가 (Codex)

- **읍면동 경계 65개**: `data/raw/admin_source.geojson`, `data/raw/admin_source.meta.json` →
  `web/public/data/admin.json` (약 152KB). 출처는 `vuski/admdongkor`의 2025-01-01 원본,
  commit `7360288277dfd12d74e54b959c59bdd66f852e3a`.
  다음 2025-04-01 판과 대상 5개 시군의 이름·코드·좌표가 동일함을 확인했다.
  `scripts/fetch_admin.py`가 원본 속성의 시군 코드를 검증하고 표준 Python으로 약 50m 단순화한다.
  `code`는 행안부 10자리 코드다. 독립 링 단순화이므로 인접 경계의 위상 정합성은 보장하지 않는다.
  SGIS 공공누리 1유형 출처표시와 가공자 `vuski/admdongkor`의 CC BY 4.0 조건을 유지해야 한다.
- **재난문자 과거 이력 수집 실패**: `scripts/fetch_disaster_sms.py`, `scripts/derive_sms.py`,
  `data/raw/disaster_sms.json`, `data/raw/disaster_sms.meta.json`,
  `data/raw/disaster_sms.blocked.md`, `data/raw/disaster_sms_notes.md`,
  `web/public/data/sms.json`, `web/public/data/sms.meta.json`.
  국민재난안전포털 구 JSP/JSON은 개편 홈페이지로 이동하며, 국민안전24에서 2025-03-22~30을
  날짜별 전국 조회하면 “데이터가 존재하지 않습니다.”를 반환한다(최근 문자 목록은 정상).
  대체 safetydata API 키 파일이 없어 신청·요청하지 않았다.
  **수집 배열은 0건이나 실제 발송 건수는 null, `complete: false`다. 발송이 없었다는 뜻이 아니다.**
  일별·발신기관별 수집 건수와 보도 시각 대조는 notes 및 파생 메타데이터에 기록했다.
  포털 하단은 행정안전부 저작권을 표시하며 별도의 재사용 허락은 확인하지 못했다.
- **임상도 접근성 조사**: `data/raw/forest_type.notes.md`, `data/raw/forest_type.blocked.md`와 대응 메타데이터.
  공공데이터포털 `15093362`, `3045619`는 산림청 SHP 제공 절차와 “이용허락범위 제한 없음”을 안내한다.
  FGIS의 유추 WMS/REST 후보는 오류 HTML을 반환했고 정상 Capabilities/GetMap은 확인하지 못했다.
  연결된 산림빅데이터플랫폼 상품은 이 환경의 네트워크 오류로 접근하지 못했다.
  실제 임상도 파일은 다운로드하지 않았으며, 산불 이전 제작연도와 임상 코드표 확인이 추가로 필요하다.
- 요청 캐시와 원문 응답의 출처·UTC fetch 시각·이용조건·건수·주의사항은
  `data/raw/public_cache/`의 `.body` / `.meta.json` 쌍에 보관한다.
  `scripts/public_data_http.py`는 초당 2회 미만 요청, 재시도 백오프, 실패 응답 캐시를 지원한다.
  새 수집 파일과 조사 메모에도 각각 대응 메타데이터가 있다. 기존 UI와 산불·보도 데이터는 변경하지 않았다.

재생성: `python3 scripts/fetch_admin.py`, `python3 scripts/fetch_disaster_sms.py`,
`python3 scripts/derive_sms.py`. 저장된 응답이 있으면 HTTP 요청 없이 재사용한다.
