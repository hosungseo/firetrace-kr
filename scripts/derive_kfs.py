"""Select seed KFS records plus contemporaneous fires located within the bbox."""
from datetime import datetime, timedelta
from incident import (KST, RAW, cli, raw_dir, out_dir, read, compact, t0,
                      national, centroid, SIDO, IGNITION_ADMIN)


def stamp(r,prefix):
    return datetime(int(r[prefix+'year']),int(r[prefix+'month']),int(r[prefix+'day']),
                    int(str(r.get(prefix+'time') or '00:00')[:2]),int(str(r.get(prefix+'time') or '00:00')[3:5]),tzinfo=KST)


def record_key(r):
    return stamp(r,'start').strftime('%Y-%m-%d %H:%M')+' '+r.get('locgungu','')


def main(inc):
    lookup={}
    for f in national()['features']:
        p=f['properties'];name=p['adm_nm'].split()[-1]
        lookup[(p['sidonm'],p['sggnm'].rstrip('시군구'),name.rstrip('읍면동'))]=centroid(f['geometry'])
    primary=set(inc['kfs']);selected=[];out=[];w,s,e,n=inc['bbox']
    lo=datetime.fromisoformat(inc['start']).replace(tzinfo=KST);hi=datetime.fromisoformat(inc['end']).replace(tzinfo=KST)+timedelta(days=1)
    for r in read(RAW/'kfs_fires_2023_2026.json',[]):
        start,end=stamp(r,'start'),stamp(r,'end');member=record_key(r) in primary
        pos=lookup.get((SIDO.get(r['locsi'],r['locsi']),r.get('locgungu',''),str(r.get('locmenu','')).strip().rstrip('읍면동')))
        if pos is None and member and inc['id'] in IGNITION_ADMIN:
            pos=lookup.get((SIDO[inc['sido']],inc['sigungu'][0].rstrip('시군구'),IGNITION_ADMIN[inc['id']].rstrip('읍면동')))
        if not member and not(lo<=start<hi and pos and w<=pos[0]<=e and s<=pos[1]<=n):continue
        selected.append(r)
        out.append({'si':r['locsi'],'gungu':r.get('locgungu',''),'emd':str(r.get('locmenu','')).strip(),'ri':str(r.get('locdong','')).strip(),'jibun':str(r.get('locbunji','')).strip(),
                    'start':start.isoformat(),'end':end.isoformat(),'t':round((start-t0(inc)).total_seconds()/60),'t_end':round((end-t0(inc)).total_seconds()/60),
                    'cause':r['firecause'],'area_ha':float(r['damagearea']),'lonlat':[round(v,5) for v in pos] if pos else None,'incident_member':member})
    found={record_key(r) for r in selected if record_key(r) in primary}
    if found!=primary:raise ValueError(f'Missing KFS seed records: {sorted(primary-found)}')
    out.sort(key=lambda r:r['t']);compact(raw_dir(inc)/'kfs_fires.json',selected)
    compact(out_dir(inc)/'kfs_fires.json',{'source':'산림청 산불발생통계(대국민포털) API, 2023–2026','count':len(out),'fires':out,
            'note':'좌표는 행정동 경계 면적 중심(지번 미지오코딩). incident_member는 seed kfs 키 일치, 그 외는 같은 기간·bbox 안 참고 산불. 피해면적 합계는 incident_member만 사용.'})
    from incident import clear_blocked
    clear_blocked(inc,'kfs')
    print(inc['id'],'KFS',len(out),'records;',sum(r['area_ha'] for r in out if r['incident_member']),'ha',flush=True)


if __name__=='__main__':main(cli(__doc__))
