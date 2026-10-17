"""Fetch target original articles with the shared HTTP cache (stdlib only)."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import signal
import time
from urllib.parse import urlsplit

import public_data_http as http

ROOT = Path(__file__).resolve().parents[1]
TEXT_DIR = ROOT / 'data/raw/article_text'
LANDMARKS = ('괴산리', '현하리', '백자리', '하회마을', '고운사', '병산서원',
             '주왕산', '점곡휴게소', '영덕아산병원', '청송교도소')


def targets():
    admin = json.loads((ROOT / 'web/public/data/admin.json').read_text())
    names = {f['properties']['emd'] for f in admin['features']} | set(LANDMARKS)
    articles = json.loads((ROOT / 'data/raw/naver_news.json').read_text())
    return [a for a in articles if any(n in a.get('title', '') + ' ' + a.get('desc', '') for n in names)]


def text_path(url):
    return TEXT_DIR / (hashlib.sha256(url.encode()).hexdigest() + '.txt')


class BodyParser(HTMLParser):
    """Collect paragraphs and article-like containers, excluding non-body UI."""
    VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    SKIP = {'script','style','noscript','nav','header','footer','aside','form','svg','button'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.blocks = []
        self.order = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in self.VOID:
            if tag in {'br', 'hr'}:
                self.handle_data('\n')
            return
        skipped = tag in self.SKIP or (self.stack and self.stack[-1]['skip'])
        ident = attrs.get('id', '').lower()
        classes = attrs.get('class', '').lower()
        candidate = not skipped and (tag in {'p', 'article'} or 'article' in ident or 'article' in classes
                                    or ident in {'newsct_article', 'dic_area', 'news_body', 'newsbody', 'news_content'})
        frame = {'tag': tag, 'skip': bool(skipped), 'candidate': candidate,
                 'parts': [], 'start': self.order, 'rank': 0 if tag == 'p' else 1}
        self.order += 1
        self.stack.append(frame)
        if tag in {'p','div','section','article','li','h1','h2','table'}:
            self.handle_data('\n')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]['tag'] == tag:
                closing = self.stack[i:]
                self.stack = self.stack[:i]
                for frame in closing:
                    if frame['candidate']:
                        text = '\n'.join(' '.join(line.split()) for line in ''.join(frame['parts']).splitlines())
                        text = re.sub(r'\n+', '\n', text).strip()
                        if text:
                            self.blocks.append((frame['start'], self.order, frame['rank'], text))
                if tag in {'p','div','section','article','li','h1','h2','table'}:
                    self.handle_data('\n')
                break

    def handle_data(self, data):
        if self.stack and not self.stack[-1]['skip']:
            for frame in self.stack:
                if frame['candidate']:
                    frame['parts'].append(data)

    def result(self):
        while self.stack:
            self.handle_endtag(self.stack[-1]['tag'])
        containers = [b for b in self.blocks if b[2] == 1 and len(b[3]) >= 300]
        # Prefer a focused substantial container; reject giant navigation wrappers
        # when a smaller nested article container holds most of its useful prose.
        if containers:
            largest = max(containers, key=lambda b: len(b[3]))
            focused = [b for b in containers if len(b[3]) >= max(300, len(largest[3]) * .55)]
            return min(focused, key=lambda b: len(b[3]))[3], 'article_container'
        paragraphs = sorted((b for b in self.blocks if b[2] == 0), key=lambda b:b[0])
        seen = set()
        return '\n'.join(b[3] for b in paragraphs if not (b[3] in seen or seen.add(b[3]))), 'paragraphs'


def extract_body(data, content_type=''):
    prefix = data[:12000].decode('ascii', errors='ignore')
    match = re.search(r'charset\s*=\s*[\"\']?([a-zA-Z0-9_-]+)', (content_type or '') + ' ' + prefix, re.I)
    encodings = ([match.group(1)] if match else []) + ['utf-8', 'cp949', 'euc-kr']
    for encoding in encodings:
        try:
            html = data.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    else:
        html = data.decode('utf-8', errors='replace')
    parser = BodyParser()
    parser.feed(html)
    return parser.result()


class FetchDeadline(BaseException):
    pass


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--minutes', type=float, default=45)
    args = ap.parse_args()
    if not 0 < args.minutes <= 45:
        ap.error('--minutes must be >0 and <=45')
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    articles = targets()
    started = time.monotonic()
    deadline = started + args.minutes * 60
    def expire(*_):
        raise FetchDeadline()
    signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, max(.001, deadline-time.monotonic()))
    results = []
    capped = False
    for index, article in enumerate(articles):
        url = article['url']
        path = text_path(url)
        mp = path.with_suffix('.meta.json')
        if path.exists() and mp.exists():
            results.append(json.loads(mp.read_text()))
            continue
        if capped or time.monotonic() >= deadline:
            capped = True
            results.append({'url': url, 'outcome': 'not_attempted_time_cap'})
            continue
        try:
            # Existing raw cache entries are read without modifying any prior file.
            key = hashlib.sha256((url + '\0').encode()).hexdigest()
            cp = http.CACHE / (key + '.body')
            cm = cp.with_suffix('.meta.json')
            if cp.exists() and cm.exists():
                raw, meta = cp.read_bytes(), json.loads(cm.read_text())
            else:
                raw, meta = http.fetch(url, min_interval=.51, timeout=6,
                                       max_attempts=2, max_bytes=8_000_000)
            body, method = extract_body(raw, meta.get('content_type')) if meta['http_status'] == 200 else ('', None)
            outcome = 'success' if meta['http_status'] == 200 and len(body) >= 300 else (
                'short_body_paywall_or_js' if meta['http_status'] == 200 else 'http_error')
            result = {'url': url, 'final_url': meta['final_url'], 'http_status': meta['http_status'],
                      'fetched_at_utc': meta['fetched_at_utc'], 'chars': len(body),
                      'outcome': outcome, 'extraction_method': method}
            path.write_text(body + ('\n' if body else ''), encoding='utf-8')
            http.write_json(mp, result)
        except FetchDeadline:
            capped = True
            result = {'url':url,'final_url':None,'http_status':None,'fetched_at_utc':http.utc_now(),
                      'chars':0,'outcome':'interrupted_time_cap'}
            path.write_text('')
            http.write_json(mp, result)
        except Exception as exc:
            result = {'url':url,'final_url':None,'http_status':None,'fetched_at_utc':http.utc_now(),
                      'chars':0,'outcome':'fetch_or_parse_error','error':str(exc)}
            path.write_text('')
            http.write_json(mp, result)
        results.append(result)
        if (index + 1) % 25 == 0:
            print(json.dumps({'processed':index+1,'target':len(articles),
                  'success':sum(r['outcome']=='success' for r in results),
                  'elapsed_seconds':round(time.monotonic()-started)},ensure_ascii=False),flush=True)
    signal.setitimer(signal.ITIMER_REAL, 0)
    from collections import Counter
    summary = {'generated_at_utc':http.utc_now(),'target_articles':len(articles),
               'elapsed_seconds':round(time.monotonic()-started,2),'fetch_cap_seconds':args.minutes*60,
               'cap_reached':capped,'outcomes':dict(Counter(r['outcome'] for r in results)),
               'articles':results,'body_min_chars':300,'min_request_interval_seconds':.51,
               'notes':['Original URLs only; short bodies excluded, not proof of a paywall.',
                        'Raw successful and failed HTTP responses cached by public_data_http.py.',
                        'Signal deadline interrupts an in-flight request at the fetching cap.']}
    http.write_json(TEXT_DIR / 'manifest.json',summary)
    print(json.dumps({k:v for k,v in summary.items() if k!='articles'},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    main()
