# 산불추적기 (firetrace-kr)

라이브: https://seohosung.com/firetrace/ · 저장소: https://github.com/hosungseo/firetrace-kr

대형산불을 위성 열점·기상·보도·인구로 시간 순으로 다시 보는 타임라인 지도(FireTrace 한국판). 2023~2026년 100ha 이상 산불 14건, 2025 의성 산불은 보도 검토본.

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


## 2026-10-17 다중 사건 파이프라인 (Codex)

`data/incidents.seed.json`의 2023–2026년 대형 산불 14건을 사건별로 수집·파생한다.
Python 표준 라이브러리만 사용하며, `web/src/` 수정 없이 아래 데이터 계약을 따른다.

```sh
python3 scripts/build_incidents.py
python3 scripts/build_all.py --all
# 한 사건만 재생성 (각 fetch/derive 스크립트도 같은 --incident 옵션 지원)
python3 scripts/build_all.py --incident hapcheon-2023
python3 -m unittest discover -s scripts -p 'test_pipeline.py'
python3 scripts/verify_incidents.py
```

- 사건 추가: seed의 `incidents` 배열에 `id`, `name`, `short`, `start`, `end`, `sido`,
  `sigungu`, `ignition_emd`, `kfs`를 추가한다. `kfs` 키 형식은 `YYYY-MM-DD HH:MM 시군구`이며
  `data/raw/kfs_fires_2023_2026.json`의 실제 기록과 일치해야 한다. `display_days`와 `reviewed`는 선택이다.
  `python3 scripts/build_incidents.py`로 전국 경계의 시도·시군구 코드와 발화 행정동 면적 중심,
  대상 시군구 전체 bbox 중심 ±0.6도에서 FIRMS 탐색 군집으로 지도 범위를 계산한 뒤 `build_all.py --incident <id>`를 실행한다.
  다른 시도에 걸친 사건은 `incident.py`의 시도 대응도 명시한다(금산 사건의 서구는 대전광역시).
- 출력: `web/public/data/incidents.json`과 `web/public/data/<id>/*.json`.
  기존 의성 자료(검토된 사건·대응 기록, 해외 자료, 보도 본문 자동 추출·재난문자 결과 포함)는
  `web/public/data/uiseong-2025/`로 이동했다. 루트 JSON 경로는 더 이상 사용하지 않는다.
  `files`는 실제 존재하는 JSON 파일 목록, `stats.kfs_area_ha`는 seed KFS 기록만 합산한다.
- 시각: 사건 시작 전날 00:00 KST가 `t0`이며 의성은 `2025-03-21T00:00:00+09:00`을 유지한다.
  표시 기간은 기본 `(end − t0 날짜) + 1`, 3–10일 제한(명시한 값 우선)이다.
  기상 배열은 `t0`부터 `t0 + display_days + 1일`까지 매시 정렬하며, 관측 결측은 null이다.
  FIRMS는 전체 사건 종료일까지 수집하고 발화 전·종료일 이후 KST 관측을 제외한다.
  발화 행정동 중심에서 30km 이상 떨어진 군집만 있을 때는 다른 산불·산업 열점을 해당 사건으로 붙이지 않는다.
- 경계·발화 중심: 2025-01-01 admdongkor 행정동 3,555개를 고정 사용한다.
  법정동 난곡동·노곡동은 해당 행정동 경포동·관문동을 중심점 대용으로 사용하며
  법정동 폴리곤 중심으로 오인하지 않도록 `data/raw/<id>/registry_build.json`에 기록한다.
  2023·2026 행정구역 변경은 경계와 인구의 미연결을 유발할 수 있다. 강릉의 2023년 인구는 당시
  강원도 42 코드로 조회한 뒤 현재 경계 51 코드로 대응한다.
- 기상: bbox의 0.1도 요청 격자(최대 120점), Open-Meteo ERA5와 CAMS를 수집한다.
  요청 격자는 모형의 실제 해상도가 아니다. ASOS 목록은 기상청 공개 지점 CSV에서 생성한
  `data/raw/asos_stations.json`이며 사건 중심 60km 이내 최대 6개(의성은 기존 6개)를 사용한다.
  인구는 사건 시작 월의 행안부 `lv=3`, `regSeCd=1` 주민등록 거주자다.
