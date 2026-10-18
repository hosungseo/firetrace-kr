# 산불추적기 작업 기록

라이브: https://seohosung.com/firetrace/ (hosung-profile `public/firetrace/`에 `web/dist` 복사 후 push)
개발: `cd web && npm run dev -- --port 5188`

## 2026-10-18

### 새 데이터
- **산림청 국가산불정보시스템** (fd.forest.go.kr, 로그인 불필요, Aside로 엔드포인트 발굴) → `scripts/fetch_ffas.py` → `web/public/data/<id>/ffas.json`
  - 신고·접수·확인 초 단위 시각, 최종 대응단계, 누적 헬기·인력(minfr+bckfr)·장비, 마지막 공개 상황도(화선·진화완료선)
  - 14건 전부 매칭. 진화자원 이력은 통계 기록 기준이라 발화 분이 1~2분 다를 수 있음(±5분 매칭)
- **임상도** (map.forest.go.kr SuperMap `map-TB_FGDI_IM5000`, 리다이렉트 쿠키 필요) → `scripts/fetch_forest_type.py` → `forest_type.png/json`
  - 범례 47색 역분류. 현재판(2026-02)이라 홍성·대구·강릉·산청 피해지는 이미 미립목지로 바뀜, 의성은 아직
- **산불통계연보** PDF 2023~2025 → `data/raw/kfs_docs/` (gitignore, 2025는 스캔본)
- **천리안위성 2A호 산불탐지(FF)** 기상청 API허브, 10분·2km → `scripts/fetch_gk2a_ff.py` → `scripts/derive_gk2a_path.py` → `gk2a.json`
  - 키 `~/.openclaw/secrets/kma-apihub-key`, 활용신청 646·647·648·1123
  - 원자료 '승인 이용자 제한' → NetCDF는 추출 후 삭제, 탐지 위치·시각만 게시
  - 의성·산청·울주 완료. 콜드 프레임 첫 요청 504 → 재시도, 프레임당 약 3.5초

### 분석
- **확산 경로** `scripts/derive_spread.py` → `spread.json`: VIIRS 칸 첫 탐지=도달 시각, 통과 사이 전진 벡터(1.5km 연결 묶음), 통과별 머리, 별도 발화 표시, 통과별 피해 범위 경계
- **천리안 10분 경로**: 60분 안 2회 탐지·VIIRS 3km 필터, 화소를 가장 가까운 '타고 있던' 발화점에 배정, 머리=주 발화점 최원 화소
  - 의성: 첫 탐지 12:00(신고 11:24, VIIRS 13:22), 3/25 16:00 29km → 18:50 62km, 최대 1시간 15.5km/h
- **하이브리드 피해 범위**: 모양=VIIRS 375m 칸, 시각=min(VIIRS, 1.6km 안 천리안 첫 탐지), 경계선 매시간. 의성 2,925칸 중 2,607칸 앞당김
  - 천리안 화소 그대로 그리면 162,000ha (VIIRS 41,133 · 산림청 산림피해 99,289 · 중대본 영향구역 45,170) → 비교 보기로만 제공
- **기록 대조 천리안 열**: 진입 보도 대비 석보 +20·지품 −20·길안 +60분, 극궤도는 +165~558분

### 화면
- FireTrace 참고: 주요 장면 fly-to, 불의 선두 카드(따라가기), 피해 범위 경계, 화살표 그라데이션, 강조색 #D84C2E
- UX: 타임라인 기본 3줄(차트 더보기), 레이어 팝오버, 탭 배지, 모바일 지도 58vh, 단축키(Space ←/→ 1~9 L Esc)
- **버그**: maplibre v6 워커가 프로덕션 빌드에 빠져 출시 이후 라이브 지도 레이어가 안 그려졌음 → `maplibre-gl-worker.mjs?url` + `setWorkerUrl`. 배포 후 라이브 콘솔 반드시 확인

### 영상
- `docs/firetrace-demo-15s-share.mp4` (12MB, 원본 50MB는 gitignore)
- `video/capture2.mjs`: 앱 크롬 숨김·밤 지도·DEV 훅 `window.__ft`로 시계/카메라를 프레임별 구동, 단조 선두(lead)를 t+15분 앞서 추적, `map.project`로 선두 화면 위치 검증
- `video/index.html`: HyperFrames 합성(자막 3개, 15.6km/h 카운터, 엔드카드). `npx hyperframes render -o ../docs/firetrace-demo-15s.mp4 -q delivery`
- 1판(UI 스크린캐스트)은 "불이 작다"는 피드백으로 교체

### 쓰레드 문구(게시 대기)
> 산불추적기를 업데이트했습니다. 이번엔 불이 어디로, 얼마나 빨리 갔는지에 집중했습니다. … 불의 맨 앞은 오후 4시에 발화점에서 29km, 6시 50분에 62km … 가장 빨랐던 1시간은 시속 15.6km … seohosung.com/firetrace

### 남은 것
- 기상청 특보 이력(API허브 로그인 됨, 아직 미신청), 재난문자(safetydata 로그인이 Aside 세션에 안 잡힘), forest.go.kr 보도자료(curl 리다이렉트 루프로 레이트리밋 → 세션 필요)
- 천리안 경로: 나머지 11개 사건 미수집
- API허브 세션은 몇 분 만에 끊김 → 로그인 직후 한 번에 처리
