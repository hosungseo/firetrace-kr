"""Derive incident fire clusters, 375 m grid area and aligned weather arrays."""
import collections
import math
from datetime import datetime, timedelta, timezone
from incident import (KST, RAW, cli, compact, raw_dir, out_dir, read, t0,
                      hours, distance, ignition, region_features)

SAT={'VIIRS_SNPP_SP':'S-NPP','VIIRS_NOAA20_SP':'NOAA-20','MODIS_SP':'MODIS'}
CELL_KM2=.375*.375


def acquired(r):
    return datetime.strptime(r['acq_date']+str(r['acq_time']).zfill(4),'%Y-%m-%d%H%M').replace(tzinfo=timezone.utc)


def clusters(rows):
    """Original derive.py's 8-connected 0.02-degree occupied-cell clustering."""
    cells=collections.defaultdict(list)
    for r in rows:
        cells[(round(float(r['latitude'])/.02),round(float(r['longitude'])/.02))].append(r)
    seen=set();result=[]
    for cell in cells:
        if cell in seen:continue
        stack=[cell];seen.add(cell);members=[]
        while stack:
            a=stack.pop();members.extend(cells[a])
            for di in (-1,0,1):
                for dj in (-1,0,1):
                    b=(a[0]+di,a[1]+dj)
                    if b in cells and b not in seen:seen.add(b);stack.append(b)
        result.append(members)
    return result


def select_cluster(rows, origin):
    nearest=min(clusters(rows),key=lambda c:min(distance(origin,(float(r['longitude']),float(r['latitude']))) for r in c),default=[])
    # An unrelated fire tens of kilometres away is not a detection of this
    # ignition merely because the incident itself has no satellite coverage.
    if nearest and min(distance(origin,(float(r['longitude']),float(r['latitude']))) for r in nearest)>30:
        return []
    return nearest


def incident_rows(inc, rows):
    # Exclude pre-ignition background/industrial heat and observations after the
    # incident's final KST day, despite the deliberately wider UTC archive query.
    start=datetime.fromisoformat(min(inc['kfs'])[:16]).replace(tzinfo=KST) if inc.get('kfs') else datetime.fromisoformat(inc['start']).replace(tzinfo=KST)
    end=datetime.fromisoformat(inc['end']).replace(tzinfo=KST)+timedelta(days=1)
    return [r for r in rows if start<=acquired(r)<end]


def align(inc, hourly, key):
    mapping=dict(zip(hourly.get('time',[]),hourly.get(key,[])))
    return [mapping.get((t0(inc)+timedelta(minutes=h)).strftime('%Y-%m-%dT%H:%M')) for h in hours(inc)]


def num(v):
    return None if v in ('',None) else float(v)


