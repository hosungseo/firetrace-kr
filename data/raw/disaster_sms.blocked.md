# 재난문자 과거 이력 접근 실패

확인일: 2026-10-17 KST. 실제 발송 건수는 알 수 없음(null). 수집 배열 []는 부재 자료를 나타내며 발송 0건이라는 뜻이 아니다.

## 시도와 원문 응답

- 구 공개 JSP, 두 JS 후보 경로와 JSON POST disasterMsgList.do (searchInfo, 20250322~20250330, 경북 4700000000, idxArchive=2025)를 요청했다. 모두 HTTP 200 HTML로 새 홈페이지 /safekorea-kor/main/main.do에 이동했다. JSON 응답이 아니다.
- 개편 페이지의 인라인 JS를 확인했다. 현재 목록은 calamitySms.do에서 서버 렌더링하며 JSON 호출은 지역 선택용 changeSidoList_new.do/changeSggList_new.do이다. 달력에는 startDate:"-7d" 설정이 있다(서버 보관기간의 공식 설명은 아님).
- 최근 목록 대조 요청은 전체 117건으로 실제 문자가 표시됐다.
- 2025-03-22~30을 날짜별로 전국 조회했다. 각 날짜 전체 0건 및 아래의 동일 원문을 반환했다. 경북 기간 조회, 전국 기간 조회, 3/25 idxArchive=2025/202503도 같은 결과다.

> 데이터가 존재하지 않습니다.

- safetydata.go.kr V2/api/DSSP-IF-00247: ~/.openclaw/secrets/safetydata-* 파일 존재 여부만 확인했다. 일치 파일이 없어 요청·키 신청을 하지 않았다.

정확한 요청 URL/POST 본문, fetch 시각, 리디렉션 및 상태는 disaster_sms.meta.json attempts와 public_cache/*.meta.json에 보관했다. 캐시는 재실행에 재사용한다.
