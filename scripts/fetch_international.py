"""Keyless international wildfire evidence. All HTTP uses public_data_http.

Run a group (gdelt, gdacs, gwis, imagery, gibs, reliefweb) or all.
Additional discovered endpoints can be archived with: request NAME URL [EXT].
Files <= 50 MB; failures retain exact response bytes and a blocked note.
"""
import argparse
import json
import re
import time
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode

from public_data_http import ROOT, fetch, utc_now, write_json

RAW = ROOT / 'data/raw/intl'
BBOX = '128.2,35.9,129.6,36.8'
TERMS = {
    'gdelt': 'GDELT public API; underlying article text/images remain with their publishers. No article reuse licence inferred.',
    'gdacs': None, 'gwis': None, 'nasa': None, 'gibs': None,
    'maxar': 'CC-BY-NC-4.0 (STAC catalog license field).',
    'reliefweb': None,
}


def sidecar(path, meta, count=None, caveat=None):
    m = dict(meta)
    m['row_count'] = count
    if caveat:
        m['caveat'] = caveat
    write_json(Path(str(path) + '.meta.json'), m)


def blocked(name, data, meta, reason):
    p = RAW / (name + '.blocked.md')
    p.write_text(f'# {name}: unavailable\n\n{reason}\n\nURL: {meta["source_url"]}\n'
                 f'HTTP status: {meta["http_status"]}\n\nVerbatim response/error:\n\n```text\n'
                 + data.decode('utf-8', errors='replace') + '\n```\n')
    sidecar(p, meta, None, reason)


def request(name, url, ext='json', terms=None, *, body=None):
    prefix = name.split('_')[0]
    data, meta = fetch(url, body, terms=terms or TERMS.get(prefix), max_bytes=50_000_000,
                       min_interval=6 if prefix == 'gdelt' else 0.6,
                       max_attempts=1, timeout=30)
    path = RAW / (name + '.' + ext)
    path.parent.mkdir(parents=True, exist_ok=True)
    parsed = None
    error = None
    if meta['http_status'] != 200:
        error = f'HTTP {meta["http_status"]}; see exact response below.'
    elif ext == 'json':
        try:
            parsed = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            error = 'Expected JSON; source returned a non-JSON response.'
    elif ext == 'xml' and b'ServiceException' in data:
        error = 'OGC service exception; see exact response below.'
    elif ext == 'png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        error = 'Expected PNG; source returned an OGC exception or other non-PNG response.'
    if ext == 'json' and parsed is None:
        # Preserve the response verbatim as text; JSON explicitly records missing data.
        response = RAW / (name + '.response.txt')
        response.write_bytes(data)
        sidecar(response, meta)
        write_json(path, {'data': None, 'error': error, 'response_file': response.name})
    else:
        path.write_bytes(data)
    count = None
    if isinstance(parsed, list):
        count = len(parsed)
    elif isinstance(parsed, dict):
        for key in ('features', 'articles', 'data', 'timeline', 'links', 'results', 'products'):
            if isinstance(parsed.get(key), list):
                count = len(parsed[key])
                break
        if parsed.get('type') == 'Feature':
            count = 1
    sidecar(path, meta, count)
    if error:
        blocked(name, data, meta, error)
    print(name, meta['http_status'], len(data), 'BLOCKED' if error else '', flush=True)
    return parsed, data, meta


def gdelt():
    base = 'https://api.gdeltproject.org/api/v2/doc/doc?'
    common = dict(startdatetime='20250321000000', enddatetime='20250405000000', format='json')
    queries = [('volume', 'timelinevol', '"South Korea" wildfire'),
               ('countries', 'timelinesourcecountry', '"South Korea" wildfire'),
               ('articles_en', 'artlist', '"South Korea" wildfire'),
               ('articles_localities', 'artlist', '(Uiseong OR Andong) fire'),
               ('articles_ja', 'artlist', '韓国 山火事'),
               ('articles_zh', 'artlist', '韩国 山火'),
               ('volume_raw', 'timelinevolraw', '"South Korea" wildfire')]
    for name, mode, query in queries:
        params = dict(common, mode=mode, query=query)
        if mode == 'artlist':
            params.update(maxrecords=250, sort='datedesc')
        request('gdelt_' + name, base + urlencode(params))
        # Enforce six seconds even when the next call reuses the on-disk cache.
        if name != queries[-1][0]:
            time.sleep(6)


