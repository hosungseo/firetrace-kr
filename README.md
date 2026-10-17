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

### 같은 날 Claude가 추가한 자료
- **행안부 주민등록 인구(읍면동, 2025-03)**: `data/raw/population_emd.json` → `scripts/derive_population.py` → `web/public/data/population.json`. 의성군 70세 이상 35%.
- **산림청 산불발생통계(건별)**: data.go.kr 3070842(2026-10-17 승인). `scripts/fetch_kfs_fires.py` → `data/raw/kfs_fires.json` → `scripts/derive_kfs.py` → `web/public/data/kfs_fires.json`. 좌표 없음 → 읍면 중심 배치. 공식 99,289ha = 의성 2건(괴산 46,575 + 안계 52,707)의 합.
- **읍면동 × 인구 × 열점 결합**: `scripts/derive_emd.py` → `web/public/data/emd.json` (열점 첫 관측 시각 `first_hit`, 70세 이상 비율). 앱의 "불이 닿은 읍면동" 노출 계수기가 이 파일을 쓴다.
- 코덱스 위임 과제문: `docs/codex-task-publicdata.md`, 실행 로그는 `logs/`(git 제외).

## 2026-10-17 해외 자료 (Codex)

- 수집·재생성: `scripts/fetch_international.py` (그룹별 또는 `all`),
  `scripts/summarize_international.py` (조사 메모·출처 정리),
  `scripts/derive_international.py` (오프라인 파생).
  모든 원문은 `data/raw/intl/`, 응답 캐시는 `data/raw/public_cache/`에 있다.
  HTTP는 기존 `scripts/public_data_http.py`를 사용하며 GDELT에는 요청 사이 최소 6초를 적용했다.
  원문·조사 문서마다 `.meta.json`에 URL, UTC 수집 시각, 이용조건, 건수와 주의사항을 저장했다.
  시간 기준은 기존과 같은 `2025-03-21T00:00:00+09:00` 이후 분이다. 키는 사용·요청하지 않았다.
- **GDACS**: `data/raw/intl/gdacs_search.json`에서 한국 사건 5개를 확인했다.
  지정된 `1023626`은 bbox 밖의 사건이므로 참고 원문만 보존했고, bbox 안의
  `1023633`, `1023634` 각각 6개 에피소드·폴리곤·영향평가를 수집했다.
  `web/public/data/intl_gdacs.json`은 **12개 에피소드**, 경보 수준, 날짜, 모델의
  `POPAFFECTED` 인구 추정을 담는다. 최종 추정은 각각 758명·3,743명이며 공식 대피 인원이 아니다.
  일반 사건 API는 `episodeid`를 무시하므로 응답이 안내하는 `getepisodedata`를 사용했다.
  에피소드 시간은 원문의 `polygondate`(자료 갱신 시각)이며 시간대 없는 날짜는 UTC로 해석했다.
  GDACS 약관은 모델 불확실성과 무보증을 명시하며, 별도 오픈 라이선스는 확인하지 못했다.
- **GWIS 소실지 추정 경계**: `data/raw/intl/gwis_capabilities.xml`,
  `gwis_layers.json`, `gwis_wfs_gml.xml` → `web/public/data/intl_burned.json`.
  `nrt.ba.poly` WFS의 **GML2**가 성공했다. bbox의 전체 연도 44개 중 대상 기간과 겹치는
  **23개**를 추출하고 약 50m로 단순화했다(약 53KB, 300KB 이하).
  제품은 **MODIS 1km + VIIRS 375m 열점 기반 GWIS NRT 경계 추정**이다.
  MODIS 250m 또는 Sentinel-2 소실흔 분류 자료가 아니며, 인근 소규모 산불도 포함한다.
  중첩 경계를 합산한 값을 총 피해 면적으로 사용하면 안 된다. EU/JRC GWIS 소유 콘텐츠는
  **CC BY 4.0**이며 출처·필터링·형식 변환·단순화를 표시해야 한다.
  WFS JSON 형식은 거부됐지만 GML로 복구했다. GlobFire 레이어는 서버/PostGIS 오류,
  JSON GetFeatureInfo는 미지원이었다. 3/28 NRT PNG는 완전 투명하여 유효 경계로 세지 않았다.
