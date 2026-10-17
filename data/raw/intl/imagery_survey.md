# International imagery survey — March 2025 Gyeongbuk wildfire

Survey requests: 2026-10-17T00:42:22.045855+00:00 to 2026-10-17T00:54:04.256964+00:00 (11.7 minutes; 25-minute cap). No credentials used. Every download ≤50 MB.
Study bbox: 128.2,35.9,129.6,36.8. Study dates: 2025-03-21–2025-04-05 KST. Negative findings describe the queried catalogs only.

## Maxar Open Data

- https://www.maxar.com/open-data failed with the exact network error in `maxar_home.blocked.md`.
- The accessible official STAC root https://maxar-opendata.s3.amazonaws.com/events/catalog.json lists **55** event collections. No Korea/Uiseong/Andong release appears in its child links.
- Korean event id, dates and tile count: **null** (no matching release found); no imagery downloaded. Root licence: **CC-BY-NC-4.0**. The unavailable website prevents a universal absence claim.

## Copernicus EMS Rapid Mapping

- https://rapidmapping.emergency.copernicus.eu/ redirects to https://mapping.emergency.copernicus.eu/activations/. The frontend script identifies the public activation API.
- https://mapping.emergency.copernicus.eu/activations/api/activations/?limit=2000&offset=0 returned **all 1,067** activations, `next: null`. No Korean activation is present, including March 2025. No matching EMSR code or products found.
- Seven activations overlap March 1–April 5 by activationTime: EMSR792–EMSR798, in Spain, Mozambique, Italy, Ecuador, Bosnia-Herzegovina and Myanmar. The exploratory `activationTime` query did not filter correctly; the finding uses the complete catalog and local filtering.
- Terms: https://mapping.emergency.copernicus.eu/terms-and-conditions/ — free access, reproduction/distribution/adaptation with citation; restricted and third-party information can have separate conditions.

## UNOSAT / UNITAR

- https://unosat.org/products/ is a JavaScript shell; its script calls the keyless `/our_products/` search API.
- The GET catalog lists the country as `Korea (the Republic of)`. POST https://unosat.org/our_products/ with that region, 2025-03-01 through 2025-04-30, empty title, `is_active:false` (include closed), `is_charter:null` returned **[]**. No matching product/map URL found.
- Broad search returned 36 records, some created before the date window; no Korea match. Empty filter arrays also produced a misleading empty response, so the final query omits unused filters. Raw request bodies are retained in sidecars/cache.
- https://www.unitar.org/legal permits research/private-study extracts and educational/non-commercial reuse with acknowledgment and article URL; substantial/commercial reuse requires authorization. No map-specific open licence was found because no matching map was retrieved.

## NASA Earth Observatory

- **Outbreak of Fire Across South Korea**: https://science.nasa.gov/earth/earth-observatory/outbreak-of-fire-across-south-korea-154083/
  Published 2025-03-25T12:00:00-04:00; acquired 2025-03-22; instrument **Aqua / MODIS**.
  Image URLs: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154083/southkoreafires_amo_20250322.jpg, https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154083/southkoreafires_amo_20250322_lrg.jpg
  Credit: NASA Earth Observatory image by Michala Garrison, using MODIS data from NASA EOSDIS LANCE and GIBS/Worldview. Story by Lindsey Doermann.
- **South Korea Charred by Fire**: https://science.nasa.gov/earth/earth-observatory/south-korea-charred-by-fire-154142/
  Published 2025-04-08T12:00:00-04:00; acquired 2025-04-04; instrument **Landsat 9 / OLI-2**.
  Image URLs: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154142/skoreaburnscar_oli2_20250404.jpg, https://science.nasa.gov/wp-content/uploads/2025/10/skoreaburnscarzm_oli2_20250404.jpg, https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154142/skoreaburnscar_oli2_20250404_lrg.jpg
  Credit: NASA Earth Observatory images by Lauren Dauphin, using Landsat data from the U.S. Geological Survey . Story by Kathryn Hansen.