def gdacs():
    base = 'https://www.gdacs.org/gdacsapi/api/'
    search, _, _ = request('gdacs_search', base + 'events/geteventlist/SEARCH?eventlist=WF&fromDate=2025-03-20&toDate=2025-04-05&alertlevel=Green;Orange;Red&country=Korea')
    if not search or 'features' not in search:
        return
    # The supplied 1023626 is outside the bbox. Preserve it as context, plus both local events.
    selected = [f for f in search['features'] if f['properties']['eventid'] == 1023626 or
                (128.2 <= f['geometry']['coordinates'][0] <= 129.6 and
                 35.9 <= f['geometry']['coordinates'][1] <= 36.8)]
    for feature in selected:
        prop = feature['properties']
        event = prop['eventid']
        detail, _, _ = request(f'gdacs_{event}_detail', prop['url']['details'])
        for episode in range(1, int(prop['episodeid']) + 1):
            query = urlencode(dict(eventtype='WF', eventid=event, episodeid=episode))
            endpoint = (detail or {}).get('properties', {}).get('episodes', [])[episode - 1]['details']
            episode_data, _, _ = request(f'gdacs_{event}_episode_{episode}', endpoint)
            request(f'gdacs_{event}_geometry_{episode}', base + 'polygons/getgeometry?' + query)
            for i, impact in enumerate((episode_data or {}).get('properties', {}).get('impacts') or []):
                request(f'gdacs_{event}_episode_{episode}_impact_{i}', impact['resource']['impact'])


def gwis():
    base = 'https://maps.effis.emergency.copernicus.eu/gwis?'
    _, raw, _ = request('gwis_capabilities', base + 'service=WMS&request=GetCapabilities&version=1.1.1', 'xml')
    tree = ET.fromstring(raw)
    layers = []
    for layer in tree.iter('Layer'):
        name = layer.findtext('Name')
        if name and re.search(r'burn|fire|\.ba|poly', name + ' ' + str(layer.findtext('Abstract')), re.I):
            layers.append({'name': name, 'title': layer.findtext('Title'),
                           'abstract': layer.findtext('Abstract'), 'time_extent': layer.findtext('Extent'),
                           'queryable': layer.get('queryable')})
    write_json(RAW / 'gwis_layers.json', layers)
    sidecar(RAW / 'gwis_layers.json', json.loads((RAW / 'gwis_capabilities.xml.meta.json').read_text()), len(layers))
    request('gwis_wfs_capabilities', base + 'service=WFS&request=GetCapabilities', 'xml')
    for layer in ['nrt.ba.poly', 'gwis.globfire.finalperim']:
        p = dict(service='WFS', version='1.0.0', request='GetFeature', typeName=layer,
                 outputFormat='application/json', bbox=BBOX, srsName='EPSG:4326',
                 TIME='2025-03-21/2025-04-05')
        request('gwis_wfs_' + layer.replace('.', '_'), base + urlencode(p))
    for layer in ['nrt.ba.poly', 'gwis.globfire.finalperim']:
        p = dict(service='WMS', version='1.1.1', request='GetMap', layers=layer, styles='',
                 format='image/png', transparent='TRUE', width=1024, height=768,
                 bbox=BBOX, srs='EPSG:4326', TIME='2025-03-28')
        request('gwis_map_' + layer.replace('.', '_'), base + urlencode(p), 'png')
        p.update(request='GetFeatureInfo', query_layers=layer, info_format='application/json',
                 x=490, y=350, feature_count=100)
        request('gwis_info_' + layer.replace('.', '_'), base + urlencode(p))
    request('gwis_wfs_schema', base + urlencode(dict(service='WFS', version='1.0.0',
            request='DescribeFeatureType', typeName='nrt.ba.poly')), 'xml')
    request('gwis_wfs_gml', base + urlencode(dict(service='WFS', version='1.0.0',
            request='GetFeature', typeName='nrt.ba.poly', outputFormat='GML2', bbox=BBOX,
            srsName='EPSG:4326', maxFeatures=5000)), 'xml')
    request('gwis_burnt_technical', 'https://gwis.jrc.ec.europa.eu/about-gwis/technical-background/burnt-areas', 'html')
    request('gwis_license', 'https://gwis.jrc.ec.europa.eu/about-gwis/data-license', 'html')


