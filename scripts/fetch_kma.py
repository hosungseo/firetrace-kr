"""Public KMA station catalog and incident ASOS observations (data.go.kr)."""
import csv
import io
import re
import urllib.parse
from incident import (RAW, cli, raw_dir, read, compact, api_json, secret, distance,
                      t0, weather_end, blocked, clear_blocked, SourceError)
from public_data_http import fetch

CATALOG_URL='https://data.kma.go.kr/tmeta/stn/selectStnListDownload.do'
CITY_URL='https://www.weather.go.kr/w/obs-climate/land/city-obs.do'
UISEONG=[278,136,276,277,271,138]


def catalog():
    path=RAW/'asos_stations.json'
    if path.exists():return read(path)
    city,meta=fetch(CITY_URL)
    if meta['http_status']!=200:raise SourceError('KMA public ASOS list unavailable')
    ids=sorted(set(re.findall(r'stn=(\d+)',city.decode('utf-8'))),key=int)
    url=CATALOG_URL+'?'+urllib.parse.urlencode({'fileType':'csv','pgmNo':123,'stnIds':','.join(ids)})
    body,meta=fetch(url)
    if meta['http_status']!=200:raise SourceError('KMA station CSV unavailable')
    try:text=body.decode('utf-8-sig')
    except UnicodeError:text=body.decode('cp949')
    records=[]
    for r in csv.DictReader(io.StringIO(text.strip())):
        if not (r.get('위도') and r.get('경도')):continue
        records.append({'id':int(r['지점']),'name':r['지점명'],'lat':float(r['위도']),'lon':float(r['경도']),
                        'start':r['시작일'],'end':r['종료일'] or None})
    current={}
    for r in sorted(records,key=lambda r:r['start']):
        if r['end'] is None:current[r['id']]=r
    value={'source_url':url,'list_source_url':CITY_URL,'fetched_at_utc':meta['fetched_at_utc'],
           'stations':list(current.values()),'history':records,'note':'Public KMA station table CSV, filtered to ASOS IDs listed in KMA city observations; latest active history per station.'}
    if len(current)<90:raise SourceError('KMA catalog unexpectedly incomplete')
    compact(path,value);return value


def fetch_observations(inc):
    cat=catalog();stations={}
    for r in sorted(cat['history'],key=lambda r:r['start']):
        if r['start']<=inc['start'] and (r['end'] is None or r['end']>=inc['start']):stations[r['id']]=r
    selected=([stations[i] for i in UISEONG] if inc['id']=='uiseong-2025' else
              sorted((s for s in stations.values() if distance(inc['center'],(s['lon'],s['lat']))<=60),
                     key=lambda s:distance(inc['center'],(s['lon'],s['lat'])))[:6])
    spec={'stations':[s['id'] for s in selected],'start':str(t0(inc).date()),'end':str(weather_end(inc))}
    path=raw_dir(inc)/'kma_asos.json';mp=path.with_suffix('.meta.json')
    if path.exists() and read(mp,{}).get('request')==spec and read(mp,{}).get('complete'):return read(path)
    key=urllib.parse.unquote(secret('data-go-kr-firetrace-key'))
    value={'stations':{},'hourly':{},'daily':{},'positions':{str(s['id']):[s['lon'],s['lat']] for s in selected}};failures=[]
    for stn in selected:
        sid=str(stn['id']);value['stations'][sid]=stn['name']
        for kind,service,code in [('hourly','AsosHourlyInfoService','HR'),('daily','AsosDalyInfoService','DAY')]:
            params={'serviceKey':key,'pageNo':1,'numOfRows':999,'dataType':'JSON','dataCd':'ASOS','dateCd':code,
                    'startDt':spec['start'].replace('-',''),'endDt':spec['end'].replace('-',''),'stnIds':sid}
            if kind=='hourly':params.update(startHh='00',endHh='23')
            url=f'https://apis.data.go.kr/1360000/{service}/getWthrDataList?'+urllib.parse.urlencode(params)
            try:
                res=api_json(inc,'data_go_kr',url,secrets=(key,),interval=.4,timeout=40)['response']
                header=res.get('header',{})
                if header.get('resultCode')!='00':raise SourceError(f'KMA {sid}: {header.get("resultCode")} {header.get("resultMsg")}')
                items=(res['body'].get('items') or {}).get('item',[])
                value[kind][sid]=items if isinstance(items,list) else [items]
            except (SourceError,KeyError) as exc:failures.append(f'{sid} {kind}: {exc}');value[kind][sid]=[]
    compact(path,value);compact(mp,{'request':spec,'complete':not failures,'station_distances_km':{str(s['id']):round(distance(inc['center'],(s['lon'],s['lat'])),2) for s in selected},'note':'Uiseong keeps its six original stations; all others are <=60 km, at most six.'})
    if failures:blocked(inc,'kma','\n'.join(failures))
    else:clear_blocked(inc,'kma')
    print(inc['id'],'ASOS',len(selected),'stations',flush=True)
    return value


if __name__=='__main__':fetch_observations(cli(__doc__))
