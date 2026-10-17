"""Fetch 국가산불정보시스템 (fd.forest.go.kr/ffas) public records for every incident.

Public, login-free JSON endpoints used by the site's own pages (found with the Aside browser,
2026-10-18):
  pubConn/occur/getPublicShowFireInfoList.do  fire list: ignition coords, response level, 상황도 id
  pubConn/selectExtResHisList.do              mobilised helicopters / crews / equipment per fire
  gis/selectFrfrFfasM.do                      fire detail: report / receipt / confirmation times
  pubConn/selectPublicSttBrd.do               public 상황도 (situation map) list per fire
  gis/outSttnMapFeatureList.do                상황도 features (화선 / 진화완료 lines, EPSG:3857 WKT)

Writes data/raw/ffas/*.json (raw) and web/public/data/<id>/ffas.json (per incident).
"""
import json, math, re, time, urllib.parse, urllib.request
from datetime import datetime, timedelta
from incident import RAW, seeds, out_dir, compact, KST
from public_data_http import utc_now

BASE = 'https://fd.forest.go.kr/ffas'
RAWD = RAW / 'ffas'; RAWD.mkdir(parents=True, exist_ok=True)
PERIOD = ('20230101', datetime.now(KST).strftime('%Y%m%d'))
FEATURE_KIND = {'map_sttbrd_041': 'fire_line', 'map_sttbrd_042': 'extinguished_line', 'map_sttbrd_142': 'extinguished_line'}


def post(path, body, as_json):
    data = json.dumps(body).encode() if as_json else urllib.parse.urlencode(body).encode()
    headers = {'Content-Type': 'application/json' if as_json else 'application/x-www-form-urlencoded', 'User-Agent': 'firetrace-kr research'}
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers), timeout=60) as r:
                out = json.load(r)
            time.sleep(.4)
            return out
        except Exception:
            if attempt == 2: raise
            time.sleep(3 * (attempt + 1))


def pager(per):
    return {'perPage': per, 'perPageList': 10, 'pageListStart': 0, 'pageListEnd': 10, 'currentPage': 1, 'lastPage': '', 'totalCount': ''}


def fire_list():
    """All fires (one row per ignition) with coords, response level and 상황도 id."""
    rows, page = [], 1
    while True:
        p = pager(200); p['currentPage'] = page
        param = {'startDtm': PERIOD[0], 'endDtm': PERIOD[1], 'regionCode': '', 'issuCode': '', 'prgrsCode': '', 'sttnMapCheckFlag': '', **p}
        d = post('/pubConn/occur/getPublicShowFireInfoList.do', {'param': param, 'pager': p}, True)
        rows += d['frfrInfoList']
        if page >= d['pager']['last_page'] or not d['frfrInfoList']: break
        page += 1
    return rows


def resource_list():
    rows, page = [], 1
    while True:
        p = pager(200); p['currentPage'] = page
        d = post('/pubConn/selectExtResHisList.do', {'param': {'startDtm': PERIOD[0], 'endDtm': PERIOD[1]}, 'pager': p}, True)
        rows += d['resultList']
        if page >= d['pager']['lastPage'] or not d['resultList']: break
        page += 1
    return rows


def lonlat(x, y):
    R = 6378137.0
    return [round(x / R * 180 / math.pi, 6), round((2 * math.atan(math.exp(y / R)) - math.pi / 2) * 180 / math.pi, 6)]


def wkt_geometry(wkt):
    kind = wkt.split('(', 1)[0].strip().upper()
    parts = re.findall(r'\(([^()]+)\)', wkt)
    lines = [[lonlat(*map(float, pt.split()[:2])) for pt in part.split(',')] for part in parts]
    if kind == 'MULTILINESTRING': return {'type': 'MultiLineString', 'coordinates': lines}
    if kind == 'LINESTRING': return {'type': 'LineString', 'coordinates': lines[0]}
    if kind == 'POINT': return {'type': 'Point', 'coordinates': lines[0][0]}
    if kind in ('POLYGON', 'MULTIPOLYGON'): return {'type': 'MultiPolygon', 'coordinates': [[l] for l in lines]}
    raise ValueError('unsupported WKT ' + kind)


def kst(s, fmt):
    return datetime.strptime(s, fmt).replace(tzinfo=KST).isoformat() if s and s.strip() else None


def match_fire(key, fires):
    """Seed key 'YYYY-MM-DD HH:MM 군' -> ffas row (same day and county, nearest time within 90 min)."""
    day, hm, gungu = key.split()
    want = datetime.fromisoformat(f'{day}T{hm}')
    best = None
    for f in fires:
        t = datetime.fromisoformat(f['frfr_frng_dtm'].replace(' ', 'T'))
        if t.date() != want.date() or gungu not in f['frfr_sttmn_addr']: continue
        gap = abs((t - want).total_seconds()) / 60
        if gap <= 90 and (best is None or gap < best[0]): best = (gap, f)
    return best


