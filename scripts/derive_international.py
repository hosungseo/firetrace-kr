"""Offline international evidence derivation; minutes since 2025-03-21T00:00+09:00.

Does not import derive.py, whose top-level code rewrites protected fire outputs.
Missing source totals stay null; empty arrays mean no records collected.
"""
import collections
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

from public_data_http import ROOT, utc_now, write_json

RAW = ROOT / 'data/raw/intl'
OUT = ROOT / 'web/public/data'
KST = timezone(timedelta(hours=9))
T0 = datetime(2025, 3, 21, tzinfo=KST)


def load(name):
    path = RAW / name
    return json.loads(path.read_text()) if path.exists() else None


def files(pattern):
    return sorted(p for p in RAW.glob(pattern) if not p.name.endswith('.meta.json'))


def population(value):
    """Keep the explicit model POPAFFECTED scalar; never infer it from buffers."""
    if isinstance(value, dict):
        if value.get('name') == 'POPAFFECTED':
            try:
                return int(value['value'])
            except (TypeError, ValueError):
                return None
        for child in value.values():
            result = population(child)
            if result is not None:
                return result
    elif isinstance(value, list):
        for child in value:
            result = population(child)
            if result is not None:
                return result
    return None


def timestamp(value):
    if not value:
        return None
    if len(value) == 16 and value.endswith('Z'):
        return datetime.strptime(value, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    if len(value) == 15 and value.endswith('Z'):
        return datetime.strptime(value, '%Y%m%d%H%M%SZ').replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def minutes(value):
    dt = timestamp(value)
    return round((dt - T0).total_seconds() / 60) if dt else None


def output(name, value, sources, count, caveats):
    path = OUT / name
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    metas = [json.loads(Path(str(p) + '.meta.json').read_text()) for p in sources
             if Path(str(p) + '.meta.json').exists()]
    write_json(Path(str(path) + '.meta.json'), {
        'source_files': [str(p.relative_to(ROOT)) for p in sources],
        'source_url': [m['source_url'] for m in metas],
        'fetched_at_utc': [m['fetched_at_utc'] for m in metas],
        'derived_at_utc': utc_now(), 't0': T0.isoformat(),
        'licence_or_terms': [m.get('licence_or_terms') for m in metas],
        'row_count': count, 'caveats': caveats,
    })


def news():
    sources = files('gdelt_*.json') + files('reliefweb_reports*.json')
    articles = {}
    for path in files('gdelt_articles_*.json'):
        for article in (json.loads(path.read_text()).get('articles') or []):
            url = article.get('url')
            if url and url not in articles:
                articles[url] = article
    rows = [[minutes(a.get('seendate')), a.get('title'), a.get('domain'),
             a.get('sourcecountry'), a.get('language'), a['url']]
            for a in articles.values()]
    rows.sort(key=lambda r: (r[0] is None, r[0] or 0, r[-1]))
    countries = collections.Counter(r[3] for r in rows if r[3] is not None)
    # timelinevol is a percentage, not a count. Only timelinevolraw may supply counts.
    raw = load('gdelt_volume_raw.json') or {}
    daily = collections.defaultdict(float)
    timeline_ok = isinstance(raw.get('timeline'), list)
    if timeline_ok:
        for series in raw['timeline']:
            for point in series.get('data', []):
                dt = timestamp(point.get('date'))
                if dt is not None and point.get('value') is not None:
                    day = dt.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
                    daily[round((day - T0).total_seconds()/60)] += point['value']
    daily_rows = [[t, int(c) if c.is_integer() else c] for t,c in sorted(daily.items())]
    rw = load('reliefweb_reports_v2.json') or load('reliefweb_reports.json') or {}
    reports = []
    for report in rw.get('data') or []:
        f = report.get('fields') or {}
        reports.append({'id': report.get('id'), 't_minutes': minutes((f.get('date') or {}).get('created')),
                        'title': f.get('title'), 'date': f.get('date'),
                        'source': f.get('source'), 'url': f.get('url')})
    reports.sort(key=lambda r: (r['t_minutes'] is None, r['t_minutes'] or 0))
    korean = json.loads((OUT / 'news.json').read_text())
    kr_peak = max(korean['hourly'], key=lambda r:r[1])
    peak = max(daily_rows, key=lambda r:r[1])[0] if daily_rows else None
    meta = {'t0': T0.isoformat(), 'complete': False,
            'article_count_collected': len(rows), 'article_total': None,
            'daily_counts_available': timeline_ok,
            'by_country_basis': 'URL-deduplicated collected artlist sample; not total national coverage.',
            'gdelt_time_window_utc': ['2025-03-21T00:00:00Z','2025-04-05T00:00:00Z'],
            'korean_peak_t_minutes': kr_peak[0], 'korean_peak_count': kr_peak[1],
            'korean_peak_kst': (T0 + timedelta(minutes=kr_peak[0])).isoformat(),
            'international_peak_day_t_minutes': peak,
            'peak_same_kst_day': peak == (kr_peak[0] // 1440)*1440 if peak is not None else None,
            'reports_total': rw.get('totalCount'), 'reports_available': isinstance(rw.get('data'), list),
            'caveats': ['No comparison is possible when GDELT requests are blocked.',
                        'GDELT seendate is first indexed time, not necessarily publication time.',
                        'Artlist is capped at 250 per query; no exhaustive article count inferred.',
                        'Raw timeline bins are assigned to their KST start day; UTC daily bins cannot resolve KST daily totals exactly.']}
    value = {'daily': daily_rows, 'by_country': sorted(countries.items(),key=lambda r:(-r[1],r[0])),
             'articles': rows, 'reports': reports, 'meta': meta}
    output('intl_news.json', value, sources, len(rows), meta['caveats'])


def gdacs():
    search = load('gdacs_search.json') or {}
    features = search.get('features') or []
    included = {f['properties']['eventid']: f for f in features
                if 128.2 <= f['geometry']['coordinates'][0] <= 129.6 and
                   35.9 <= f['geometry']['coordinates'][1] <= 36.8}
    episodes = []
    for event, feature in included.items():
        for path in files(f'gdacs_{event}_episode_*.json'):
            if not re.fullmatch(r'gdacs_\d+_episode_\d+\.json', path.name):
                continue
            raw = json.loads(path.read_text())
            candidates = raw.get('features') or ([raw] if 'properties' in raw else [])
            for f in candidates:
                p = f.get('properties') or {}
                if not p.get('eventid'):
                    continue
                ep = p.get('episodeid')
                assert ep == int(path.stem.rsplit('_', 1)[1]), 'Episode endpoint ignored episodeid'
                geometry_file = f'gdacs_{event}_geometry_{ep}.json'
                geometry = load(geometry_file) or {}
                polygon_dates = [f.get('properties', {}).get('polygondate') for f in geometry.get('features', [])
                                 if (f.get('geometry') or {}).get('type') in ('Polygon','MultiPolygon')]
                polygon_date = next((v for v in polygon_dates if v), None)
                impact = load(f'gdacs_{event}_episode_{ep}_impact_0.json')
                episodes.append({'eventid': event, 'episodeid': ep,
                    't_minutes': minutes(polygon_date or p.get('todate')), 'fromdate': p.get('fromdate'),
                    'todate': p.get('todate'), 'alert_level': p.get('episodealertlevel') or p.get('alertlevel'),
                    'text': p.get('htmldescription') or p.get('description'),
                    'polygon_date': polygon_date, 'affected_population': population(impact),
                    'severity': p.get('severitydata'),
                    'geometry_file': 'data/raw/intl/' + geometry_file if (RAW / geometry_file).exists() else None,
                    'source_properties': p})
    episodes.sort(key=lambda r: (r['t_minutes'] is None, r['t_minutes'] or 0, r['eventid'],r['episodeid']))
    meta = {'t0': T0.isoformat(), 'bbox': [128.2,35.9,129.6,36.8], 'event_ids': sorted(included),
            'context_event_outside_bbox': 1023626, 'complete': len(episodes) == sum(f['properties']['episodeid'] for f in included.values()),
            'time_convention': 'Timezone-less GDACS ISO dates interpreted as UTC; t_minutes uses polygondate (product update timestamp), falling back to episode todate. All episodes retain source fromdate/todate; April 1 revisions remain in the requested period.',
            'caveats': ['Source estimated burned areas and alert levels are not official Korean damage totals.',
                        'Missing population remains null; polygons are preserved in raw geometry files.']}
    output('intl_gdacs.json', {'episodes': episodes, 'meta': meta}, files('gdacs_*.json'), len(episodes), [meta['time_convention']] + meta['caveats'])


def burned():
    from fetch_admin import simplify
    ns = {'g': 'http://www.opengis.net/gml', 'm': 'http://mapserver.gis.umn.edu/mapserver'}
    features = []
    sources = [RAW / 'gwis_wfs_gml.xml', RAW / 'gwis_capabilities.xml',
               RAW / 'gwis_burnt_technical.html', RAW / 'gwis_license.html']
    gml = RAW / 'gwis_wfs_gml.xml'
    if gml.exists():
        tree = ET.parse(gml).getroot()
        for member in tree.findall('g:featureMember', ns):
            source = list(member)[0]
            p = {c.tag.split('}')[-1]: c.text for c in source if len(c) == 0}
            start, end = timestamp(p.get('initialdate')), timestamp(p.get('finaldate'))
            if start is None or end is None or start >= datetime(2025,4,6,tzinfo=KST) or end < T0:
                continue
            polygons = []
            for poly in source.findall('.//g:Polygon', ns):
                rings = []
                for boundary in ['outerBoundaryIs','innerBoundaryIs']:
                    for el in poly.findall('g:' + boundary + '/g:LinearRing/g:coordinates', ns):
                        ring = [[float(v) for v in pos.split(',')[:2]] for pos in (el.text or '').split()]
                        if ring:
                            rings.append(ring)
                if rings:
                    polygons.append(rings)
            if not polygons:
                continue
            geom = {'type':'MultiPolygon', 'coordinates':polygons}
            props = {'id':p.get('id'), 'fire_id':p.get('fire_id'),
                     'initialdate':p.get('initialdate'), 'finaldate':p.get('finaldate'),
                     't_start_minutes': minutes(p.get('initialdate')), 't_end_minutes':minutes(p.get('finaldate')),
                     'source_area_ha': float(p['area']) if p.get('area') else None,
                     'layer':'nrt.ba.poly', 'product':'GWIS MODIS & VIIRS NRT thermal-anomaly perimeter estimate'}
            features.append({'type':'Feature','id':p.get('id'),'properties':props,'geometry':simplify(geom)})
    features.sort(key=lambda f:(f['properties']['t_start_minutes'], f['id']))
    meta = {'t0': T0.isoformat(), 'complete': False, 'mapped_polygon_count': len(features),
            'bbox': [128.2,35.9,129.6,36.8], 'total_burned_area_ha': None, 'layer': 'nrt.ba.poly',
            'product': 'GWIS MODIS & VIIRS NRT thermal-anomaly perimeter estimate',
            'input_pixel_sizes_m': {'MODIS_active_fire':1000,'VIIRS_active_fire':375},
            'simplification_m':50, 'licence':'CC BY 4.0; European Union / JRC GWIS; changes: bbox/date filter, GML-to-GeoJSON conversion, ~50 m simplification.',
            'caveats': ['GML2 WFS works; application/json is not an allowed WFS output format.',
                'These are estimated perimeters from MODIS 1 km + VIIRS 375 m thermal anomalies, not MODIS 250 m burn-scar classification or Sentinel-2 mapping.',
                'All bbox-intersecting areas overlapping 2025-03-21 through April 5 KST are retained, including smaller nearby fires; not assigned to a single ignition.',
                'Source dates lack timezone; UTC assumed. Source dates may be uncertain by days.',
                'Source area is not recalculated after simplification; overlapping features must not be summed as a unique burned total.',
                'Independent ring simplification does not guarantee inter-feature topology. WFS maxFeatures=5000; response has 44 historical areas, filtered locally.']}
    output('intl_burned.json', {'type': 'FeatureCollection','features': features,'meta': meta}, sources, len(features), meta['caveats'])
    if (OUT / 'intl_burned.json').stat().st_size > 300_000:
        raise ValueError('Burned output exceeds 300 KB: simplify actual polygons before publication.')


if __name__ == '__main__':
    news()
    gdacs()
    burned()