def main(inc):
    raw=raw_dir(inc);out=out_dir(inc);base=t0(inc)
    origin=read(raw/'registry_build.json',{}).get('ignition_centroid')
    if origin is None:origin=ignition(inc,region_features(inc)[1])[0]
    rows=incident_rows(inc,read(raw/'firms.json',[]))
    fire=sorted(select_cluster(rows,origin),key=acquired)
    hs=[[round(float(r['longitude']),4),round(float(r['latitude']),4),round((acquired(r)-base).total_seconds()/60),
         round(float(r.get('frp') or 0),1),SAT[r['source']],r.get('confidence'),round(float(r.get('bright_ti4') or r.get('brightness') or 0))] for r in fire]
    reference_lat=36.4 if inc['id']=='uiseong-2025' else inc['center'][1]
    dlat=.375/111;dlon=.375/(111*math.cos(math.radians(reference_lat)))
    by_t=collections.defaultdict(list)
    for h in hs:
        if h[4]!='MODIS':by_t[h[2]].append(h)
    windows=[]
    for tm in sorted(by_t):
        if windows and tm-windows[-1][-1]<180:windows[-1].append(tm)
        else:windows.append([tm])
    burned=set();series=[];prev_t=None;prev_a=0
    for window in windows:
        pts=[h for tm in window for h in by_t[tm]]
        burned.update((round(h[1]/dlat),round(h[0]/dlon)) for h in pts)
        area=len(burned)*CELL_KM2*100;tm=window[-1]
        series.append({'t':tm,'t_start':window[0],'area_ha':round(area),'rate_ha_h':None if prev_t is None else round((area-prev_a)/((tm-prev_t)/60),1),'n':len(pts),'frp':round(sum(h[3] for h in pts))})
        prev_t,prev_a=tm,area
    fields={'ws':'wind_speed_10m','wd':'wind_direction_10m','gust':'wind_gusts_10m','rh':'relative_humidity_2m','temp':'temperature_2m','rain':'precipitation'}
    grid=[{'lat':p['lat'],'lon':p['lon'],**{k:align(inc,p['hourly'],v) for k,v in fields.items()}} for p in read(raw/'weather_grid.json',[])]
    smoke=[{'lat':p['lat'],'lon':p['lon'],'pm25':align(inc,p['hourly'],'pm2_5'),'aod':align(inc,p['hourly'],'aerosol_optical_depth')} for p in read(raw/'cams_grid.json',[])]
    front=[]
    for i,hm in enumerate(hours(inc)):
        recent=[h for h in hs if hm-720<=h[2]<=hm]
        lon,lat=([sum(h[j] for h in recent)/len(recent) for j in (0,1)] if recent else (hs[0][:2] if hs else origin))
        g=min(grid,key=lambda p:(p['lat']-lat)**2+(p['lon']-lon)**2,default=None)
        f={'t':hm,**{k:g[k][i] if g else None for k in fields},'lat':g['lat'] if g else lat,'lon':g['lon'] if g else lon,'pm25':None}
        if smoke:
            sm=min(smoke,key=lambda p:(p['lat']-lat)**2+(p['lon']-lon)**2);f['pm25']=sm['pm25'][i]
        front.append(f)
    kma=read(raw/'kma_asos.json',{});catalog={str(s['id']):s for s in read(RAW/'asos_stations.json',{}).get('stations',[])}
    stations=[]
    for stn,name in kma.get('stations',{}).items():
        hrs={h['tm']:h for h in kma['hourly'].get(stn,[])};gusts=[]
        for d in kma['daily'].get(stn,[]):
            hm=d.get('maxInsWsHrmt','')
            if d.get('maxInsWs') and len(hm)==4:
                dt=datetime.fromisoformat(d['tm']).replace(hour=int(hm[:2]),minute=int(hm[2:]),tzinfo=KST)
                gusts.append({'t':round((dt-base).total_seconds()/60),'v':num(d['maxInsWs']),'wd':num(d.get('maxInsWsWd')),'min_rh':num(d.get('minRhm'))})
        xy=kma.get('positions',{}).get(stn)
        pos={'lon':xy[0],'lat':xy[1]} if xy else catalog[stn]
        vals={k:[num(hrs.get((base+timedelta(minutes=h)).strftime('%Y-%m-%d %H:%M'),{}).get(v)) for h in hours(inc)] for k,v in {'ws':'ws','wd':'wd','rh':'hm','ta':'ta','rn':'rn'}.items()}
        stations.append({'id':int(stn),'name':name,'lon':pos['lon'],'lat':pos['lat'],**vals,'daily_gust':gusts})
    first={'lon':hs[0][0],'lat':hs[0][1],'t':hs[0][2]} if hs else None
    value={'t0':base.isoformat(),'hotspots':hs,'area':series,'weather':{'hours':hours(inc),'grid':grid,'front':front},'stations':stations,'smoke':smoke,
           'meta':{'first_detection':first,'hotspot_count':len(hs),'cell_km2':CELL_KM2,'grid_reference_latitude':reference_lat,'cluster':'8-connected 0.02 degree cells nearest ignition centroid, within 30 km; ignition through end KST',
                   'blocked_sources':[p.stem.removesuffix('.blocked') for p in raw.glob('*.blocked.md')]}}
    compact(out/'fire.json',value);compact(RAW.parent/'derived'/inc['id']/'fire.json',value)
    print(inc['id'],len(hs),'hotspots;',series[-1]['area_ha'] if series else 0,'ha',flush=True)


if __name__=='__main__':main(cli(__doc__))
