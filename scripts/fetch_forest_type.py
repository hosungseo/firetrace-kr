"""Render the 산림청 1:5,000 임상도 (map.forest.go.kr, SuperMap service map-TB_FGDI_IM5000) per incident.

The public map's own tile service renders any EPSG:3857 bbox as one PNG (no login; a redirect
cookie is required, found with the Aside browser 2026-10-18). Pixels are classified back to the
47 legend classes by exact/nearest legend colour. Outputs per incident:
  web/public/data/<id>/forest_type.png    overlay image (bounds in forest_type.json)
  web/public/data/<id>/forest_type.json   bounds, legend, class shares: whole bbox vs hotspot cells
Caveat: this is the current edition (layer updated 2026-02-25), not the pre-fire state.
"""
import http.cookiejar, json, math, struct, time, urllib.parse, urllib.request, zlib
from incident import RAW, seeds, out_dir, compact, read, PUBLIC
from public_data_http import utc_now

SERVICE = 'https://map.forest.go.kr/gis1/iserver/services/map-TB_FGDI_IM5000/rest/maps/TB_FGDI_IM5000'
R = 6378137.0
MAX_PX = 2048
# Legend order and swatch colours sampled from the site's legend image TB_FGDI_IM5000.png.
LEGEND = [('기타침엽수', '#815e29'), ('소나무', '#a59168'), ('잣나무', '#c69a87'), ('낙엽송', '#bf9677'), ('리기다소나무', '#926b2c'),
          ('곰솔', '#ad8701'), ('전나무', '#b06f00'), ('편백나무', '#b15b00'), ('삼나무', '#995100'), ('가문비나무', '#8a4212'),
          ('비자나무', '#c67d00'), ('은행나무', '#d6b300'), ('기타활엽수', '#c6eb61'), ('상수리나무', '#def829'), ('신갈나무', '#c1dc07'),
          ('굴참나무', '#95a905'), ('기타참나무류', '#cff942'), ('오리나무', '#e6f300'), ('고로쇠나무', '#e6e910'), ('자작나무', '#e6d500'),
          ('박달나무', '#e6c800'), ('밤나무', '#afe007'), ('물푸레나무', '#89af05'), ('서어나무', '#648103'), ('때죽나무', '#4e6402'),
          ('호두나무', '#daed9a'), ('백합나무', '#b5e633'), ('포플러', '#9eb502'), ('벚나무', '#83bc22'), ('느티나무', '#9bba3d'),
          ('층층나무', '#76a920'), ('아까시나무', '#009537'), ('기타상록활엽수', '#21668b'), ('가시나무', '#b3e1ac'), ('구실잣밤나무', '#b3de69'),
          ('녹나무', '#b3dc10'), ('굴거리나무', '#66b821'), ('황칠나무', '#66bd6c'), ('사스레피나무', '#66c2a5'), ('후박나무', '#00999b'),
          ('새덕이', '#009270'), ('침활혼효림', '#9bc029'), ('죽림', '#d9b673'), ('미립목지', '#cccccc'), ('제지', '#e4b19b'),
          ('관목덤불', '#ecf9c7'), ('비산림', '#ffffc1')]
GROUP = {**{n: '침엽수림' for n, _ in LEGEND[:11]}, **{n: '활엽수림' for n, _ in LEGEND[11:41]},
         '침활혼효림': '혼효림', '죽림': '기타 산림', '미립목지': '기타 산림', '제지': '기타 산림', '관목덤불': '기타 산림', '비산림': '비산림'}
RGB = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for _, c in LEGEND]


def opener():
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    o.addheaders = [('Referer', 'https://map.forest.go.kr/forest/'), ('User-Agent', 'firetrace-kr research')]
    return o


def merc(lon, lat):
    return lon * math.pi / 180 * R, R * math.log(math.tan(math.pi / 4 + lat * math.pi / 360))


