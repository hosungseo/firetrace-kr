"""Validate every generated incident against the frontend contract; no HTTP."""
from datetime import datetime, timedelta
import re
from incident import (KST, PUBLIC, REGISTRY, RAW, read, seeds, load, t0, hours,
                      out_dir, raw_dir, distance, compact)
from build_all import verify
from build_incidents import stats

REQUIRED={'fire.json','emd.json','admin.json','population.json','kfs_fires.json','news.json','mentions_snippets.json'}


def validate(inc):
    out=out_dir(inc);files={p.name for p in out.glob('*.json')}
    assert REQUIRED<=files,(inc['id'],'missing files',REQUIRED-files)
    assert inc['files']==sorted(files),(inc['id'],'files inventory')
    assert inc['t0']==t0(inc).isoformat()
    assert all(re.fullmatch(r'\d{5}',c) for c in inc['sigungu_codes'])
    assert 3<=inc['display_days']<=10
    w,s,e,n=inc['bbox'];assert e-w>=.5-1e-6 and n-s>=.4-1e-6
    if not inc['reviewed']:assert not ({'events.json','response.json'}&files)
    fire=read(out/'fire.json');assert fire['t0']==inc['t0']
    assert fire['weather']['hours']==hours(inc)
    hs=fire['hotspots'];assert [h[2] for h in hs]==sorted(h[2] for h in hs)
    assert fire['meta']['hotspot_count']==len(hs)
    assert all(w-1e-4<=h[0]<=e+1e-4 and s-1e-4<=h[1]<=n+1e-4 for h in hs)
    assert len(fire['weather']['grid'])<=120 and len(fire['smoke'])<=120
    for p in fire['weather']['grid']:
        for key in ['ws','wd','gust','rh','temp','rain']:assert len(p[key])==len(hours(inc))
    for p in fire['smoke']:
        for key in ['pm25','aod']:assert len(p[key])==len(hours(inc))
    assert len(fire['stations'])<=6
    for stn in fire['stations']:
        if inc['id']!='uiseong-2025':assert distance(inc['center'],[stn['lon'],stn['lat']])<=60.001
        for key in ['ws','wd','rh','ta','rn']:assert len(stn[key])==len(hours(inc))
    assert len(fire['weather']['front'])==len(hours(inc))
    admin=read(out/'admin.json');emd=read(out/'emd.json');population=read(out/'population.json')
    codes={f['properties']['code'] for f in admin['features']}
    assert len(codes)==len(admin['features'])
    assert {c[:5] for c in codes}==set(inc['sigungu_codes'])
    assert {f['properties']['code'] for f in emd['features']}==codes
    assert population['period']==inc['start'][:7]
    assert len({r['code'] for r in population['rows']})==len(population['rows'])
    pops={r['code']:r for r in population['rows']}
    for f in emd['features']:
        p=f['properties']
        if p['code'] in pops:assert p['total']==pops[p['code']]['total']
        assert p['hotspots']==sum(row[1] for row in p['daily'])
        if p['first_hit'] is not None:assert p['hotspots']>0
    kfs=read(out/'kfs_fires.json');assert len(kfs['fires'])==kfs['count']
    primary=[f for f in kfs['fires'] if f.get('incident_member')]
    assert len(primary)==len(inc['kfs'])
    for f in kfs['fires']:
        assert f['t']==round((datetime.fromisoformat(f['start'])-t0(inc)).total_seconds()/60)
        assert f['t_end']==round((datetime.fromisoformat(f['end'])-t0(inc)).total_seconds()/60)
        if not f.get('incident_member'):
            assert f['lonlat'] and w<=f['lonlat'][0]<=e and s<=f['lonlat'][1]<=n
            assert inc['start']<=f['start'][:10]<=inc['end']
    news=read(out/'news.json');assert news['meta']['count']==len(news['articles'])
    assert len(news['articles'])==sum(row[1] for row in news['hourly'])
    lo=datetime.fromisoformat(inc['start']).replace(tzinfo=KST)
    hi=datetime.fromisoformat(inc['end']).replace(tzinfo=KST)+timedelta(days=4)
    for a in news['articles']:assert lo<=t0(inc)+timedelta(minutes=a[0])<hi
    assert inc['stats']==stats(inc),(inc['id'],'registry stats mismatch')
    return verify(inc)


def main():
    registry=read(REGISTRY)['incidents']
    assert [i['id'] for i in registry]==[i['id'] for i in seeds()]
    assert {p.name for p in PUBLIC.glob('*.json')}=={'incidents.json'}
    reports=[]
    print('| Incident | Hotspots | First − KFS ignition (min) | Grid ha | EMD |')
    print('|---|---:|---:|---:|---:|')
    for row in registry:
        inc=load(row['id']);r=validate(inc);reports.append(r)
        delay=r['first_detection_minus_ignition_minutes']
        print(f'| {r["id"]} | {r["hotspots"]}{" (<5 sparse)" if r["sparse_hotspots"] else ""} | {delay if delay is not None else "unknown"} | {r["grid_area_ha"]} | {r["emd_touched"]} |')
    compact(RAW/'incidents.verification.json',{'incidents':reports,'contract_validated':True})
    for r in reports:
        if r['blocked_sources']:print(r['id']+': '+', '.join(r['blocked_sources']))
    print('Validated',len(reports),'incidents')


if __name__=='__main__':main()
