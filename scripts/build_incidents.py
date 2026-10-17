"""Build the public incident registry from national boundaries and FIRMS probes."""
import argparse
from datetime import date, timedelta
from incident import (PUBLIC, REGISTRY, seeds, t0, display_days, raw_dir, out_dir,
                      region_features, ignition, read, compact, blocked, IGNITION_ADMIN_SOURCES)
from derive import select_cluster, incident_rows
from fetch_firms import fetch


def stats(inc):
    out=out_dir(inc);fire=read(out/'fire.json',{});emd=read(out/'emd.json',{});kfs=read(out/'kfs_fires.json',{})
    hit=[f['properties'] for f in emd.get('features',[]) if f['properties'].get('first_hit') is not None]
    areas=fire.get('area',[])
    primary=[f for f in kfs.get('fires',[]) if f.get('incident_member')]
    return {'hotspots':len(fire['hotspots']) if 'hotspots' in fire else None,'grid_area_ha':areas[-1]['area_ha'] if areas else (0 if 'hotspots' in fire else None),
            'emd_touched':len(hit) if emd else None,'population_touched':sum(p['total'] or 0 for p in hit) if emd and all(p.get('total') is not None for p in hit) else None,
            'kfs_area_ha':round(sum(f['area_ha'] for f in primary),2) if primary else None}


def build(seed, previous=None, probe=True):
    codes,features=region_features(seed);origin,polygon=ignition(seed,features)
    # Probe around the administrative bbox center so multi-county complexes do
    # not lose their far flank when the ignition is near the western boundary.
    from incident import polygons
    positions=[xy for f in features for poly in polygons(f['geometry']) for xy in poly[0]]
    admin_bbox=[min(p[0] for p in positions),min(p[1] for p in positions),max(p[0] for p in positions),max(p[1] for p in positions)]
    probe_center=[(admin_bbox[0]+admin_bbox[2])/2,(admin_bbox[1]+admin_bbox[3])/2]
    old=read(raw_dir(seed)/'registry_build.json',{})
    bounds=old.get('bbox') if not probe else None
    if bounds is None:
        probe_box=[probe_center[0]-.6,probe_center[1]-.6,probe_center[0]+.6,probe_center[1]+.6]
        try:
            rows=fetch(seed,probe_box,date.fromisoformat(seed['start'])-timedelta(days=1),date.fromisoformat(seed['end'])+timedelta(days=1),'firms_probe')
            chosen=select_cluster(incident_rows(seed,rows),origin)
        except Exception as exc:
            blocked(seed,'firms_probe',str(exc));chosen=[]
        xs=[float(r['longitude']) for r in chosen] or [origin[0]];ys=[float(r['latitude']) for r in chosen] or [origin[1]]
        width=max(.5,max(xs)-min(xs)+.16);height=max(.4,max(ys)-min(ys)+.16)
        cx=(min(xs)+max(xs))/2;cy=(min(ys)+max(ys))/2
        bounds=[round(cx-width/2,6),round(cy-height/2,6),round(cx+width/2,6),round(cy+height/2,6)]
        compact(raw_dir(seed)/'registry_build.json',{'ignition_centroid':origin,'ignition_polygon':polygon,'ignition_emd_requested':seed['ignition_emd'],
                  'ignition_admin_source_url':IGNITION_ADMIN_SOURCES.get(seed['id']),
                  'ignition_basis':'Administrative-dong proxy for legal dong' if seed['ignition_emd']!=polygon['adm_nm'].split()[-1] else 'Area-weighted polygon centroid',
                  'administrative_bbox':admin_bbox,'probe_center':probe_center,'probe_bbox':probe_box,'cluster_hotspots':len(chosen),'bbox':bounds})
    w,s,e,n=bounds;width=e-w
    inc={k:seed[k] for k in ('id','name','short','start','end','sido','sigungu')}
    inc.update(t0=t0(seed).isoformat(),display_days=display_days(seed),center=[round((w+e)/2,6),round((s+n)/2,6)],
               zoom=round(10.2-min(1,max(0,(width-.5)/.5)),2),bbox=bounds,sigungu_codes=codes,reviewed=bool(seed.get('reviewed',False)))
    inc['files']=sorted(p.name for p in out_dir(inc).glob('*.json'))
    inc['stats']=stats(inc)
    return inc


def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--incident',choices=[s['id'] for s in seeds()]);ap.add_argument('--refresh-stats',action='store_true');args=ap.parse_args()
    previous={i['id']:i for i in read(REGISTRY,{'incidents':[]})['incidents']};result=[]
    for seed in seeds():
        if args.incident and seed['id']!=args.incident and seed['id'] in previous:
            result.append(previous[seed['id']]);continue
        inc=build(seed,previous.get(seed['id']),probe=not args.refresh_stats)
        result.append(inc);print(inc['id'],inc['sigungu_codes'],inc['bbox'],flush=True)
        compact(REGISTRY,{'incidents':result+[v for k,v in previous.items() if k not in {i['id'] for i in result}]})
    compact(REGISTRY,{'incidents':result})


if __name__=='__main__':main()
