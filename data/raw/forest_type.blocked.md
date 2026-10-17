# 임상도 공개 지도/상품 접근 실패 기록

2026-10-17 KST. 공식 카탈로그의 SHP 제공 안내는 확인했으나 직접 파일을 받지는 않았다.
조사 근거와 후보 URL 전체는 `forest_type.notes.md`에 있다.

- 공개 FGIS 소스에서 SuperMap 서비스 기본 경로와 임상도 데이터셋 `TB_FGIS_C5_IM5000`을 확인했다.
- 유추한 `https://map.forest.go.kr/gis1/iserver/services/map-fdms/wms111`에 GetCapabilities를 요청했다.
  동일 후보에 의성 부근 bbox, EPSG:4326, 256×256 PNG GetMap도 키 없이 요청했다.
- 두 응답은 HTTP 200이지만 Content-Type `text/html`이며 실제 오류 문구는 다음과 같다.

```
HTTP 404 Error
웹 페이지를 찾을 수 없습니다.
```

- `map-fdms/rest/maps.json` 및 `TB_FGIS_C5_IM5000.json`도 동일 오류 HTML이었다.
  확인된 공개 WMS가 아니므로 지원 레이어명·CRS를 추정하여 확정값으로 기록하지 않았다.
- 공식 카탈로그가 연결한 `https://www.bigdata-forest.kr/product/FRT001003`을 백오프로 총 3회 요청했다.
  이 환경의 원문 오류:

```
<urlopen error [Errno 51] Network is unreachable>
```

캐시된 실패 응답도 재사용하므로 재실행 시 같은 요청을 반복하지 않는다.
상품 로그인 여부·실제 파일 크기와 재사용 조건은 확인하지 못했다. 키 신청이나 200MB 초과 다운로드는 하지 않았다.