def decode_png(data):
    """Minimal decoder for 8-bit RGBA/RGB non-interlaced PNG -> (w, h, channels, bytes)."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w = 8, b'', None
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8]); body = data[pos + 8:pos + 8 + n]; pos += 12 + n
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, lace = struct.unpack('>IIBBBBB', body)
            assert depth == 8 and ctype in (2, 6) and lace == 0, (depth, ctype, lace)
            ch = 4 if ctype == 6 else 3
        elif kind == b'IDAT': idat += body
        elif kind == b'IEND': break
    raw = zlib.decompress(idat); stride = w * ch; out = bytearray(h * stride); prev = bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0; b = prev[i]; c = prev[i - ch] if i >= ch else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = line; prev = line
    return w, h, ch, bytes(out)


def classify(rgb, cache={}):
    if rgb not in cache:
        d, i = min((sum((p - q) ** 2 for p, q in zip(rgb, c)), i) for i, c in enumerate(RGB))
        cache[rgb] = i if d <= 300 else None  # anti-aliased edges / labels stay unclassified
    return cache[rgb]


def shares(counts):
    total = sum(counts.values()) or 1
    by_class = {LEGEND[i][0]: round(v / total, 4) for i, v in sorted(counts.items(), key=lambda kv: -kv[1]) if v / total >= .001}
    groups = {}
    for i, v in counts.items(): groups[GROUP[LEGEND[i][0]]] = groups.get(GROUP[LEGEND[i][0]], 0) + v
    return {'pixels': sum(counts.values()), 'groups': {k: round(v / total, 4) for k, v in sorted(groups.items(), key=lambda kv: -kv[1])}, 'classes': by_class}


def run(seed, op):
    inc = next(i for i in read(PUBLIC / 'incidents.json')['incidents'] if i['id'] == seed['id'])
    w, s, e, n = inc['bbox']; (x0, y0), (x1, y1) = merc(w, s), merc(e, n)
    width = MAX_PX if x1 - x0 >= y1 - y0 else round(MAX_PX * (x1 - x0) / (y1 - y0))
    height = round(width * (y1 - y0) / (x1 - x0))
    vb = json.dumps({'leftBottom': {'x': x0, 'y': y0}, 'rightTop': {'x': x1, 'y': y1}})
    url = f'{SERVICE}/image.png?' + urllib.parse.urlencode({'viewBounds': vb, 'width': width, 'height': height, 'transparent': 'true',
                                                            'prjCoordSys': '{"epsgCode":3857}'})
    png = op.open(url, timeout=120).read(); time.sleep(1)
    (out_dir(seed) / 'forest_type.png').write_bytes(png)
    W, H, ch, px = decode_png(png)
    # Whole bbox (forest pixels only) vs pixels inside 375 m VIIRS hotspot cells.
    fire = read(out_dir(seed) / 'fire.json', {})
    half = math.sqrt(fire.get('meta', {}).get('cell_km2', .140625)) * 1000 / 2
    mask = bytearray(W * H)
    for h in fire.get('hotspots', []):
        hx, hy = merc(h[0], h[1]); k = 1 / math.cos(math.radians(h[1]))  # metres -> mercator units
        c0 = max(0, int((hx - half * k - x0) / (x1 - x0) * W)); c1 = min(W - 1, int((hx + half * k - x0) / (x1 - x0) * W))
        r0 = max(0, int((y1 - (hy + half * k)) / (y1 - y0) * H)); r1 = min(H - 1, int((y1 - (hy - half * k)) / (y1 - y0) * H))
        for r in range(r0, r1 + 1): mask[r * W + c0:r * W + c1 + 1] = b'\x01' * (c1 - c0 + 1)
    whole, burned = {}, {}
    for p in range(W * H):
        o = p * ch
        if ch == 4 and px[o + 3] < 128: continue
        i = classify(px[o:o + 3])
        if i is None or LEGEND[i][0] == '비산림': continue
        whole[i] = whole.get(i, 0) + 1
        if mask[p]: burned[i] = burned.get(i, 0) + 1
    doc = {'source': '산림청 산림공간정보서비스 나무지도(대축척 임상도 1:5,000), map.forest.go.kr SuperMap map-TB_FGDI_IM5000',
           'fetched_utc': utc_now(), 'edition_note': '현재판(서비스 갱신일 2026-02-25). 산불 이전 임상이 아니며 피해지는 이미 미립목지 등으로 갱신됐을 수 있음',
           'bounds': [w, s, e, n], 'image': 'forest_type.png', 'size': [W, H],
           'legend': [{'name': nm, 'color': c, 'group': GROUP[nm]} for nm, c in LEGEND],
           'method': '이미지 화소를 범례 색으로 역분류(색 거리 ≤ √300). 비산림·미분류 화소 제외한 산림 화소 기준 비율. hotspot_cells = VIIRS 열점 중심 375 m 칸 안의 화소',
           'whole_bbox': shares(whole), 'hotspot_cells': shares(burned) if burned else None}
    compact(out_dir(seed) / 'forest_type.json', doc)
    return doc


def main():
    op = opener()
    for seed in seeds():
        d = run(seed, op)
        hb = d['hotspot_cells']['groups'] if d['hotspot_cells'] else None
        print(seed['id'], d['size'], 'bbox', d['whole_bbox']['groups'], '| hotspot', hb)


if __name__ == '__main__':
    main()
