# Task: collect international (non-Korean) data on the March 2025 Gyeongbuk wildfire

Repo: this directory. Read `README.md` first; reuse `scripts/public_data_http.py` (rate limit, cache, metadata sidecars) for every request. Study area bbox (lon/lat): 128.2, 35.9 → 129.6, 36.8. Period 2025-03-21 ~ 2025-04-05. Time base for derived files: minutes since 2025-03-21T00:00+09:00 (see `scripts/derive.py`).

Rules (same as before)
- No API keys exist for these sources and none should be requested; every source below is keyless.
- Do not touch `web/src/`, `fire.json`, `events.json`, `news.json`, `emd.json`, `kfs_fires.json`, `population.json`. New raw under `data/raw/intl/`, scripts under `scripts/`, derived under `web/public/data/` with new filenames.
- Each raw file gets a `*.meta.json` (source URL, fetch time UTC, licence/terms as shown, row count, caveats). Missing values stay null.
- Blocked source → `data/raw/intl/<name>.blocked.md` with the verbatim error, then move on.

## A. GDELT international press coverage (DOC 2.0 API, keyless, STRICT 1 request / 5 seconds — sleep 6 s between calls)
Base: `https://api.gdeltproject.org/api/v2/doc/doc`. Queries to run, each with `startdatetime=20250321000000&enddatetime=20250405000000&format=json`:
1. `mode=timelinevol` for `query="South Korea" wildfire` → hourly/daily volume.
2. `mode=timelinesourcecountry` same query → coverage by country.
3. `mode=artlist&maxrecords=250&sort=datedesc` for the same query, and again with `query=(Uiseong OR Andong) fire`, and `query=韓国 山火事`, `query=韩国 山火`. Keep each article's url, title, seendate, domain, language, sourcecountry, socialimage.
Output `data/raw/intl/gdelt_*.json` and derived `web/public/data/intl_news.json`: `{ daily: [[t_minutes_at_day_start, count]], by_country: [[country, count]], articles: [[t_minutes, title, domain, sourcecountry, language, url]] }` sorted by time, deduped by url.
Also note whether coverage peaks on the same day as the Korean peak (3/26 13:00 KST, from `web/public/data/news.json` → `hourly`).

## B. GDACS event record (keyless)
`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=WF&fromDate=2025-03-20&toDate=2025-04-05&alertlevel=Green;Orange;Red&country=Korea` returns a FeatureCollection (event 1023626 seen). Then fetch the event's episode/detail endpoint(s) (`/gdacsapi/api/events/geteventdata?eventtype=WF&eventid=…`) and save all episodes with their dates, alert levels, affected population estimates and any polygon. Derived `web/public/data/intl_gdacs.json` (episodes with t_minutes, alert level, text).

## C. EFFIS / GWIS burned-area perimeters (keyless OGC)
WMS GetCapabilities at `https://maps.effis.emergency.copernicus.eu/gwis?service=WMS&request=GetCapabilities&version=1.1.1` works (197 KB). Parse layer names; find burnt-area / fire-perimeter layers (names like `modis.ba.poly`, `viirs.ba.poly`, `gwis.ba`, `effis.ba`). Try the matching WFS (`service=WFS&request=GetFeature&typeName=<layer>&outputFormat=application/json&bbox=128.2,35.9,129.6,36.8&srsName=EPSG:4326`, maybe with a time/CQL filter for 2025-03). If WFS is not exposed, use WMS GetFeatureInfo or GetMap (PNG, 1024×768, bbox above, TIME=2025-03-28) and save the image. Goal: a GeoJSON of mapped burned-area polygons for this fire with their dates → `web/public/data/intl_burned.json` (simplify to ≤ 300 KB). Record exactly which layer and product (MODIS 250 m / VIIRS 375 m / Sentinel-2) it is.

## D. Satellite imagery and mapping products survey (research, 25 min cap; download only files ≤ 50 MB)
- Maxar Open Data Program: is there a "South Korea wildfires 2025" release? (`https://www.maxar.com/open-data`, STAC at `https://maxar-opendata.s3.amazonaws.com/events/catalog.json`). If yes, list event id, dates, tile count, licence (CC BY-NC 4.0 expected).
- Copernicus EMS rapid mapping: any activation (EMSRxxx) for Korea March 2025? (`https://rapidmapping.emergency.copernicus.eu/`) List activation code and products if any.
- UNOSAT / UNITAR maps for this fire (`https://unosat.org/products/`).
- NASA Earth Observatory: fetch `https://earthobservatory.nasa.gov/images/154083/outbreak-of-fire-across-south-korea` and any sibling articles; save title, date, instrument, image URLs, caption text.
- NASA GIBS: confirm which daily layers have imagery for 2025-03-22..28 over the bbox (VIIRS_SNPP_CorrectedReflectance_TrueColor, VIIRS_NOAA20_CorrectedReflectance_TrueColor, MODIS_Terra_CorrectedReflectance_TrueColor, MODIS_Aqua_…); test one tile per layer per day at `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/<LAYER>/default/<DATE>/GoogleMapsCompatible_Level9/8/98/219.jpg` and record which return a real JPEG (not a blank/transparent tile; check size > 2 KB). Output `data/raw/intl/gibs_availability.json`.
Write findings to `data/raw/intl/imagery_survey.md` with URLs and licences.

## E. ReliefWeb reports (keyless API)
`https://api.reliefweb.int/v1/reports?appname=firetrace-kr&query[value]=Korea wildfire&filter[field]=date.created&filter[value][from]=2025-03-21T00:00:00+00:00&filter[value][to]=2025-04-30T00:00:00+00:00&fields[include][]=title&fields[include][]=date&fields[include][]=source&fields[include][]=url&limit=50`. Save list → include in `intl_news.json` under `reports`.

## Finish
- Append "## 2026-10-17 해외 자료 (Codex)" to `README.md`: files, sources, licences, what was blocked.
- No git commit. End with a plain summary: counts per source, blocked items with reasons, exact file paths.
