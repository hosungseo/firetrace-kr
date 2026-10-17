"""Incident registry, paths, geometry and secret-safe disk HTTP (stdlib only)."""
import argparse
import fcntl
import hashlib
import json
import math
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from public_data_http import ROOT, utc_now, write_json

KST = timezone(timedelta(hours=9))
RAW = ROOT / 'data/raw'
PUBLIC = ROOT / 'web/public/data'
REGISTRY = PUBLIC / 'incidents.json'
DEFAULT = 'uiseong-2025'
SIDO = {'경남': '경상남도', '경북': '경상북도', '충남': '충청남도',
        '전남': '전라남도', '강원': '강원특별자치도', '대구': '대구광역시',
        '울산': '울산광역시', '대전': '대전광역시'}
# Legal-dong seeds in a national administrative-dong snapshot. These proxies are
# explicit in each incident's registry_build.json; they are not legal polygons.
IGNITION_ADMIN = {'gangneung-2023': '경포동', 'daegu-2025': '관문동'}
IGNITION_ADMIN_SOURCES = {
    'gangneung-2023': 'https://www.gn.go.kr/www/selectBbsNttView.do?key=699&bbsNo=81&nttNo=495',
    'daegu-2025': 'https://www.buk.daegu.kr/dong/index.do?menu_id=00000407',
}

def seeds():
    return json.loads((ROOT / 'data/incidents.seed.json').read_text())['incidents']


def t0(inc):
    return datetime.combine(date.fromisoformat(inc['start']) - timedelta(days=1),
                            datetime.min.time(), KST)


def display_days(inc):
    return max(3, min(10, inc.get('display_days', (date.fromisoformat(inc['end']) - t0(inc).date()).days + 1)))


def load(ident=DEFAULT):
    seed = next((i for i in seeds() if i['id'] == ident), None)
    if seed is None:
        raise ValueError(f'Unknown incident: {ident}')
    derived = next((i for i in json.loads(REGISTRY.read_text())['incidents'] if i['id'] == ident), {}) if REGISTRY.exists() else {}
    return {**seed, **derived, 'kfs': seed.get('kfs', []), 'ignition_emd': seed['ignition_emd']}


def cli(description=None):
    p = argparse.ArgumentParser(description=description)
    p.add_argument('--incident', default=DEFAULT, choices=[i['id'] for i in seeds()])
    return load(p.parse_args().incident)


def raw_dir(inc):
    p = RAW / inc['id']; p.mkdir(parents=True, exist_ok=True)
    return p


