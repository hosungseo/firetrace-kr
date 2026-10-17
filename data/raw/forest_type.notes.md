# 산림 임상도 / 산불 연료 자료 공개 여부 조사

확인일: 2026-10-17 KST. 조사 시간은 20분 이내. 임상도 본체(SHP/GDB/TIF)는 내려받지 않았다.
공식 카탈로그의 **SHP 제공 안내는 확인**했지만, 이 환경에서 인증 없이 작동하는 공개 WMS/WMTS 또는 직접 GeoJSON/SHP URL은 확인하지 못했다.
이는 서비스가 전혀 없다는 판정이 아니라 아래 경로의 실제 시험 결과다.

## 1. 공식 파일 제공 안내

| 자료 | 공식 URL | 확인 내용 | 페이지 표시 이용조건 |
|---|---|---|---|
| 산림청 임상도(산림간정보), 1:5,000 | https://www.data.go.kr/data/15093362/fileData.do | SHP, 기관 자체 다운로드. 임종·임상·주요수종·경급·영급·수관밀도 속성. 주제도 보기 → 산림공간정보 다운로드 무료신청 → 일반인 신청 → 대축척 임상도 → 지도 위치 → 신청 목적 → SHP 다운로드 절차 안내 | `이용허락범위 제한 없음` |
| 산림청 임상도 산림공간정보, 1:25,000 | https://www.data.go.kr/data/3045619/fileData.do | SHP, 기관 자체 다운로드. 카탈로그 설명에 임상(활엽수·침엽수), 수종 등 기재 | `이용허락범위 제한 없음` |
| 임상도 1:5,000 시군구 | https://www.data.go.kr/data/95566/linkedData.do | 산림빅데이터플랫폼 https://www.bigdata-forest.kr/product/FRT001003 로 연결. 카탈로그 검색 결과 설명은 2022년 기준 시군구별 ZIP/SHP, EPSG:5179 | 이용허락범위 칸이 비어 있음. 무제한 이용으로 추정하지 않음 |
| 임상도 1:5,000 시도 | https://www.data.go.kr/data/96010/linkedData.do | https://www.bigdata-forest.kr/product/FRT001002 로 연결. 검색 결과 설명은 2022년 기준 시도별 ZIP/SHP, EPSG:5179 | 이용허락범위 칸이 비어 있음 |

카탈로그 검색 출처: https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=%EC%9E%84%EC%83%81%EB%8F%84

전국·시도·시군구 범위 상품과 FGIS 지도에 경상북도 선택 항목이 있어 경북 대상 신청/추출 경로는 존재한다.
다만 실제 경북 파일 목록·용량·접근 허용 여부는 이번에 확인하지 않았다.
카탈로그 연결상품의 형식 배지 JSON은 카탈로그 메타데이터 형식이며, 임상도 본체가 GeoJSON이라는 뜻이 아니다.
전국 상품 설명에는 2GB 분할파일이 언급되어 있어 다운로드하지 않았다(이번 작업 200MB 상한).

## 2. 산림공간정보서비스 공개 페이지와 지도 서비스 시험

공개 페이지: https://map.forest.go.kr/forest/ (HTTP 200).
페이지는 `TB_FGIS_C5_IM5000`을 대축척 임상도 데이터셋 식별자로 사용하며,
2025년 임상도(2025), 2024년 임상도(2020~2024), 2019년 임상도(2015~2019), 2013년 임상도(2009~2013)를 선택 항목으로 표시한다.
**이 데이터셋 식별자는 GetCapabilities에서 확인한 WMS 레이어명이 아니다.**

확인한 공개 소스:

- https://map.forest.go.kr/forest/js/supermapgis/SuperMapDataService.js?version=2020.03.17.002
  - 기존 SuperMap 경로 `.../gis1/iserver/services/map-fdms/rest/maps/`를 사용한 조회 코드가 있다.
  - 현재 소스에는 `/forest/gis/supermap/features.do`로 보내는 서버 중계 POST 조회도 있다.
    화면의 내부 조회 구현으로, 일반 공개 WMS 또는 다운로드 API라고 해석하지 않았다.
- https://map.forest.go.kr/forest/js/supermapgis/FgisMapFunction.js?version=2020.03.17.002
  - `map-<udbNm>/rest/maps/<layerNm>` 동적 지도 경로 생성 코드가 있다.
- 메인 페이지에는 기본 `EPSG:5179`, 일부 표시 레이어 소스에는 `EPSG:3857`이 기재되어 있다.
  **이 값들은 WMS가 광고한 지원 CRS가 아니다.**

