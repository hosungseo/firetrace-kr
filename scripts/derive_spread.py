"""Derive the spread path between satellite passes: arrival-time cells and front-advance vectors.

Uses the same 375 m grid and VIIRS-only pass windows (< 180 min apart) as derive.py.
For each window, newly detected cells are grouped when within LINK grid steps; for each group the leading cell
(farthest from anything burned before the window) gives one vector: from its nearest earlier
cell to it. Distance / time since the previous window is a lower bound on the mean advance
speed (the front could have arrived any time between passes). Wind is the ERA5 grid point
nearest the vector origin, averaged over the gap, given as the direction the wind blows TO.
Writes web/public/data/<id>/spread.json.
"""
import collections, json, math
from datetime import datetime
from incident import seeds, out_dir, read, compact, t0

JUMP_KM = 3.0      # longer than this from any earlier cell: separate front, spotting or a missed pass
MIN_GROUP = 2      # ignore single new cells (noise, edge flicker)
MAJOR = 5          # groups of at least this many new cells are drawn as main fronts
LINK = 4           # new cells within this many grid steps (~1.5 km) belong to one front; a pass's
                   # new burn is often patchy, and per-patch arrows from the old edge fan out falsely


def bearing(a, b):
    y = math.sin(math.radians(b[0] - a[0])) * math.cos(math.radians(b[1]))
    x = math.cos(math.radians(a[1])) * math.sin(math.radians(b[1])) - math.sin(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.cos(math.radians(b[0] - a[0]))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def km(a, b):
    dx = (b[0] - a[0]) * 111.32 * math.cos(math.radians((a[1] + b[1]) / 2)); dy = (b[1] - a[1]) * 110.57
    return math.hypot(dx, dy)


def wind_to(fire, lonlat, t_from, t_to):
    """Mean wind vector (direction blown TO, speed) at the nearest ERA5 point over [t_from, t_to]."""
    w = fire['weather']; g = min(w['grid'], key=lambda p: (p['lon'] - lonlat[0]) ** 2 + (p['lat'] - lonlat[1]) ** 2)
    idx = [i for i, h in enumerate(w['hours']) if t_from <= h <= t_to] or [min(range(len(w['hours'])), key=lambda i: abs(w['hours'][i] - t_to))]
    u = sum(-g['ws'][i] * math.sin(math.radians(g['wd'][i])) for i in idx) / len(idx)  # wd is FROM
    v = sum(-g['ws'][i] * math.cos(math.radians(g['wd'][i])) for i in idx) / len(idx)
    return round((math.degrees(math.atan2(u, v)) + 360) % 360), round(math.hypot(u, v), 1)


def derive(seed):
    fire = read(out_dir(seed) / 'fire.json')
    if not fire or not fire.get('hotspots'): return None
    ref_lat = 36.4 if seed['id'] == 'uiseong-2025' else fire['meta'].get('grid_reference_latitude') or seed.get('center', [0, 36])[1]
    dlat = .375 / 111; dlon = .375 / (111 * math.cos(math.radians(ref_lat)))
    first = {}
    for h in fire['hotspots']:
        if h[4] == 'MODIS': continue
        c = (round(h[1] / dlat), round(h[0] / dlon))
        if c not in first or h[2] < first[c]: first[c] = h[2]
    if not first: return None
    # Known ignitions (산림청 국가산불정보시스템) — a new patch around one is a separate start, not spread
    base = t0(seed)
    ignitions = [(m['lonlat'], (datetime.fromisoformat(m['ignition']) - base).total_seconds() / 60, m['address'])
                 for m in (read(out_dir(seed) / 'ffas.json', {}) or {}).get('members', []) if m.get('matched') and m.get('ignition')]
    center = lambda c: (round(c[1] * dlon, 5), round(c[0] * dlat, 5))
    times = sorted(set(first.values())); windows = []
    for tm in times:
        if windows and tm - windows[-1][-1] < 180: windows[-1].append(tm)
        else: windows.append([tm])
    vectors, passes, burned = [], [], []
    for k, win in enumerate(windows):
        new = [c for c, tm in first.items() if win[0] <= tm <= win[-1]]
        passes.append({'t': win[0], 'new_cells': len(new)})
        if k and new and burned:
            prev_t = windows[k - 1][0]
            seen, groups = set(), []
            newset = set(new)
            for c in new:
                if c in seen: continue
                stack, g = [c], []; seen.add(c)
                while stack:
                    a = stack.pop(); g.append(a)
                    for dy in range(-LINK, LINK + 1):
                        for dx in range(-LINK, LINK + 1):
                            b = (a[0] + dy, a[1] + dx)
                            if b in newset and b not in seen: seen.add(b); stack.append(b)
                groups.append(g)
            old = [center(c) for c in burned]
            for g in groups:
                if len(g) < MIN_GROUP: continue
                best = None
                for c in g:
                    p = center(c); o = min(old, key=lambda q: (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2); d = km(o, p)
                    if best is None or d > best[0]: best = (d, o, p)
                d, o, p = best
                if d < .5: continue  # infill next to the old edge, no measurable advance
                dt_h = (win[0] - prev_t) / 60
                wdir, wspd = wind_to(fire, o, prev_t, win[0])
                b = bearing(o, p); diff = abs((b - wdir + 180) % 360 - 180)
                sep = next((addr for ll, ti, addr in ignitions if prev_t - 60 <= ti <= win[0] and
                            any(km(ll, center(c)) <= 2 for c in g)), None)
                vectors.append({'t': win[0], 't_prev': prev_t, 'from': list(o), 'to': list(p), 'km': round(d, 2), 'bearing': round(b),
                                'dt_h': round(dt_h, 1), 'min_kmh': round(d / dt_h, 2) if dt_h else None, 'cells': len(g), 'major': len(g) >= MAJOR,
                                'jump': d > JUMP_KM, 'wind_to': wdir, 'wind_ms': wspd, 'wind_diff': round(diff), 'separate_ignition': sep})
        burned += new
    cells = sorted([[*center(c), tm] for c, tm in first.items()], key=lambda r: r[2])
    downwind = [v for v in vectors if v['major'] and v['km'] >= 1 and not v['separate_ignition']]
    heads = {}
    for v in downwind:
        if v['t'] not in heads or v['km'] > heads[v['t']]['km']: heads[v['t']] = v
    for v in vectors: v['head'] = heads.get(v['t']) is v
    agree = sum(1 for v in downwind if v['wind_diff'] <= 45)
    total_km = sum(v['km'] for v in downwind)
    agree_km = round(sum(v['km'] for v in downwind if v['wind_diff'] <= 45) / total_km, 3) if total_km else None
    return {'method': 'VIIRS 375 m 칸의 첫 탐지 시각 = 도달 시각(관측 기준, 실제 도달은 그 이전). 통과 창(180분 이내 묶음)마다 약 1.5km 안에서 서로 이어진 새 칸을 한 전선으로 묶고, 각 전선에서 이전 탐지 칸과 가장 먼 칸까지를 전진 벡터로 그림. 통과마다 가장 긴 벡터 = 머리(head). 산림청 기록상 그 사이 새로 발화한 지점 2km 안의 묶음은 별도 발화로 표시하고 비교에서 뺌. 속도는 직전 통과 이후 경과 시간으로 나눈 최소 평균값',
            'cell_deg': [round(dlon, 6), round(dlat, 6)], 'passes': passes, 'vectors': vectors, 'cells': cells,
            'summary': {'vectors': len(vectors), 'major': sum(v['major'] for v in vectors), 'vectors_1km': len(downwind), 'with_wind_45': agree, 'km_share_with_wind_45': agree_km, 'heads': len(heads), 'heads_with_wind_45': sum(1 for v in heads.values() if v['wind_diff'] <= 45),
                        'longest': max(vectors, key=lambda v: v['km']) if vectors else None,
                        'fastest': max((v for v in vectors if not v['jump']), key=lambda v: v['min_kmh'] or 0, default=None)}}


def main():
    for seed in seeds():
        d = derive(seed)
        if not d: print(seed['id'], 'no VIIRS hotspots'); continue
        compact(out_dir(seed) / 'spread.json', d)
        s = d['summary']; L = s['longest']; F = s['fastest']
        print(seed['id'], len(d['cells']), 'cells', len(d['passes']), 'passes', s['vectors'], 'vectors', f"{s['with_wind_45']}/{s['vectors_1km']} ≤45° of wind",
              '| longest', L and (L['km'], L['bearing'], L['wind_to']), '| fastest', F and (F['min_kmh'], F['km'], F['dt_h']))


if __name__ == '__main__':
    main()