- Original requested URL: https://earthobservatory.nasa.gov/images/154083/outbreak-of-fire-across-south-korea — now redirects to NASA Science. Sibling found through NASA WordPress search. The sibling publication is April 8, outside the study interval, but its April 4 image is within the interval.
- Both large JPEGs are saved (3,869,895 and 4,057,881 bytes). Caption text, dates, instrument labels, credit and image URLs are in `nasa_articles.json`.
- Terms: https://www.nasa.gov/nasa-brand-center/images-and-media/ — NASA educational/informational imagery use generally allowed with acknowledgment; third-party copyright/endorsement exceptions apply. No CC licence inferred.

## NASA GIBS

- https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ — four requested true-color layers × seven dates × two tile locations = **56/56** HTTP 200 JPEGs, valid 256×256 SOF dimensions and >2 KiB.
- All four layers pass on every day March 22–28: VIIRS_SNPP_CorrectedReflectance_TrueColor, VIIRS_NOAA20_CorrectedReflectance_TrueColor, MODIS_Terra_CorrectedReflectance_TrueColor, MODIS_Aqua_CorrectedReflectance_TrueColor.
- Requested zoom/row/column **8/98/219** spans 37.71859–38.82259 N, outside the bbox. Additional **8/100/219** spans 35.46067–36.59789 N and intersects the bbox. Thus **28/28** study-area tile tests pass. Neither tile samples the entire bbox.
- JPEG size is the requested blank-tile proxy; no full pixel/cloud mask is asserted. Availability does not mean cloud-free or smoke-free. JPEG cannot contain transparent pixels.
- Every tile and sidecar is retained; exact URLs/status/bytes are in `gibs_availability.json`. NASA usage guidelines apply with GIBS/instrument acknowledgment. API documentation: https://nasa-gibs.github.io/gibs-api-docs/access-basics/. An exploratory `/access-usage/` documentation URL returned 404 (`gibs_terms.blocked.md`); imagery access succeeded.

## Related perimeter and press findings

- GWIS `nrt.ba.poly` WFS rejects `application/json` but serves **GML2**. `gwis_wfs_gml.xml` contains 44 historical bbox features, **23** overlapping study dates. `web/public/data/intl_burned.json` retains dates and source areas and simplifies rings by ~50 m (53 KB).
- Product: **GWIS MODIS & VIIRS NRT**, thermal-anomaly perimeter estimates from MODIS **1 km** + VIIRS **375 m**. It is not MODIS 250 m or Sentinel-2 burn-scar mapping. Technical source: https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas. EU-owned content CC BY 4.0: https://gwis.jrc.ec.europa.eu/about-gwis/data-license. Acknowledge EU/JRC GWIS and indicate filtering/conversion/simplification.
- `gwis.globfire.finalperim` GetMap has a server/PostGIS error; its historic GlobFire product uses MCD64A1. The successful NRT TIME=2025-03-28 PNG is wholly transparent and is not usable mapped coverage. JSON GetFeatureInfo is unsupported.
- GDACS: 5 Korean search events; 2 inside bbox (1023633, 1023634), 6 episodes each. Supplied 1023626 is outside bbox and retained as context. Episode-specific impacts preserve POPAFFECTED population estimates; they are model estimates, not evacuation totals.
- All 7 GDELT requests returned HTTP 429, including the additional raw-volume mode needed for counts (normalized timelinevol percentages are not counts). No international peak can be compared; Korean peak verified from `news.json`: **2025-03-26 13:00 KST, t=7980, count=292**. Comparison remains null.
- ReliefWeb v1 returns 410 (decommissioned); v2 returns 403 (unapproved `firetrace-kr` appname). No key or registration requested. Reports stay unavailable rather than a claimed zero total.

Regenerate: `python3 scripts/fetch_international.py all`; `python3 scripts/summarize_international.py`; `python3 scripts/derive_international.py`. All successful and failed HTTP responses are cached in `data/raw/public_cache/`. Survey is offline-reproducible from those responses.
