"""Write an offline imagery survey and enrich international provenance sidecars.

Run after fetch_international.py; never makes HTTP requests.
"""
import hashlib
import html
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

from public_data_http import ROOT, utc_now, write_json
from fetch_international import RAW, sidecar


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ignore = 0
        self.bits = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.ignore += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignore -= 1

    def handle_data(self, data):
        if not self.ignore and data.strip():
            self.bits.append(data.strip())


def text(markup):
    parser = Text()
    parser.feed(markup)
    return ' '.join(parser.bits)


def combined_meta(paths, count, caveat):
    metas = [json.loads(Path(str(p) + '.meta.json').read_text()) for p in paths]
    return {'source_url': [m['source_url'] for m in metas],
            'source_files': [str(p.resolve().relative_to(ROOT)) for p in paths],
            'fetched_at_utc': max(m['fetched_at_utc'] for m in metas),
            'generated_at_utc': utc_now(), 'row_count': count,
            'licence_or_terms': [m.get('licence_or_terms') for m in metas], 'caveat': caveat}


def enrich():
    terms = {
        'gwis': ('CC BY 4.0 for EU-owned content; credit EU/JRC GWIS and identify modifications. Third-party rights excepted.',
                 'https://gwis.jrc.ec.europa.eu/about-gwis/data-license'),
        'gdacs': ('GDACS Disclaimer and Terms of Use: model estimates supplied as is, without warranty; no separate open-data licence stated on this page.',
                  'https://www.gdacs.org/About/termofuse.aspx'),
        'nasa': ('NASA Images and Media Usage Guidelines: educational/informational use generally permitted with NASA acknowledgement; third-party copyright and endorsement exceptions apply.',
                 'https://www.nasa.gov/nasa-brand-center/images-and-media/'),
        'gibs': ('NASA imagery usage guidelines; acknowledge NASA EOSDIS GIBS and the named imagery instrument; no blanket Creative Commons licence inferred.',
                 'https://www.nasa.gov/nasa-brand-center/images-and-media/'),
        'ems': ('CEMS On-Demand Mapping terms: free access, reproduction, distribution and adaptation subject to citation, restrictions and third-party rights.',
                'https://mapping.emergency.copernicus.eu/terms-and-conditions/'),
        'unosat': ('UNITAR Legal Notice: research/private study extracts and educational/non-commercial reuse with acknowledgment and source URL; substantial/commercial reuse requires authorization.',
                   'https://www.unitar.org/legal'),
        'maxar': ('CC-BY-NC-4.0 (STAC root license field); no Korean event tiles were found or downloaded.',
                  'https://maxar-opendata.s3.amazonaws.com/events/catalog.json'),
    }
    for path in RAW.iterdir():
        if path.name.endswith('.meta.json') or not path.is_file():
            continue
        mp = Path(str(path) + '.meta.json')
        if not mp.exists():
            raise ValueError(f'Missing sidecar: {path}')
        meta = json.loads(mp.read_text())
        meta.setdefault('caveat', 'Derived research index; missing values remain null. See the archived source responses and per-record URLs.')
        prefix = path.name.split('_')[0]
        if prefix in terms:
            meta['licence_or_terms'], meta['terms_source_url'] = terms[prefix]
        meta['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        if path.suffix == '.json':
            value = json.loads(path.read_text())
            if isinstance(value, list):
                meta['row_count'] = len(value)
            elif value.get('type') == 'Feature':
                meta['row_count'] = 1
            else:
                for key in ['features','results','articles','products','tests','timeline','data','links']:
                    if isinstance(value.get(key), list):
                        meta['row_count'] = len(value[key])
                        break
        elif path.name == 'gwis_wfs_gml.xml':
            meta['row_count'] = len(ET.parse(path).getroot().findall('{http://www.opengis.net/gml}featureMember'))
            meta['caveat'] = '44 bbox-intersecting historical features; date-filter locally. WFS JSON rejected, GML2 works. Coordinates EPSG:4326 lon/lat.'
        elif path.name == 'gwis_map_nrt_ba_poly.png':
            meta['caveat'] = 'Valid 1024x768 RGBA PNG, but all decompressed scanline bytes are zero: wholly transparent. No usable mapped perimeter in this TIME=2025-03-28 raster.'
        elif re.fullmatch(r'gdacs_\d+_episode_\d+\.json', path.name):
            meta['caveat'] = 'Dedicated getepisodedata response; episodeid verified against requested ID. Source fromdate/todate can be identical across episodes; geometry polygondate is the update timestamp.'
        elif re.fullmatch(r'gdacs_\d+_episode_\d+_impact_\d+\.json', path.name):
            meta['caveat'] = 'Episode-specific model impact. Derived affected_population uses explicit POPAFFECTED, not buffer population or official evacuation counts.'
        elif path.name == 'unosat_march2025.json':
            meta['caveat'] = 'Exploratory POST with empty region/activation_type arrays returned []; not interpreted as no maps. Corrected query omits empty filters.'
        elif path.name == 'unosat_march2025_all.json':
            meta['caveat'] = 'Search returned 36 products, including creation dates before requested March-April window; do not assume strict filtering on map created_at. No Korea match; country-specific query also returned [].'
        elif path.name == 'ems_march2025.json':
            meta['caveat'] = 'Exploratory activationTime filter was ignored: returned 100 of 1067 activations including 2026. Superseded by complete ems_all_activations.json and offline date/country filter.'
        write_json(mp, meta)


def nasa_articles():
    rows = []
    sources = [RAW / 'nasa_154083.html', RAW / 'nasa_154142.html']
    for path in sources:
        markup = path.read_text()
        body = markup.split('<article ', 1)[1].split('</article>', 1)[0]
        content = text(body)
        def meta(field):
            match = re.search(r'<meta\s+property="' + re.escape(field) + r'"\s+content="([^"]*)"', markup)
            return html.unescape(match.group(1)) if match else None
        urls = [html.unescape(url) for url in re.findall(r'<a[^>]+href="([^"]+)"', body)]
        images = list(dict.fromkeys(url for url in urls if re.search(r'\.(jpg|jpeg|png)(?:$|\?)', url, re.I) and
                                   ('154083' in url or '154142' in url or 'skoreaburnscar' in url)))
        paragraphs = [text(p) for p in re.findall(r'<p\b[^>]*class="[^"]*wp-block-paragraph[^"]*"[^>]*>(.*?)</p>', body, re.S)]
        instrument = content.split('Instruments:',1)[1].split('Topics:',1)[0].strip()
        rows.append({'title': meta('og:title').removesuffix(' - NASA Science'),
                     'published_at':meta('article:published_time'), 'url':meta('og:url'),
                     'instrument_as_labelled':instrument,
                     'instrument': 'Aqua / MODIS' if '154083' in path.name else 'Landsat 9 / OLI-2',
                     'acquisition_date':'2025-03-22' if '154083' in path.name else '2025-04-04',
                     'image_urls':images, 'caption_text':paragraphs,
                     'credit_text': next((p for p in paragraphs if 'NASA Earth Observatory image' in p), None),
                     'caveat': 'Article publication may fall outside study dates; the image acquisition is within them.'})
    path = RAW / 'nasa_articles.json'
    write_json(path, rows)
    write_json(Path(str(path) + '.meta.json'), combined_meta(sources,len(rows),'Article fields extracted from archived NASA HTML; image captions/credits retained.'))
    return rows


def survey(articles):
    ems = json.loads((RAW / 'ems_all_activations.json').read_text())
    maxar = json.loads((RAW / 'maxar_catalog.json').read_text())
    unosat = json.loads((RAW / 'unosat_korea.json').read_text())
    gibs = json.loads((RAW / 'gibs_availability.json').read_text())
    d_files = [p for p in RAW.iterdir() if not p.name.endswith('.meta.json') and
               p.name.split('_')[0] in ['ems','maxar','unosat','nasa','gibs']]
    d_metas = [json.loads(Path(str(p)+'.meta.json').read_text()) for p in d_files]
    times = [datetime.fromisoformat(m['fetched_at_utc']) for m in d_metas]
    first,last = min(times),max(times)
    findings = {'survey_started_utc':first.isoformat(),'survey_last_fetch_utc':last.isoformat(),
        'survey_elapsed_minutes':round((last-first).total_seconds()/60,2),'cap_minutes':25,
        'maxar': {'catalog_event_count':sum(l['rel']=='child' for l in maxar['links']),
                  'matching_release_found':False,'event_id':None,'dates':None,'tile_count':None,'licence':maxar.get('license')},
        'ems': {'total':ems['count'],'collected':len(ems['results']), 'next':ems['next'],
                'matching_activations': [r for r in ems['results'] if 'korea' in json.dumps(r).lower()]},
        'unosat': {'matching_products':unosat, 'caveat':'No match in the official country/date query; this is a search result, not proof of absence from every archive.'},
        'nasa':articles,
        'gibs':{'tested':len(gibs['tests']),'available':sum(r['available'] for r in gibs['tests']),
                'study_tile_available':sum(r['available'] and r['intersects_study_bbox'] for r in gibs['tests'])}}
    assert len(ems['results']) == ems['count'] and ems['next'] is None
    assert findings['survey_elapsed_minutes'] <= 25, 'Imagery survey exceeded 25-minute cap'
    path = RAW / 'imagery_findings.json'
    write_json(path, findings)
    source_paths = [RAW/n for n in ['maxar_catalog.json','ems_all_activations.json','unosat_korea.json','nasa_articles.json','gibs_availability.json']]
    metadata = combined_meta(source_paths,5,'Five-provider survey; negative searches are not assertions of universal absence.')
    write_json(Path(str(path)+'.meta.json'),metadata)
    lines = [
        '# International imagery survey — March 2025 Gyeongbuk wildfire', '',
        f'Survey requests: {first.isoformat()} to {last.isoformat()} ({findings["survey_elapsed_minutes"]} minutes; 25-minute cap). No credentials used. Every download ≤50 MB.',
        'Study bbox: 128.2,35.9,129.6,36.8. Study dates: 2025-03-21–2025-04-05 KST. Negative findings describe the queried catalogs only.', '',
        '## Maxar Open Data', '',
        '- https://www.maxar.com/open-data failed with the exact network error in `maxar_home.blocked.md`.',
        '- The accessible official STAC root https://maxar-opendata.s3.amazonaws.com/events/catalog.json lists **55** event collections. No Korea/Uiseong/Andong release appears in its child links.',
        '- Korean event id, dates and tile count: **null** (no matching release found); no imagery downloaded. Root licence: **CC-BY-NC-4.0**. The unavailable website prevents a universal absence claim.', '',
        '## Copernicus EMS Rapid Mapping', '',
        '- https://rapidmapping.emergency.copernicus.eu/ redirects to https://mapping.emergency.copernicus.eu/activations/. The frontend script identifies the public activation API.',
        '- https://mapping.emergency.copernicus.eu/activations/api/activations/?limit=2000&offset=0 returned **all 1,067** activations, `next: null`. No Korean activation is present, including March 2025. No matching EMSR code or products found.',
        '- Seven activations overlap March 1–April 5 by activationTime: EMSR792–EMSR798, in Spain, Mozambique, Italy, Ecuador, Bosnia-Herzegovina and Myanmar. The exploratory `activationTime` query did not filter correctly; the finding uses the complete catalog and local filtering.',
        '- Terms: https://mapping.emergency.copernicus.eu/terms-and-conditions/ — free access, reproduction/distribution/adaptation with citation; restricted and third-party information can have separate conditions.', '',
        '## UNOSAT / UNITAR', '',
        '- https://unosat.org/products/ is a JavaScript shell; its script calls the keyless `/our_products/` search API.',
        '- The GET catalog lists the country as `Korea (the Republic of)`. POST https://unosat.org/our_products/ with that region, 2025-03-01 through 2025-04-30, empty title, `is_active:false` (include closed), `is_charter:null` returned **[]**. No matching product/map URL found.',
        '- Broad search returned 36 records, some created before the date window; no Korea match. Empty filter arrays also produced a misleading empty response, so the final query omits unused filters. Raw request bodies are retained in sidecars/cache.',
        '- https://www.unitar.org/legal permits research/private-study extracts and educational/non-commercial reuse with acknowledgment and article URL; substantial/commercial reuse requires authorization. No map-specific open licence was found because no matching map was retrieved.', '',
        '## NASA Earth Observatory', '',
    ]
    for a in articles:
        lines += [f'- **{a["title"]}**: {a["url"]}',
                  f'  Published {a["published_at"]}; acquired {a["acquisition_date"]}; instrument **{a["instrument"]}**.',
                  '  Image URLs: ' + ', '.join(a['image_urls']),
                  '  Credit: ' + str(a['credit_text'])]
    lines += [
        '- Original requested URL: https://earthobservatory.nasa.gov/images/154083/outbreak-of-fire-across-south-korea — now redirects to NASA Science. Sibling found through NASA WordPress search. The sibling publication is April 8, outside the study interval, but its April 4 image is within the interval.',
        '- Both large JPEGs are saved (3,869,895 and 4,057,881 bytes). Caption text, dates, instrument labels, credit and image URLs are in `nasa_articles.json`.',
        '- Terms: https://www.nasa.gov/nasa-brand-center/images-and-media/ — NASA educational/informational imagery use generally allowed with acknowledgment; third-party copyright/endorsement exceptions apply. No CC licence inferred.', '',
        '## NASA GIBS', '',
        '- https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/ — four requested true-color layers × seven dates × two tile locations = **56/56** HTTP 200 JPEGs, valid 256×256 SOF dimensions and >2 KiB.',
        '- All four layers pass on every day March 22–28: VIIRS_SNPP_CorrectedReflectance_TrueColor, VIIRS_NOAA20_CorrectedReflectance_TrueColor, MODIS_Terra_CorrectedReflectance_TrueColor, MODIS_Aqua_CorrectedReflectance_TrueColor.',
        '- Requested zoom/row/column **8/98/219** spans 37.71859–38.82259 N, outside the bbox. Additional **8/100/219** spans 35.46067–36.59789 N and intersects the bbox. Thus **28/28** study-area tile tests pass. Neither tile samples the entire bbox.',
        '- JPEG size is the requested blank-tile proxy; no full pixel/cloud mask is asserted. Availability does not mean cloud-free or smoke-free. JPEG cannot contain transparent pixels.',
        '- Every tile and sidecar is retained; exact URLs/status/bytes are in `gibs_availability.json`. NASA usage guidelines apply with GIBS/instrument acknowledgment. API documentation: https://nasa-gibs.github.io/gibs-api-docs/access-basics/. An exploratory `/access-usage/` documentation URL returned 404 (`gibs_terms.blocked.md`); imagery access succeeded.', '',
        '## Related perimeter and press findings', '',
        '- GWIS `nrt.ba.poly` WFS rejects `application/json` but serves **GML2**. `gwis_wfs_gml.xml` contains 44 historical bbox features, **23** overlapping study dates. `web/public/data/intl_burned.json` retains dates and source areas and simplifies rings by ~50 m (53 KB).',
        '- Product: **GWIS MODIS & VIIRS NRT**, thermal-anomaly perimeter estimates from MODIS **1 km** + VIIRS **375 m**. It is not MODIS 250 m or Sentinel-2 burn-scar mapping. Technical source: https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas. EU-owned content CC BY 4.0: https://gwis.jrc.ec.europa.eu/about-gwis/data-license. Acknowledge EU/JRC GWIS and indicate filtering/conversion/simplification.',
        '- `gwis.globfire.finalperim` GetMap has a server/PostGIS error; its historic GlobFire product uses MCD64A1. The successful NRT TIME=2025-03-28 PNG is wholly transparent and is not usable mapped coverage. JSON GetFeatureInfo is unsupported.',
        '- GDACS: 5 Korean search events; 2 inside bbox (1023633, 1023634), 6 episodes each. Supplied 1023626 is outside bbox and retained as context. Episode-specific impacts preserve POPAFFECTED population estimates; they are model estimates, not evacuation totals.',
        '- All 7 GDELT requests returned HTTP 429, including the additional raw-volume mode needed for counts (normalized timelinevol percentages are not counts). No international peak can be compared; Korean peak verified from `news.json`: **2025-03-26 13:00 KST, t=7980, count=292**. Comparison remains null.',
        '- ReliefWeb v1 returns 410 (decommissioned); v2 returns 403 (unapproved `firetrace-kr` appname). No key or registration requested. Reports stay unavailable rather than a claimed zero total.', '',
        'Regenerate: `python3 scripts/fetch_international.py all`; `python3 scripts/summarize_international.py`; `python3 scripts/derive_international.py`. All successful and failed HTTP responses are cached in `data/raw/public_cache/`. Survey is offline-reproducible from those responses.',
    ]
    path = RAW / 'imagery_survey.md'
    path.write_text('\n'.join(lines)+'\n')
    write_json(Path(str(path)+'.meta.json'),metadata)


if __name__ == '__main__':
    enrich()
    articles = nasa_articles()
    survey(articles)
