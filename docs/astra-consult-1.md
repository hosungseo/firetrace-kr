# Consult: critique and upgrade plan for firetrace-kr

You are a senior reviewer (wildfire science + data journalism + geospatial product design). The repo in the working directory is a Korean adaptation of "FireTrace", a wildfire forensic timeline app, built today in one session. Read `README.md`, skim `web/src/App.tsx`, `web/src/MapView.tsx`, `web/src/Timeline.tsx`, `scripts/derive.py`, `scripts/derive_emd.py`, `data/raw/events_notes.md`. The attached images are current screenshots (3/22 ignition day; 3/25 18:00 with 길안면 hover; 3/26 03:00 night; 3/28 final; 3/26 14:00 daily VIIRS imagery with smoke row).

Subject: the March 2025 Gyeongbuk wildfire (의성 ignition 3/22 11:24 → 안동·청송·영양·영덕; ~99,000 ha official forest damage, 20+ deaths in 경북). Intended audience: Korean public officials and journalists reviewing *how the response unfolded in time*; the author is a Ministry of the Interior and Safety official who builds public-data tools.

What the app has now
- NASA FIRMS hotspots (5,613; VIIRS+MODIS) with a 12-h "active" window; hotspot-rasterised cumulative area and spread rate per overpass window.
- Open-Meteo ERA5 hourly wind/gust/RH on an 84-point grid; KMA ASOS 6 stations hourly + daily max instantaneous gust; CAMS PM2.5 grid.
- 70 press/official events with verbatim quotes; 11,480 Naver news articles (hourly volume); 산림청 per-fire records (the official 99,289 ha is two separately recorded 의성 fires: 괴산 46,575 + 안계 52,707).
- 65 읍면동 boundaries joined to 2025-03 resident population (70+ share) and the first hotspot time per 읍면동 → "exposure counter" (31 읍면동 / 98,579 residents / 30,650 aged 70+ touched).
- 3 basemaps + NASA GIBS daily imagery, 3D terrain with contours, sun-tracked hillshade.
- Known gaps: no 재난문자 (alert SMS) history (archive only keeps 7 days; API key pending), no 기상특보 history, no forest-type layer, hotspot area is a lower bound vs official area.

What I want from you
1. Hard critique: where is the analysis weak, misleading, or over-claiming? (e.g., hotspot-based "spread rate", exposure counter semantics, ERA5 vs station winds, press-time vs actual-time.) Name specific numbers on the screenshots or in the code that a careful reader would challenge.
2. The ONE analytical "money shot" this app should deliver that nothing else in Korea shows, given the data we have. Be concrete about how to compute it from the existing files (columns, time bases: minutes since 2025-03-21T00:00+09:00).
3. A prioritized upgrade list (max 8 items), each with: why it matters to the audience, exact data needed (already present / fetchable keyless / needs a key), implementation sketch against the existing code structure, and effort (S/M/L). Prefer items that increase evidentiary rigor over decoration.
4. Three framing/wording fixes for the UI (Korean), e.g. how to label the exposure counter honestly.
5. What should be cut or hidden by default because it adds noise.

Constraints: Vite + React + MapLibre, Python stdlib only (no numpy/shapely installed), everything must remain reproducible from `scripts/`. Do not modify files; this is a read-only consultation. Answer in Korean, with code identifiers in English. Be blunt and specific; no generic advice.