- 원문·캐시: `data/raw/<id>/`와 그 안의 `http_cache/`; 공통 전국 경계·기상청 지점목록은
  기존 `public_data_http.py`의 `data/raw/public_cache/`를 재사용한다. 성공·실패 응답 모두 캐시되어
  같은 입력의 재실행은 HTTP 호출을 하지 않는다. FIRMS는 초당 1회 미만, 네이버는 8회 미만,
  data.go.kr는 3회 미만으로 순차 실행한다. 비공개 키는 파일에서 메모리로만 읽고
  캐시 URL·응답에서는 지운다. 변경된 날짜·bbox·질의는 별도 요청으로 캐시한다.
- 실패: `data/raw/<id>/<source>.blocked.md`에 기록하고 다른 자료의 생성은 계속한다.
  HTTP 오류의 명시적 재시도는 `build_all.py --incident <id> --retry-blocked`로 할 수 있다.
  API가 HTTP 200으로 돌려준 오류를 다시 요청하려면 해당 캐시 `.body`·`.meta.json` 쌍을 지운다.
  비어 있는 수집 배열은 실제 관측·보도·인구가 0이라는 뜻이 아니다.
- 확인: 실행 끝의 사건별 표와 `data/raw/<id>/verification.json`은 열점 수, 산림청 발화 대비
  첫 탐지 시차(분), VIIRS 375m 누적 격자 면적(ha), 열점이 들어간 읍면동 수를 제공한다.
  열점 5개 미만은 관측이 성긴 사건으로 표시한다. 격자 면적은 공식 산림피해 면적과 다르고 실제 소실 면적의 엄밀한 하한은 아니다.
  의성은 기존 36.4도 기준 격자 정의를 유지하고 다른 사건은 중심 위도를 사용한다. 또한
  `population_touched`는 해당 읍면동 전체 주민 합계로 실제 피해·대피 인구가 아니다.
  신규 사건에 수동 검토 기록을 복제하지 않는다. `events.json`·`response.json`은 검토된 사건에만 존재한다.


## 2026-10-17 기사 본문 기반 시각·지명 문장 추출 (Codex)

- `scripts/fetch_article_text.py`는 Naver 기사 11,483개 중 제목+설명에 65개 읍면동 이름이 있는
  3,150개와 추가 랜드마크만 있는 1,226개, 총 **4,376개 원 URL**을 수집했다.
  기존 `scripts/public_data_http.py`의 캐시·백오프를 사용하고 요청 시작 사이를 최소 0.51초로 제한했다.
  수집은 **43분 43.31초**로 45분 상한 안에 모두 완료했다. 연결 초기화 예외 1건도 별도 오류 캐시로 보존했다.
- 원 응답은 `data/raw/public_cache/`의 4,376개 body/meta 쌍, 추출 본문은
  `data/raw/article_text/<sha256(url)>.txt`와 `.meta.json`에 있다.
  URL·최종 URL·HTTP 상태·UTC 수집 시각·문자 수·제외 사유와 전체 목록은 `article_text/manifest.json`에 있다.
  `<p>`, `<article>`, article 계열 컨테이너를 표준 라이브러리로 파싱하며
  명시적인 본문 ID/itemprop을 우선해 추천 기사 혼입을 줄였다.
  **최종 성공 2,940개**, **300자 미만 본문 1,431개**, **HTTP/전송 실패 5개**, 미시도 0개다.
  짧은 본문에는 사진 단신도 있으며 전부 유료벽 또는 JS 차단이라고 단정하지 않는다.
