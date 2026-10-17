"""Derive a 10-minute fire path from GK2A 산불탐지 frames (see fetch_gk2a_ff.py).

Filters: confidence flag 7-9 only (10 = industrial heat); a pixel must be detected in at least
two frames within 60 minutes (single-frame flickers dropped); and it must lie within NEAR_KM of a
VIIRS 375 m cell of this incident (spread.json), which removes unrelated fires and noise.
Outputs web/public/data/<id>/gk2a.json:
  pixels  [lon, lat, first_t]                (first_t = minutes since incident t0, KST)
  frames  [t, [pixel indices active]]        (frames with at least one active pixel)
  head    [t, lon, lat, km]                  farthest active pixel from the ignition per frame
  reach   [t, km]                            running max of head km (leading-edge envelope)
"""
import argparse, json, math
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEAR_KM = 3.0
KST = timezone(timedelta(hours=9))


def km(a, b):
    return math.hypot((b[0] - a[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2)), (b[1] - a[1]) * 110.57)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--incident', required=True); a = ap.parse_args()
    pub = ROOT / 'web/public/data' / a.incident
    inc = next(i for i in json.loads((ROOT / 'web/public/data/incidents.json').read_text())['incidents'] if i['id'] == a.incident)
    t0 = datetime.fromisoformat(inc['t0'])
    frames = json.loads((ROOT / 'data/raw/gk2a' / a.incident / 'frames.json').read_text())
    spread = json.loads((pub / 'spread.json').read_text())
    viirs = [(c[0], c[1]) for c in spread['cells']]
    ffas = json.loads((pub / 'ffas.json').read_text())
    members = [m for m in ffas['members'] if m.get('matched') and m.get('lonlat') and m.get('ignition')]
    ign = members[0]['lonlat'] if members else list(viirs[0])
    ign_t = [((datetime.fromisoformat(m['ignition']) - t0).total_seconds() / 60, m['lonlat'], m['address']) for m in members]

    def near_viirs(p, cache={}):
        k = (p[0], p[1])
        if k not in cache:
            cache[k] = any(abs(c[0] - p[0]) < .05 and abs(c[1] - p[1]) < .04 and km(c, p) <= NEAR_KM for c in viirs)
        return cache[k]

    seq = []  # (t_minutes, {pixel_key: (lon, lat)})
    for key in sorted(frames):
        det = frames[key]
        if not det: continue
        t = (datetime.strptime(key, '%Y%m%d%H%M').replace(tzinfo=timezone.utc) - t0).total_seconds() / 60
        seq.append((round(t), {(r[0], r[1]): (r[2], r[3]) for r in det if 7 <= r[4] <= 9}))
    # persistence: detected in >= 2 frames within 60 min
    hits = {}
    for t, px in seq:
        for k in px: hits.setdefault(k, []).append(t)
    keep = {k for k, ts in hits.items() if any(ts[i + 1] - ts[i] <= 60 for i in range(len(ts) - 1))}
    pos = {}
    for t, px in seq:
        for k, ll in px.items(): pos[k] = ll
    keep = {k for k in keep if near_viirs(pos[k])}
    order = sorted(keep, key=lambda k: min(hits[k]))
    index = {k: i for i, k in enumerate(order)}
    pixels = [[pos[k][0], pos[k][1], min(hits[k])] for k in order]
    # Owner = nearest known ignition already burning when the pixel was first seen. Separate starts
    # (e.g. 의성 안계·금성) would otherwise read as long jumps of the main fire.
    def owner(p):
        live = [(km(ll, p), i) for i, (ti, ll, _) in enumerate(ign_t) if ti <= p[2] + 10] or [(0, 0)]
        return min(live)[1]
    owners = [owner(p) for p in pixels]
    out_frames, head, reach, best = [], [], [], 0.0
    for t, px in seq:
        act = [index[k] for k in px if k in index]
        if not act: continue
        out_frames.append([t, sorted(act)])
        main = [i for i in act if owners[i] == 0]
        if not main: continue
        far = max(main, key=lambda i: km(ign, pixels[i]))
        d = km(ign, pixels[far]); head.append([t, pixels[far][0], pixels[far][1], round(d, 2)])
        best = max(best, d); reach.append([t, round(best, 2)])
    # fastest sustained advance of the leading edge over 60 minutes
    fast = None
    for i, (t, r) in enumerate(reach):
        j = next((j for j in range(i, len(reach)) if reach[j][0] - t >= 60), None)
        if j is None: break
        rate = (reach[j][1] - r) / ((reach[j][0] - t) / 60)
        if fast is None or rate > fast['kmh']: fast = {'t_from': t, 't_to': reach[j][0], 'kmh': round(rate, 2), 'km_from': r, 'km_to': reach[j][1]}
    doc = {'source': '기상청 API허브 천리안위성 2A호 AMI L2 산불탐지(FF), 한반도 2km, 10분 간격',
           'method': f'신뢰도 하·중·상 탐지만(산업 열원 제외), 60분 안에 2번 이상 잡힌 화소만, 이 사건 VIIRS 칸에서 {NEAR_KM:g}km 안의 화소만 사용. 화소마다 그때 타고 있던 가장 가까운 발화점(산림청 기록)에 배정하고, 머리 = 프레임마다 주 발화점 소속 화소 중 발화점에서 가장 먼 것, 도달 = 그 최댓값의 누적',
           'ignition': ign, 'frames_total': len(frames), 'frames_available': sum(1 for v in frames.values() if v is not None),
           'pixels': pixels, 'owners': owners, 'ignitions': [[ti, ll, addr] for ti, ll, addr in ign_t], 'frames': out_frames, 'head': head, 'reach': reach, 'fastest_hour': fast}
    (pub / 'gk2a.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')))
    print(a.incident, len(pixels), 'pixels', len(out_frames), 'active frames', 'max reach', best and round(best, 1), 'km', 'fastest', fast)


if __name__ == '__main__':
    main()
