"""Fetch 천리안위성 2A호 (GK2A) AMI L2 산불탐지 (FF) every 10 minutes for an incident window.

Source: 기상청 API허브 sat_file_down2.php?lvl=l2&dat=ff&are=ko (NetCDF4, 900x900 2 km LCC grid,
tm in UTC). Per-pixel lat/lon from nph-gk2a_latlon_api (area=KO, grid=2). The files carry
'Access is restricted to approved users only', so raw NetCDF is deleted after extraction and
only detections inside the incident bbox are kept (data/raw/gk2a/<id>/frames.json, gitignored).
Run with: uv run --with h5py --with numpy python scripts/fetch_gk2a_ff.py --incident uiseong-2025
"""
import argparse, json, re, time, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
import h5py, numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/gk2a'
KEY = (Path.home() / '.openclaw/secrets/kma-apihub-key').read_text().strip()
URL = 'https://apihub.kma.go.kr/api/typ01/url/sat_file_down2.php?lvl=l2&dat=ff&are=ko&typ=bin&tm={tm}&authKey=' + KEY
KST = timezone(timedelta(hours=9))


def grid():
    cache = RAW / 'ko2_latlon.npz'
    if cache.exists():
        z = np.load(cache); return z['lat'], z['lon']
    out = {}
    for v in ('lat', 'lon'):
        txt = (RAW / f'ko2_{v}.txt').read_text()
        nums = re.findall(r'-?\d+\.\d+', txt.split('=', 1)[1])
        out[v] = np.array(nums, dtype=np.float32).reshape(900, 900)  # top-left -> bottom-right
    np.savez_compressed(cache, **out)
    return out['lat'], out['lon']


def fetch(tm_utc):
    req = urllib.request.Request(URL.format(tm=tm_utc.strftime('%Y%m%d%H%M')), headers={'User-Agent': 'firetrace-kr research'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            if data[:4] == b'\x89HDF': return data
            if b'"status"' in data[:200] and b'404' in data[:200]: return None  # missing frame
            raise RuntimeError(data[:200])
        except Exception as e:
            if attempt == 3: print('  fail', tm_utc, str(e)[:120]); return None
            time.sleep(3 * (attempt + 1))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--incident', required=True); ap.add_argument('--hours-before', type=float, default=1)
    a = ap.parse_args()
    inc = next(i for i in json.loads((ROOT / 'web/public/data/incidents.json').read_text())['incidents'] if i['id'] == a.incident)
    inc['kfs'] = next(i for i in json.loads((ROOT / 'data/incidents.seed.json').read_text())['incidents'] if i['id'] == a.incident)['kfs']
    w, s, e, n = inc['bbox']; pad = .05
    lat, lon = grid()
    inside = (lon >= w - pad) & (lon <= e + pad) & (lat >= s - pad) & (lat <= n + pad)
    ys, xs = np.nonzero(inside)
    out_dir = RAW / a.incident; out_dir.mkdir(parents=True, exist_ok=True)
    frames_path = out_dir / 'frames.json'
    frames = json.loads(frames_path.read_text()) if frames_path.exists() else {}
    # Window: first kfs ignition − hours_before .. end of the display window (KST)
    start = min(datetime.fromisoformat(k.split()[0] + 'T' + k.split()[1]) for k in inc['kfs']).replace(tzinfo=KST) - timedelta(hours=a.hours_before)
    end = datetime.fromisoformat(inc['t0']) + timedelta(days=inc['display_days'])
    t = start.astimezone(timezone.utc).replace(minute=start.minute // 10 * 10, second=0)
    n_new = 0
    while t <= end.astimezone(timezone.utc):
        key = t.strftime('%Y%m%d%H%M')
        if key not in frames:
            data = fetch(t)
            if data is None:
                frames[key] = None
            else:
                tmp = out_dir / 'tmp.nc'; tmp.write_bytes(data)
                with h5py.File(tmp, 'r') as f:
                    ff = f['FF'][:]; dqf = f['DQF_FF'][:]
                tmp.unlink()
                hit = [(int(y), int(x)) for y, x in zip(ys, xs) if ff[y, x] == 1]
                # record: [row, col, lon, lat, confidence 7/8/9 or 10 industrial]
                frames[key] = [[y, x, round(float(lon[y, x]), 5), round(float(lat[y, x]), 5), int(dqf[y, x])] for y, x in hit]
            n_new += 1
            if n_new % 36 == 0:
                frames_path.write_text(json.dumps(frames)); print(' ', key, 'UTC', sum(1 for v in frames.values() if v), 'frames with fire')
            time.sleep(.3)
        t += timedelta(minutes=10)
    frames_path.write_text(json.dumps(frames))
    got = [k for k, v in frames.items() if v is not None]
    print(a.incident, len(frames), 'frames,', len(got), 'available,', sum(1 for k in got if frames[k]), 'with detections')


if __name__ == '__main__':
    main()
