"""Cache NASA FIRMS archive queries per incident; <=1 request/second."""
import csv
import io
from datetime import date, timedelta
from incident import (cli, raw_dir, read, compact, secret, cached_request,
                      SourceError, blocked, clear_blocked, t0)

SOURCES = ['VIIRS_SNPP_SP','VIIRS_NOAA20_SP','MODIS_SP']


def fetch(inc, bbox=None, start=None, end=None, name='firms'):
    bbox=bbox or inc['bbox'];start=start or t0(inc).date()
    end=end or date.fromisoformat(inc['end'])
    spec={'bbox':bbox,'start':str(start),'end':str(end),'sources':SOURCES}
    path=raw_dir(inc)/(name+'.json');meta=path.with_suffix('.meta.json')
    if path.exists() and read(meta,{}).get('request')==spec and read(meta,{}).get('complete'):
        return read(path)
    # Migrate the original, already-built Uiseong archive. Its fetcher queried
    # all three sources over 128.2,35.9,129.6,36.8 on March 21--31, 2025.
    from incident import RAW
    legacy=RAW/'firms.json'
    if name=='firms' and inc['id']=='uiseong-2025' and legacy.exists() and start>=date(2025,3,21) and end<=date(2025,3,31) and 128.2<=bbox[0]<bbox[2]<=129.6 and 35.9<=bbox[1]<bbox[3]<=36.8:
        previous=read(legacy,[])
        if {r['source'] for r in previous}==set(SOURCES):
            rows=[r for r in previous if bbox[0]<=float(r['longitude'])<=bbox[2] and bbox[1]<=float(r['latitude'])<=bbox[3] and str(start)<=r['acq_date']<=str(end)]
            compact(path,rows);compact(meta,{'request':spec,'complete':True,'rows':len(rows),'reused_from':'data/raw/firms.json','original_request':{'bbox':[128.2,35.9,129.6,36.8],'start':'2025-03-21','end':'2025-03-31','sources':SOURCES}})
            clear_blocked(inc,name)
            print(inc['id'],name,len(rows),'rows (original archive cache)',flush=True)
            return rows
    # The broad probe is already a paid archive retrieval. Reuse it whenever
    # it fully covers the final bbox/date window, preserving source completeness.
    probe=raw_dir(inc)/'firms_probe.json';pm=read(probe.with_suffix('.meta.json'),{})
    req=pm.get('request',{});box=req.get('bbox',[])
    if name=='firms' and pm.get('complete') and len(box)==4 and req.get('start','9999')<=str(start) and req.get('end','')>=str(end) and all((box[0]<=bbox[0],box[1]<=bbox[1],box[2]>=bbox[2],box[3]>=bbox[3])):
        rows=[r for r in read(probe,[]) if bbox[0]<=float(r['longitude'])<=bbox[2] and bbox[1]<=float(r['latitude'])<=bbox[3]
              and str(start)<=r['acq_date']<=str(end)]
        compact(path,rows);compact(meta,{'request':spec,'complete':True,'rows':len(rows),'reused_from':'firms_probe.json'})
        clear_blocked(inc,name)
        print(inc['id'],name,len(rows),'rows (probe cache)',flush=True)
        return rows
    key=secret('firms-map-key');rows=[];failures=[]
    for source in SOURCES:
        day=start
        while day<=end:
            span=min(5,(end-day).days+1)
            box=','.join(f'{v:.6f}' for v in bbox)
            url=f'https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{box}/{span}/{day}'
            try:
                text=cached_request(inc,'firms',url,interval=1.05,timeout=25,secrets=(key,)).decode('utf-8-sig')
                if text.strip() and not text.startswith(('latitude,','No data')):
                    raise SourceError('FIRMS returned non-CSV response (see cached body)')
                got=list(csv.DictReader(io.StringIO(text))) if text.startswith('latitude,') else []
                for r in got:r['source']=source
                rows+=got
            except SourceError as exc:
                failures.append(f'{source} {day}: {exc}')
            day+=timedelta(days=span)
    if failures:
        prior=read(path,[])
        for mp in (raw_dir(inc)/'http_cache').glob('*.meta.json'):
            evidence=read(mp,{})
            if evidence.get('source')!='firms' or evidence.get('http_status')!=200:continue
            source=next((s for s in SOURCES if '/'+s+'/' in evidence.get('source_url','')),None)
            if source is None:continue
            bp=mp.with_name(mp.name.replace('.meta.json','.body'))
            text=bp.read_text(encoding='utf-8-sig')
            if text.startswith('latitude,'):
                for r in csv.DictReader(io.StringIO(text)):
                    r['source']=source;prior.append(r)
        prior=[r for r in prior if bbox[0]<=float(r['longitude'])<=bbox[2] and bbox[1]<=float(r['latitude'])<=bbox[3] and str(start)<=r['acq_date']<=str(end)]
        unique={tuple(str(r.get(k,'')) for k in ('source','latitude','longitude','acq_date','acq_time')):r for r in prior+rows}
        rows=list(unique.values())
    compact(path,rows);compact(meta,{'request':spec,'complete':not failures,'rows':len(rows)})
    if failures:blocked(inc,name,'\n'.join(failures))
    else:clear_blocked(inc,name)
    print(inc['id'],name,len(rows),'rows', 'partial' if failures else '',flush=True)
    return rows


if __name__=='__main__':
    fetch(cli(__doc__))