- **GDELT 보도·ReliefWeb**: `data/raw/intl/gdelt_*.json`,
  `reliefweb_reports.json`, `reliefweb_reports_v2.json` → `web/public/data/intl_news.json`.
  지정된 6개 GDELT 질의와 실제 건수용 `timelinevolraw` 1개가 모두 **HTTP 429**로 차단됐다.
  수집 기사 0개는 보도 자체가 없었다는 뜻이 아니다. 총건수·해외 정점·동일 날짜 여부는 **null**이다.
  국내 `news.json`의 정점은 **3/26 13:00 KST, t=7980, 292건**으로 확인했으나 해외와 비교 불가다.
  `timelinevol`의 비율을 기사 건수로 바꾸어 쓰지 않았다.
  ReliefWeb v1은 **410(폐기)**, 안내된 v2는 **403(appname 미승인)**으로 실패했다.
  `reports`는 빈 수집 배열이고 실제 보고서 총수는 null이다. 기사·사진 권리는 각 원저작자에게 있으며
  이 실패 응답에서 재사용 라이선스를 추정하지 않았다. 오류 원문은 각 `.blocked.md`에 보존했다.
- **위성영상·국제 지도 조사**: `data/raw/intl/imagery_survey.md`, `imagery_findings.json`.
  Maxar STAC의 55개 사건 목록에 한국 산불 공개판은 없었다. 사건 ID·타일 수는 null이며,
  루트 라이선스는 **CC BY-NC 4.0**이다. Maxar 웹페이지 자체는 네트워크 오류로 접근하지 못했다.
  Copernicus EMS 전체 **1,067개** 활성화를 확인했으나 한국 대응 EMSR 코드는 없었다.
  CEMS 이용조건은 출처를 표시한 복제·배포·수정을 허용하되 제한·제3자 자료는 예외다.
  UNOSAT 한국·날짜 조건 검색은 빈 결과였으며 지도별 라이선스는 확인되지 않았다.
  UNITAR 일반 약관은 출처를 표시한 연구·교육·비영리 이용 등을 안내한다.
- **NASA**: `data/raw/intl/nasa_articles.json`에 기사 **2개**의 제목·게시일·센서·이미지 URL·캡션·크레디트,
  `nasa_154083_image.jpg`, `nasa_154142_image.jpg`에 이미지 **2개**(각 약 3.9MB·4.1MB)를 저장했다.
  3/22 **Aqua/MODIS**, 4/4 **Landsat 9/OLI-2** 영상이며 두 번째 기사의 게시일은 4/8로 조사 기간 밖이다.
  NASA 일반 이미지 이용지침의 출처표시와 제3자 권리·보증/후원 오인 금지 조건을 유지해야 한다.
- **NASA GIBS**: `data/raw/intl/gibs_availability.json` 및 대응 JPEG·메타데이터.
  요청한 4개 true-color 레이어 × 3/22~28 × 2개 위치에서 **56/56** 타일이 JPEG·256×256·2KiB 초과 검사를 통과했다.
  지정된 `8/98/219`는 bbox 북쪽이어서 bbox와 겹치는 `8/100/219`도 검사했다(**28/28** 성공).
  일부 공간을 표본 검사한 결과이며 전체 bbox의 구름 없는 영상 가용성을 보장하지 않는다.
  영상은 최대 50MB 이하만 내려받았고 영상 조사는 25분 안에 마쳤다.
  탐색 중 GIBS 문서의 `/access-usage/`는 404였지만 `/access-basics/`와 실제 타일은 정상이다.

이 작업은 기존 UI·보도·산불·인구 JSON을 쓰지 않았으며 git commit을 실행하지 않았다.
작업 도중 다른 세션의 UI 변경·커밋이 관측되어 그대로 보존했다.
검증 결과는 `data/raw/intl/verification.json`에 있다. 원문 200개와 대응 메타데이터,
83개 링의 폐합·좌표 범위, 분 단위 정렬, 인구 추정과 null 처리, HTTP 6초 간격 재시도·캐시를 확인했다.
파생 스크립트 재실행 전후 보호 파일의 해시가 동일함도 확인했다.

### 대응 시차 탭 · astra 검토 반영 (2026-10-17)
- `logs/astra-consult-1.md`(gpt-6-astra 비판 검토) → 채택분: hover가 대표값을 바꾸지 않음, ha/h는 관측 구간별 사후 지표로 재명명, 읍면동 인구 합은 노출 인구가 아님을 명시, 일 단위 사건은 하루 띠, 사후 분석 기사 표시, `models=era5` 명시 재수집, CAMS 기본 꺼짐.
- `data/raw/claims.json`(179개 주장, astra 2라운드 수동 매핑) + `data/raw/claims_review.md` → `scripts/derive_response.py` → `web/public/data/response.json`. 검토된 쌍 7개만 계산(최소값 자동 선택 금지). 석보면: 진입 보도 17:40 → 대피명령 18:47(+67분) → 위성 첫 탐지 21:25(+158분).
- 해외: `scripts/fetch_gdelt.py`(7초 간격에도 timelinevol 1건만 통과, 나머지 429) → `intl_news.json.gdelt_volume`. GWIS 둘레 23개·GDACS 12 에피소드는 Codex 수집분(`## 2026-10-17 해외 자료` 참조).