SuperMap 서비스 경로에서 유추한 아래 후보를 실제 요청했다. 공개 문서가 보장한 WMS 주소로 간주하지 않는다.

| 요청 | 시험 URL | 실제 결과 |
|---|---|---|
| GetCapabilities 후보 | https://map.forest.go.kr/gis1/iserver/services/map-fdms/wms111?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities | HTTP 200, Content-Type text/html, 본문 `HTTP 404 Error` / `웹 페이지를 찾을 수 없습니다.`. Capabilities XML 아님 |
| GetMap 후보 | https://map.forest.go.kr/gis1/iserver/services/map-fdms/wms111?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=TB_FGIS_C5_IM5000&STYLES=&SRS=EPSG%3A4326&BBOX=128.60%2C36.30%2C128.70%2C36.40&WIDTH=256&HEIGHT=256&FORMAT=image%2Fpng | 동일 HTTP 200 오류 HTML. PNG 시그니처 없음. 의성 부근 BBOX, 256×256, 키 없이 시험 |
| REST 지도 목록 | https://map.forest.go.kr/gis1/iserver/services/map-fdms/rest/maps.json | 동일 오류 HTML |
| REST 임상도 후보 | https://map.forest.go.kr/gis1/iserver/services/map-fdms/rest/maps/TB_FGIS_C5_IM5000.json | 동일 오류 HTML |
| ArcGIS 목록 후보 | https://map.forest.go.kr/gis1/arcgis/rest/services?f=pjson | 동일 오류 HTML |

다른 유추 후보 `map-forest/wms111`, 서비스 목록 `services.json`, `fgisApi/restjsr.json`도 동일 오류 HTML이었다.
성공적으로 확인한 GetCapabilities URL = null, WMS 레이어명 = null, 지원 CRS = null,
키 없는 정상 GetMap 가능 여부 = null(시험한 후보는 실패), 공개 WMTS URL = null.
로그인·키를 우회하지 않았고 기존 페이지에 들어 있는 지도 제공자 토큰도 사용하지 않았다.

FGIS 지도 하단 표시:

> 본 지도서비스는 법적효력이 없으므로, 해당기관에 연락하셔서 확인하시기 바랍니다.

하단 저작권은 `copyrights korea forest service. 2013`이다. 지도 화면 접근 가능 여부와 SHP 이용조건은 구분해야 한다.

## 3. 추가 접근 실패

산림빅데이터플랫폼 시군구 상품 URL을 3회 백오프로 요청했으나 이 환경에서 아래 전송 오류가 발생했다.

```
<urlopen error [Errno 51] Network is unreachable>
```

로그인 필요 여부·가격·상품 파일 용량은 확인하지 못했다. 이는 해당 사이트 자체의 영구 장애라는 뜻이 아니다.
최초 시도한 산림청 소개 페이지 `/kfsweb/kfi/kfs/gis/forestMapIntro.do?mn=NKFS_02_04_03_01_01`는 HTTP 404였으며,
그 대신 정상 응답한 산림공간정보서비스와 공공데이터포털 카탈로그를 조사했다.
개별 원문 응답·fetch 시각·상태·요청 URL은 `public_cache/*.body`와 대응 `*.meta.json`에 보관했다.
공개 페이지에 포함된 제공자 토큰은 캐시에서 지웠으며 그 사실을 메타데이터에 기록했다.

## 4. 앱 적용 시 주의

- 2025년 산불 **이전** 임상을 나타내려면 제작연도와 항공사진 촬영연도를 확인해야 한다.
  단순히 현재 메뉴의 ‘2025년’을 선택하면 산불 전 상태라는 보장이 없다.
  2024판(2020~2024) 또는 2022년 기준 상품을 우선 검토할 근거는 있으나, 실제 속성·범례 검증이 필요하다.
- 침엽수/활엽수/혼효림 재분류는 다운로드한 속성의 공식 코드표로 확인해야 한다.
  이번에는 원본 SHP와 코드표를 확보하지 않아 혼효림 코드, 실제 경북 분포, 연료량을 확정하지 않았다.
- 임상은 산림 구조·수종 분류 자료이며 실측 연료량이나 화재 당일 수분함량 자료가 아니다.
- 다음 실행은 FGIS 안내의 지도 위치별 소규모 신청이나 산림빅데이터플랫폼의 5개 시군 상품 접근 확인이다.
  신청·본인인증·대용량 다운로드는 이번 조사 범위에 포함하지 않았다.