- `scripts/extract_mentions.py` → `data/raw/mentions_auto.json`와 `.meta.json`,
  `web/public/data/mentions.json`. 본문에서 지명·시각·지정 행동 키워드가 함께 있는 문장을 뽑았다.
  동일 문장은 전재 URL 사이에서 합치고 가장 이른 게시 기사를 남겼다. `copies`는 보존 기사까지 포함한
  서로 다른 원 URL 수이며 `copy_urls`와 다중 시각 `time_mentions`도 보존했다.
  **중복 제거 문장 1,249개, 지명별 레코드 1,760개, 읍면동 44/65곳**이다.
  행동별 레코드는 spread 946, evacuation 762, alert 211, control 95, containment 181, casualty 154로,
  여러 행동이 한 레코드에 함께 있어 합계는 레코드 수보다 크다. 미매핑 146개, 시각 null 68개다.
- 시간 기준은 **2025-03-21T00:00:00+09:00 이후 분**이다. 명시적 NN일, 상대 날짜, 기사 게시일 순으로 해석한다.
  오전·오후 근거가 없는 1–12시는 null로 남기되 01–09시는 24시간제 표기로 읽는다.
  한 문장에 시각이 여럿이면 지명에 가장 가까운 시각을 선택하므로 문법적인 사건 연결을 보장하지 않는다.
  명시된 리·랜드마크 매핑만 사용하며 시군 전체를 각 읍면동으로 복제하지 않는다.
  시군 이름만 있는 문장은 필수 지명 조건을 충족하지 않아 제외한다.
  작업 도중 다른 세션에서 admin.json이 `web/public/data/uiseong-2025/`로 이동하여,
  원 경로가 없으면 이동 경로를 읽게 했고 원본과 내용 해시가 같음을 확인했다.
  요청된 웹 결과는 `web/public/data/mentions.json`에 생성하고, 현재 incident 경로에도 같은 결과를 저장한다.
- 웹 `first`는 **가장 이른 추출 명목 시각**이며 실제 최초 진입·대응 시각이 아니다.
  `count`는 시각 미상도 포함한 중복 제거 레코드 수이고, `hourly`는 시각을 아는 레코드를 행동 수와 무관하게
  1번씩 세며 `[분 단위 정시 시작 t, 건수]`로 저장한다. 각 읍면동 표본은 최대 12개·문장 최대 220자다.
- `data/raw/mentions_quality.md`에 seed `20250321`로 무작위 추출한 30개를 본문 맥락과 함께 검토했다.
  **장소·행동·시각 결합 추정 정밀도 20/30 = 66.7%**다. 발화→확산 시각 오연결,
  자정 직후 기사의 전날 문맥 누락, 대피 목적지·지명 부분 문자열, 서로 다른 사건의 시각 혼합이 주요 실패다.
  자동 후보를 수동 정답 사건으로 바꾸지 않았다. 통제 안내≠통제 시작, 발견≠사망,
  랜드마크 근접≠진입이고, 최초 게시 시각은 수정 본문이 그때 존재했음을 보증하지 않는다.
  표본·판정 메타데이터는 `mentions_quality_sample.json`, `mentions_quality.meta.json`에 있다.

재현 및 검증(모두 Python 표준 라이브러리만 사용):

```sh
python3 scripts/fetch_article_text.py --minutes 45
python3 scripts/fetch_article_text.py --reextract
python3 scripts/extract_mentions.py
python3 scripts/check_mentions.py
```

기존 캐시를 재사용하며 `--reextract`와 추출·검증 단계는 네트워크를 사용하지 않는다.
`data/raw/mentions_verification.json`에 경계 사례 21개, 출력·본문·캐시 대조,
가장 이른 전재 기사 선택, 오프라인 재현성과 입력 내용 보존 검증을 기록했다.
이 작업에서는 git commit을 실행하지 않았다.

### 기사 본문 문장 추출 정리 (2026-10-17)
- `scripts/derive_mentions_clean.py <incident>`: Codex 추출(`data/raw/mentions_auto.json`, 1,760건)에서 발화 시각이 다른 읍면동 문장에 붙은 58건을 걸러 `web/public/data/uiseong-2025/mentions.json` 재생성. 앱의 읍면동 상세·대응 시차 탭에 "자동 추출 후보(표본 정밀도 66.7%)"로만 표시.