def imagery():
    deadline = time.monotonic() + 25 * 60
    endpoints = [
        ('maxar_catalog', 'https://maxar-opendata.s3.amazonaws.com/events/catalog.json', 'json'),
        ('maxar_home', 'https://www.maxar.com/open-data', 'html'),
        ('ems_home', 'https://rapidmapping.emergency.copernicus.eu/', 'html'),
        ('unosat_home', 'https://unosat.org/products/', 'html'),
        ('nasa_154083', 'https://earthobservatory.nasa.gov/images/154083/outbreak-of-fire-across-south-korea', 'html'),
        ('ems_app', 'https://cems-mapping-website.s3.amazonaws.com/static/datastats/assets/main-B_pdTgP9.js', 'js'),
        ('ems_all_activations', 'https://mapping.emergency.copernicus.eu/activations/api/activations/?limit=2000&offset=0', 'json'),
        ('ems_korea', 'https://mapping.emergency.copernicus.eu/activations/api/activations/?q=Korea&limit=100&offset=0', 'json'),
        ('ems_terms', 'https://mapping.emergency.copernicus.eu/terms-and-conditions/', 'html'),
        ('unosat_app', 'https://unosat.org/static/js/main.66fefde9.chunk.js', 'js'),
        ('unosat_products', 'https://unosat.org/our_products', 'json'),
        ('unosat_terms', 'https://www.unitar.org/legal', 'html'),
        ('nasa_search', 'https://science.nasa.gov/wp-json/wp/v2/search?search=Korea&per_page=100', 'json'),
        ('nasa_154142', 'https://science.nasa.gov/earth/earth-observatory/south-korea-charred-by-fire-154142/', 'html'),
        ('nasa_154083_image', 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154083/southkoreafires_amo_20250322_lrg.jpg', 'jpg'),
        ('nasa_154142_image', 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/154000/154142/skoreaburnscar_oli2_20250404_lrg.jpg', 'jpg'),
        ('nasa_terms', 'https://www.nasa.gov/nasa-brand-center/images-and-media/', 'html'),
        ('gibs_usage', 'https://nasa-gibs.github.io/gibs-api-docs/access-basics/', 'html'),
    ]
    for name, url, ext in endpoints:
        if time.monotonic() >= deadline:
            break
        request(name, url, ext)
    if time.monotonic() < deadline:
        request('unosat_korea', 'https://unosat.org/our_products/', body={
            'region':['Korea (the Republic of)'], 'date_from':'2025-03-01',
            'date_to':'2025-04-30', 'title':'', 'is_active':False,'is_charter':None})


def gibs():
    layers = ['VIIRS_SNPP_CorrectedReflectance_TrueColor',
              'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
              'MODIS_Terra_CorrectedReflectance_TrueColor',
              'MODIS_Aqua_CorrectedReflectance_TrueColor']
    rows = []
    # Requested row 98 is north of the study area; row 100 intersects the bbox.
    for layer in layers:
        for day in range(7):
            dt = str(date(2025, 3, 22) + timedelta(days=day))
            for tile_row in [98, 100]:
                url = f'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{dt}/GoogleMapsCompatible_Level9/8/{tile_row}/219.jpg'
                data, meta = fetch(url, max_bytes=50_000_000, max_attempts=1, timeout=25)
                name = f'gibs_{layer}_{dt}_8_{tile_row}_219.jpg'
                path = RAW / name
                path.write_bytes(data)
                is_jpeg = data[:3] == b'\xff\xd8\xff'
                nonblank = None
                size = None
                if is_jpeg:
                    # JPEG SOF dimensions, without third-party image libraries.
                    pos = 2
                    while pos + 9 < len(data):
                        if data[pos] != 255:
                            break
                        marker = data[pos + 1]
                        length = int.from_bytes(data[pos + 2:pos + 4], 'big')
                        if marker in (192, 193, 194):
                            size = [int.from_bytes(data[pos + 7:pos + 9], 'big'),
                                    int.from_bytes(data[pos + 5:pos + 7], 'big')]
                            break
                        if length < 2:
                            break
                        pos += length + 2
                    # Requested >2 KiB test is a blank-tile proxy, not a pixel/cloud mask.
                    nonblank = len(data) > 2048 and size == [256, 256]
                available = meta['http_status'] == 200 and is_jpeg and len(data) > 2048 and nonblank is True
                row = dict(layer=layer, date=dt, zoom=8, row=tile_row, col=219, url=url,
                           http_status=meta['http_status'], bytes=len(data), jpeg=is_jpeg,
                           dimensions=size, nonblank=nonblank, available=available,
                           intersects_study_bbox=tile_row == 100)
                rows.append(row)
                sidecar(path, meta, None, 'One WMTS tile; availability does not establish cloud-free coverage. See gibs_availability.json.')
                if meta['http_status'] != 200:
                    blocked(name, data, meta, 'WMTS tile request failed.')
                print('GIBS', layer, dt, tile_row, available, len(data), flush=True)
    path = RAW / 'gibs_availability.json'
    write_json(path, {'bbox': [128.2,35.9,129.6,36.8], 'tests': rows,
                      'caveat': 'Requested tile row 98 covers 37.71859–38.82259 N, outside study bbox. Added row 100 (35.46067–36.59789 N). Tiles sample part of bbox, not full coverage; nonblank uses the requested JPEG > 2 KiB proxy plus SOF dimensions, not a decoded pixel/cloud mask.'})
    sidecar(path, {'source_url': [r['url'] for r in rows], 'fetched_at_utc': utc_now(),
                   'licence_or_terms': None}, len(rows))


def reliefweb():
    p = [('appname', 'firetrace-kr'), ('query[value]', 'Korea wildfire'),
         ('filter[field]', 'date.created'), ('filter[value][from]', '2025-03-21T00:00:00+00:00'),
         ('filter[value][to]', '2025-04-30T00:00:00+00:00')]
    p += [('fields[include][]', k) for k in ['title', 'date', 'source', 'url']]
    p += [('limit', 50)]
    request('reliefweb_reports', 'https://api.reliefweb.int/v1/reports?' + urlencode(p))
    request('reliefweb_reports_v2', 'https://api.reliefweb.int/v2/reports?' + urlencode(p))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('group', choices=['gdelt','gdacs','gwis','imagery','gibs','reliefweb','all','request'])
    ap.add_argument('extra', nargs='*')
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if args.group == 'request':
        request(*args.extra)
    else:
        for group in (['gdelt','gdacs','gwis','imagery','gibs','reliefweb'] if args.group == 'all' else [args.group]):
            globals()[group]()