def out_dir(inc):
    p = PUBLIC / inc['id']; p.mkdir(parents=True, exist_ok=True)
    return p


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def compact(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text=json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',dir=path.parent,prefix='.'+path.name+'-',suffix='.tmp',delete=False) as handle:
        handle.write(text)
        temporary=handle.name
    os.replace(temporary,path)


def weather_end(inc):
    return (t0(inc) + timedelta(days=display_days(inc) + 1)).date()


def hours(inc):
    # Inclusive endpoint: t0 through t0 + display_days + one buffer day.
    return list(range(0, (display_days(inc) + 1) * 1440 + 1, 60))


def grid(inc):
    w,s,e,n = inc['bbox']
    lons = [round(w + i * .1, 5) for i in range(math.floor((e-w)/.1 + 1e-7)+1)]
    lats = [round(s + i * .1, 5) for i in range(math.floor((n-s)/.1 + 1e-7)+1)]
    pts = [(lat,lon) for lat in lats for lon in lons]
    # Keep a spatially distributed subset of the 0.1-degree lattice when capped.
    if len(pts) > 120:
        pts = [pts[round(i * (len(pts)-1)/119)] for i in range(120)]
    return pts


def distance(a, b):
    x,y = map(math.radians,a); xx,yy = map(math.radians,b)
    v = math.sin((yy-y)/2)**2 + math.cos(y)*math.cos(yy)*math.sin((xx-x)/2)**2
    return 12742 * math.asin(min(1, math.sqrt(v)))


def polygons(geom):
    return [geom['coordinates']] if geom['type']=='Polygon' else geom['coordinates']


def centroid(geom):
    total, cx, cy = 0., 0., 0.
    for poly in polygons(geom):
        for index,ring in enumerate(poly):
            a = sx = sy = 0.
            for (x,y),(xx,yy) in zip(ring,ring[1:]):
                cross=x*yy-xx*y; a+=cross; sx+=(x+xx)*cross; sy+=(y+yy)*cross
            if abs(a) < 1e-12: continue
            weight=abs(a) * (1 if index==0 else -1)
            total+=weight; cx+=sx/(3*a)*weight; cy+=sy/(3*a)*weight
    if total<=0: raise ValueError('Degenerate ignition polygon')
    return [cx/total, cy/total]


@lru_cache(maxsize=1)
def national():
    from fetch_admin import SOURCE, TERMS
    from public_data_http import fetch_json
    return fetch_json(SOURCE, terms=TERMS)[0]


def region_features(seed):
    all_features=national()['features']; codes=[]
    for name in seed['sigungu']:
        province = '대전광역시' if seed['id']=='geumsan-2023' and name=='서구' else SIDO.get(seed['sido'],seed['sido'])
        matches={f['properties']['sgg'] for f in all_features
                 if f['properties']['sidonm']==province and f['properties']['sggnm']==name}
        if len(matches)!=1: raise ValueError(f'Non-unique region {province} {name}: {sorted(matches)}')
        codes.append(matches.pop())
    return codes,[f for f in all_features if f['properties']['sgg'] in codes]


def ignition(seed, features):
    name=IGNITION_ADMIN.get(seed['id'],seed['ignition_emd'])
    matches=[f for f in features if f['properties']['sggnm']==seed['sigungu'][0]
             and f['properties']['adm_nm'].split()[-1]==name]
    if len(matches)!=1: raise ValueError(f'Ignition polygon not found: {name}')
    return centroid(matches[0]['geometry']), matches[0]['properties']


def blocked(inc, source, reason):
    p=raw_dir(inc)/(source+'.blocked.md')
    p.write_text(f'# {source}: unavailable or partial\n\nIncident: {inc["id"]}\n\n{reason}\n\nMissing retrieval is not evidence of zero observations. Responses are retained in this incident’s http_cache/.\n')


def clear_blocked(inc, source):
    (raw_dir(inc)/(source+'.blocked.md')).unlink(missing_ok=True)


def secret(name):
    return (Path.home()/'.openclaw/secrets'/name).read_text().strip()


class SourceError(RuntimeError):
    pass


def cached_request(inc, source, url, *, headers=None, cache_id=None, interval=.4, timeout=45, secrets=()):
    """Credentials exist in memory only. URLs/errors are sanitized before storage.

    Both successes and failures are cached. A shared timestamp enforces rate limits
    across sequential scripts/incidents; build_all never runs providers in parallel.
    """
    cache=raw_dir(inc)/'http_cache';cache.mkdir(exist_ok=True)
    clean=url
    for value in secrets:
        if value:
            clean=clean.replace(value,'[REDACTED]').replace(urllib.parse.quote(value,safe=''),'[REDACTED]')
    key=hashlib.sha256((source+'\0'+(cache_id or clean)).encode()).hexdigest()
    bp=cache/(key+'.body');mp=cache/(key+'.meta.json')
    if bp.exists() and mp.exists():
        m=read(mp); data=bp.read_bytes()
    else:
        throttle=RAW/('.rate-'+source+'.json')
        with (RAW/('.rate-'+source+'.lock')).open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            last=read(throttle,{}).get('time',0)
            time.sleep(max(0, interval-(time.time()-last)))
            write_json(throttle,{'time':time.time()})
            fcntl.flock(lock, fcntl.LOCK_UN)
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=headers or {}),timeout=timeout) as res:
                data=res.read();status=res.status
        except urllib.error.HTTPError as exc:
            data=exc.read();status=exc.code
        except Exception as exc:
            data=type(exc).__name__.encode();status=None
        for value in secrets:
            if value:
                data=data.replace(value.encode(),b'[REDACTED]').replace(urllib.parse.quote(value,safe='').encode(),b'[REDACTED]')
        m={'source':source,'source_url':clean,'http_status':status,'fetched_at_utc':utc_now()}
        bp.write_bytes(data);write_json(mp,m)
    if m['http_status']!=200:
        raise SourceError(f'{source}: HTTP {m["http_status"]}; cached response {bp.relative_to(ROOT)}')
    return data


def api_json(inc, source, url, **kwargs):
    data=cached_request(inc,source,url,**kwargs)
    try: return json.loads(data)
    except (ValueError,UnicodeError):
        raise SourceError(f'{source}: non-JSON response (see cached body)') from None
