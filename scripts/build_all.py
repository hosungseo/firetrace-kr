"""Run the complete cached incident pipeline, continuing after source failures."""
import argparse
from datetime import datetime, timedelta
import subprocess
import sys
from incident import (ROOT, REGISTRY, seeds, load, raw_dir, out_dir, read, compact,
                      blocked, t0)
from build_incidents import build

STAGES=[('admin','fetch_admin.py'),('firms','fetch_firms.py'),('weather','fetch_weather.py'),
        ('cams','fetch_cams.py'),('kma','fetch_kma.py'),('population','fetch_population.py'),
        ('naver_news','fetch_naver_news.py'),('population_derive','derive_population.py'),
        ('fire_derive','derive.py'),('emd_derive','derive_emd.py'),('kfs','derive_kfs.py'),
        ('news_derive','derive_news.py'),('mentions_snippets','derive_mentions_snippets.py')]


def verify(inc):
    out=out_dir(inc);fire=read(out/'fire.json',{});emd=read(out/'emd.json',{});kfs=read(out/'kfs_fires.json',{})
    hs=fire.get('hotspots',[]);hit=[f['properties'] for f in emd.get('features',[]) if f['properties'].get('first_hit') is not None]
    primary=[f for f in kfs.get('fires',[]) if f.get('incident_member')]
    ignition=min((datetime.fromisoformat(f['start']) for f in primary),default=None)
    detection=t0(inc)+timedelta(minutes=hs[0][2]) if hs else None
    report={'id':inc['id'],'hotspots':len(hs),'first_detection_kst':detection.isoformat() if detection else None,
            'kfs_ignition_kst':ignition.isoformat() if ignition else None,
            'first_detection_minus_ignition_minutes':round((detection-ignition).total_seconds()/60) if detection and ignition else None,
            'grid_area_ha':fire.get('area',[])[-1]['area_ha'] if fire.get('area') else 0,'emd_touched':len(hit),
            'sparse_hotspots':len(hs)<5,'blocked_sources':sorted(p.name for p in raw_dir(inc).glob('*.blocked.md'))}
    compact(raw_dir(inc)/'verification.json',report);return report


def refresh_registry():
    existing={i['id']:i for i in read(REGISTRY,{'incidents':[]})['incidents']}
    compact(REGISTRY,{'incidents':[build(s,existing.get(s['id']),probe=False) for s in seeds()]})


def main():
    ap=argparse.ArgumentParser(description=__doc__);group=ap.add_mutually_exclusive_group()
    group.add_argument('--incident',choices=[s['id'] for s in seeds()]);group.add_argument('--all',action='store_true')
    ap.add_argument('--retry-blocked',action='store_true',help='Retry cached HTTP failures (successful requests remain cached)')
    args=ap.parse_args()
    registered={i['id'] for i in read(REGISTRY,{'incidents':[]})['incidents']}
    if not REGISTRY.exists() or registered!={s['id'] for s in seeds()}:
        subprocess.run([sys.executable,str(ROOT/'scripts/build_incidents.py')],check=True,cwd=ROOT)
    ids=[s['id'] for s in seeds()] if args.all else [args.incident or 'uiseong-2025']
    reports=[]
    for ident in ids:
        inc=load(ident);raw=raw_dir(inc)
        if args.retry_blocked:
            for mp in (raw/'http_cache').glob('*.meta.json'):
                meta=read(mp);bp=mp.with_name(mp.name.replace('.meta.json','.body'))
                if meta['http_status']!=200:
                    mp.unlink();bp.unlink(missing_ok=True)
            if (raw/'firms_probe.blocked.md').exists():
                subprocess.run([sys.executable,str(ROOT/'scripts/build_incidents.py'),'--incident',ident],check=True,cwd=ROOT)
                inc=load(ident)
        stages=list(STAGES)
        if inc.get('reviewed'):
            if (raw/'events.json').exists():stages.append(('official','derive_official.py'))
            if (raw/'claims.json').exists():stages.append(('response','derive_response.py'))
        print('BUILD',ident,flush=True)
        with (raw/'build.log').open('w') as log:
            for source,script in stages:
                result=subprocess.run([sys.executable,str(ROOT/'scripts'/script),'--incident',ident],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
                if result.returncode:
                    blocked(inc,source,f'{script} exited {result.returncode}; see build.log. Other stages continued.')
                    print(ident,source,'BLOCKED',flush=True)
        reports.append(verify(inc));refresh_registry()
        print(reports[-1],flush=True)
    print('| Incident | Hotspots | First − ignition (min) | Grid ha | EMD touched |')
    print('|---|---:|---:|---:|---:|')
    for r in reports:
        delta=r['first_detection_minus_ignition_minutes']
        print(f'| {r["id"]} | {r["hotspots"]}{" ⚑ <5" if r["sparse_hotspots"] else ""} | {delta if delta is not None else "unknown"} | {r["grid_area_ha"]} | {r["emd_touched"]} |')
    print('Blocked sources:')
    for r in reports:
        if r['blocked_sources']:print(r['id']+': '+', '.join(r['blocked_sources']))


if __name__=='__main__':main()
