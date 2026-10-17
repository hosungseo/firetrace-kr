"""Fetch incident ERA5 grid with per-request and per-incident disk caches."""
import urllib.parse
from incident import (cli, raw_dir, read, compact, api_json, t0, weather_end,
                      grid, SourceError, blocked, clear_blocked)

VARS='wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,temperature_2m,precipitation'


def fetch(inc, cams=False):
    source='cams' if cams else 'weather';name=source+'_grid'
    variables='pm2_5,pm10,aerosol_optical_depth,carbon_monoxide' if cams else VARS
    endpoint='https://air-quality-api.open-meteo.com/v1/air-quality' if cams else 'https://archive-api.open-meteo.com/v1/archive'
    pts=grid(inc);spec={'points':pts,'start':str(t0(inc).date()),'end':str(weather_end(inc)),'variables':variables,'models':None if cams else 'era5'}
    path=raw_dir(inc)/(name+'.json');mp=path.with_suffix('.meta.json')
    # JSON normalizes tuples to lists.
    if path.exists() and read(mp,{}).get('request')=={**spec,'points':[list(p) for p in pts]} and read(mp,{}).get('complete'):return read(path)
    rows=[];failures=[]
    for index in range(0,len(pts),30):
        chunk=pts[index:index+30]
        params={'latitude':','.join(str(p[0]) for p in chunk),'longitude':','.join(str(p[1]) for p in chunk),'start_date':spec['start'],'end_date':spec['end'],'hourly':variables,'timezone':'Asia/Seoul'}
        if not cams:params.update(wind_speed_unit='ms',models='era5')
        try:
            data=api_json(inc,source,endpoint+'?'+urllib.parse.urlencode(params),interval=1.1,timeout=90)
            data=data if isinstance(data,list) else [data]
            if len(data)!=len(chunk):raise SourceError(f'{source}: unexpected point count')
            for (lat,lon),p in zip(chunk,data):
                if 'hourly' not in p:raise SourceError(f'{source}: {p.get("reason","hourly data missing")}')
                rows.append({'lat':lat,'lon':lon,'hourly':p['hourly']})
        except SourceError as exc:failures.append(str(exc))
    compact(path,rows);compact(mp,{'request':spec,'complete':not failures,'points':len(rows),'source':endpoint,
                                'licence':'CC BY 4.0; Open-Meteo / ECMWF CAMS' if cams else 'CC BY 4.0; Open-Meteo ERA5',
                                'caveat':'Model fields; request lattice is not native model resolution. CAMS includes all pollution sources.'})
    if failures:blocked(inc,source,'\n'.join(failures))
    else:clear_blocked(inc,source)
    print(inc['id'],source,len(rows),'points',flush=True)
    return rows


if __name__=='__main__':fetch(cli(__doc__))