def match_resource(f, res):
    """Resource history rows follow 산림청 statistics records; their minute can differ by 1-2."""
    t = datetime.fromisoformat(f['frfr_frng_dtm'].replace(' ', 'T'))
    for r in res:
        rt = datetime.fromisoformat(f"{r['frfr_frng_dtm_yr']}-{r['frfr_frng_dtm_month']}-{r['frfr_frng_dtm_dt']}T{r['frfr_frng_dtm_tm']}")
        if abs((rt - t).total_seconds()) <= 300 and r['sgng_nm'] and r['sgng_nm'] in f['frfr_sttmn_addr']:
            return {'helicopters': r['mblzt_hlcpt_sum'], 'crew': r['minfr_mblzt_nofpr_sum'] + r['bckfr_mblzt_nofpr_sum'],
                    'crew_minfr': r['minfr_mblzt_nofpr_sum'], 'crew_bckfr': r['bckfr_mblzt_nofpr_sum'],
                    'equipment': r['mblzt_eqpmn_sum'], 'level_label': r['issu_step_nm'], 'record_place': r['frfr_frng_place']}
    return None


def member(key, fires, res):
    m = match_fire(key, fires)
    if not m: return {'kfs_key': key, 'matched': False}, []
    gap, f = m
    fid = f['frfr_info_id']
    detail = post('/gis/selectFrfrFfasM.do', {'frfrInfoId': fid}, False)['frfrData']
    maps = [s for s in post('/pubConn/selectPublicSttBrd.do', {'frfrInfoId': fid}, True).get('result') or [] if s]
    json.dump({'detail': detail, 'maps': maps}, open(RAWD / f'fire_{fid}.json', 'w'), ensure_ascii=False)
    features = []
    for sm in maps:
        fl = post('/gis/outSttnMapFeatureList.do', {'sttnMapId': sm['sttn_map_id']}, False)
        json.dump(fl, open(RAWD / f'sttn_{sm["sttn_map_id"]}.json', 'w'), ensure_ascii=False)
        for ft in fl['sttnMapFeatureList']:
            if not ft.get('geom'): continue
            features.append({'type': 'Feature', 'geometry': wkt_geometry(ft['geom']),
                             'properties': {'fire_id': fid, 'map_id': sm['sttn_map_id'], 'label': ft['featureNm'],
                                            'kind': FEATURE_KIND.get(ft['featureTpcd'], ft['featureTpcd'])}})
    out = {'kfs_key': key, 'matched': True, 'match_gap_min': round(gap), 'fire_id': fid,
           'address': detail.get('frfrSttmnAddr') or f['frfr_sttmn_addr'],
           'lonlat': [round(float(f['frfr_lctn_xcrd']), 6), round(float(f['frfr_lctn_ycrd']), 6)],
           'ignition': kst(f['frfr_frng_dtm'], '%Y-%m-%d %H:%M'),
           'reported': kst((detail.get('frfrSttmnDt') or '') + (detail.get('frfrSttmnHms') or ''), '%Y%m%d%H%M%S'),
           'received': kst(detail.get('frfrRecptDtm'), '%Y%m%d%H%M%S'),
           'confirmed': kst(detail.get('confDtm'), '%Y%m%d%H%M%S'),
           'extinguished': kst(detail.get('potfrCmpleDtm'), '%Y%m%d%H%M%S'),
           'report_channel': (detail.get('frfrOccrrTpcdNm') or '').strip() or None,
           'office': detail.get('mnoffNm') or None,
           'final_level': f['frfr_step_issu_cd'],
           'resources': match_resource(f, res),
           'situation_maps': [{'map_id': s['sttn_map_id'], 'name': s['sttn_map_nm'], 'drawn_at': kst(s['sttn_map_mapng_dtm'][:19], '%Y-%m-%d %H:%M:%S'),
                               'wind_dir_code': s.get('sttbrd_wndrc_cd'), 'wind_ms': s.get('sttbrd_ws'), 'agency': s.get('frfr_mnagn_nm')} for s in maps]}
    return out, features


def main():
    fires = fire_list(); res = resource_list()
    compact(RAWD / 'fire_list.json', fires); compact(RAWD / 'resource_list.json', res)
    print(len(fires), 'fires,', len(res), 'resource rows')
    for seed in seeds():
        members, feats = [], []
        for key in seed['kfs']:
            m, fs = member(key, fires, res); members.append(m); feats += fs
        doc = {'source': '산림청 국가산불정보시스템 공개 화면(fd.forest.go.kr/ffas) — 실시간산불정보·진화자원이력·상황도',
               'fetched_utc': utc_now(),
               'caveat': '상황도는 산불 1단계(10ha) 이상만, 공개 화면에는 사건당 마지막 1장만 남음(그린 시각 drawn_at 기준). 화선=그 시점 남은 불의 선, 진화완료선=꺼진 구간. 면적 경계 아님. 진화자원은 사건 전체 누적 투입(연인원·연대수), 인력 crew=minfr+bckfr(화면 표기와 동일). 진화자원 이력은 산림청 통계 기록 기준이라 발생지 지번이 실시간 목록과 다를 수 있음.',
               'members': members,
               'situation': {'type': 'FeatureCollection', 'features': feats}}
        compact(out_dir(seed) / 'ffas.json', doc)
        print(seed['id'], [(m.get('fire_id'), m.get('final_level'), len(m.get('situation_maps', []))) for m in members], len(feats), 'features')


if __name__ == '__main__':
    main()
