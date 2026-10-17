"""Extract timed place/action co-occurrences from cached article bodies; stdlib only.

Run fetch_article_text.py first. This script performs no network access.
These are sentence co-occurrences, not verified place-specific event claims.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import random
import re
from urllib.parse import urlsplit

from fetch_article_text import ROOT, TEXT_DIR, LANDMARKS, targets, text_path
from public_data_http import utc_now, write_json

KST = timezone(timedelta(hours=9))
BASE = datetime(2025, 3, 21, tzinfo=KST)
ACTIONS = {
    'spread': ('비화','번졌','번져','확산','넘어','도달','옮겨붙','덮쳤'),
    'evacuation': ('대피','피신','이송'),
    'alert': ('재난문자','안전안내문자','재난안전문자','긴급재난문자','문자를 발송','경보'),
    'control': ('통제','차단','폐쇄','운행 중단','통행금지'),
    'containment': ('진화율','주불','잔불','완진','진화 완료'),
    'casualty': ('사망','숨진','숨졌','실종','부상'),
}
# Only mappings stated in claims_review.md section 1 / the task. No inferred
# municipality for hospitals, prisons, national parks, or nearby landmarks.
ALIASES = {'괴산리':'안평면','현하리':'길안면','백자리':'길안면','하회리':'풍천면',
           '철파리':'의성읍','고운사':'단촌면','점곡휴게소':'점곡면'}
CLOCK = re.compile(r'(?<!\d)(?:(오전|오후)\s*)?(\d{1,2})시(?:\s*(\d{1,2})분)?(?:께|쯤|경에|경)?|정오|자정')
DAY = re.compile(r'(?:(?P<year>\d{4})년\s*)?(?:(?P<month>\d{1,2})월\s*)?(?<!\d)(?P<day>\d{1,2})일(?!\d|간|동안)')
RELATIVE = re.compile(r'전날|이날|오늘|어제')


def split_sentences(body):
    # Keep decimal dots (3.4m/s) within their sentence. Quotation closers remain
    # attached; paragraph boundaries also end fragments, never joining captions.
    boundary = re.compile(r"[。!?]+[”’\"']*|(?<=[다요])\.[”’\"']*|\.(?!\d)[”’\"']*(?=\s|$)|\n+")
    sentences = []
    start = 0
    for match in boundary.finditer(body):
        text = body[start:match.end()].strip()
        if text:
            sentences.append(text)
        start = match.end()
    if body[start:].strip():
        sentences.append(body[start:].strip())
    return sentences


def distance(span, position):
    return min(abs(span[0] - position), abs(span[1] - position)) if not span[0] <= position <= span[1] else 0


def date_for(sentence, clock, published):
    explicit = list(DAY.finditer(sentence))
    if explicit:
        # Prefer the last explicit day preceding this clock. A following explicit
        # day is used only when no day precedes it in the sentence.
        before = [m for m in explicit if m.start() <= clock.start()]
        match = before[-1] if before else min(explicit, key=lambda m:distance(m.span(), clock.start()))
        day = int(match['day'])
        month = int(match['month']) if match['month'] else None
        year = int(match['year']) if match['year'] else None
        candidates = []
        for offset in (-1, 0, 1):
            total = published.year * 12 + published.month - 1 + offset
            y, mo = divmod(total, 12)
            mo += 1
            if month is not None:
                mo = month
                y = year or published.year
            elif year is not None:
                y = year
            try:
                candidates.append(datetime(y,mo,day,tzinfo=KST))
            except ValueError:
                pass
        if not candidates:
            return None, 'unknown'
        return min(candidates, key=lambda d:abs((d.date()-published.date()).days)), 'explicit_day'
    relatives = list(RELATIVE.finditer(sentence))
    before = [m for m in relatives if m.start() <= clock.start()]
    rel = before[-1] if before else (min(relatives,key=lambda m:distance(m.span(),clock.start())) if relatives else None)
    previous = rel and rel.group() in {'전날','어제'}
    return published.replace(hour=0,minute=0,second=0,microsecond=0) - timedelta(days=bool(previous)), 'previous_day' if previous else 'article_day'


def resolve_clock(sentence, match, published):
    day, basis = date_for(sentence, match, published)
    raw = match.group().strip()
    reason = None
    if raw in {'정오','자정'}:
        hour, minute = (12 if raw == '정오' else 0), 0
    else:
        hour, minute = int(match[2]), int(match[3] or 0)
        meridiem = match[1]
        # Recover shared Korean daypart in coordinated expressions, e.g.
        # '오후 1시와 2시', and '낮 12시', '새벽 2시'.
        context = sentence[:match.start()]
        dayparts = list(re.finditer(r'오전|오후|새벽|아침|저녁|밤|낮',context))
        part = meridiem or (dayparts[-1].group() if dayparts else None)
        if minute > 59 or hour > 23 or (meridiem and not 1 <= hour <= 12):
            reason = 'invalid_clock'
        elif part in {'오전','새벽','아침'} and hour <= 12:
            hour %= 12
        elif part in {'오후','낮','저녁','밤'} and hour <= 12:
            hour = hour % 12 + 12
            if part == '밤' and int(match[2]) == 12:
                hour = 0
        elif 1 <= hour <= 12 and not part:
            reason = 'ambiguous_meridiem'
    if day is None:
        reason = 'invalid_date'
    event = None if reason else day.replace(hour=hour,minute=minute)
    return {'time_text':raw,'event_time':event.isoformat() if event else None,
            't':int((event-BASE).total_seconds()//60) if event else None,
            'date_basis':basis,'time_resolution_note':reason,
            'offset_start':match.start(),'offset_end':match.end()}


def place_index():
    admin = json.loads((ROOT/'web/public/data/admin.json').read_text())
    codes = {f['properties']['emd']:str(f['properties']['code']) for f in admin['features']}
    names = {n:[code] for n,code in codes.items()}
    names.update({alias:[codes[name]] for alias,name in ALIASES.items()})
    for name in LANDMARKS:
        names.setdefault(name,[])
    return codes,names


def places_in(sentence, names):
    result = defaultdict(list)
    # Longest-first matching avoids matching a short name inside a longer one.
    pattern = re.compile('|'.join(map(re.escape,sorted(names,key=len,reverse=True))))
    for match in pattern.finditer(sentence):
        # Korean particles may follow place names, so no trailing word boundary.
        if match.start() and re.match('[가-힣]',sentence[match.start()-1]):
            # Allow ordinary concatenated administrative addresses, e.g. 의성군안평면.
            if not sentence[:match.start()].endswith(('시','군','구','도')):
                continue
        key = tuple(names[match.group()]) or (match.group(),)
        result[key].append(match)
    return result


def extract():
    codes,names = place_index()
    articles = targets()
    grouped = {}
    article_counts = Counter()
    candidate_occurrences = 0
    for article in articles:
        path = text_path(article['url'])
        mp = path.with_suffix('.meta.json')
        if not mp.exists():
            article_counts['not_attempted_time_cap'] += 1
            continue
        meta = json.loads(mp.read_text())
        article_counts[meta['outcome']] += 1
        if meta['outcome'] != 'success':
            continue
        try:
            published = datetime.fromisoformat(article['pub']).astimezone(KST)
        except (ValueError, KeyError):
            article_counts['invalid_publication_date'] += 1
            continue
        seen = set()
        for sentence in split_sentences(path.read_text()):
            sentence = ' '.join(sentence.split())
            if sentence in seen:
                continue
            seen.add(sentence)
            if not any(name in sentence for name in names):
                continue
            clocks = list(CLOCK.finditer(sentence))
            actions = [action for action,words in ACTIONS.items() if any(w in sentence for w in words)]
            places = places_in(sentence,names)
            if not clocks or not actions or not places:
                continue
            candidate_occurrences += 1
            # Exact, whitespace-normalized sentence syndication only. Date and
            # clocks are resolved using the earliest copy's publication metadata.
            entry = grouped.setdefault(sentence,{'article':article,'published':published,'urls':set()})
            entry['urls'].add(article['url'])
            if published < entry['published']:
                entry.update(article=article,published=published)
    records = []
    for sentence, entry in grouped.items():
        article,published = entry['article'],entry['published']
        clocks = list(CLOCK.finditer(sentence))
        times = [resolve_clock(sentence,m,published) for m in clocks]
        actions = [a for a,words in ACTIONS.items() if any(w in sentence for w in words)]
        for key,matches in places_in(sentence,names).items():
            selected = min(range(len(clocks)),key=lambda i:min(distance(clocks[i].span(),m.start()) for m in matches))
            primary = times[selected]
            emd_codes = list(key) if key[0] in codes.values() else []
            record = {'url':article['url'],'outlet':urlsplit(article['url']).hostname or '',
                      'published':article['pub'],'sentence':sentence,'emd_codes':emd_codes,
                      'place_text':' · '.join(dict.fromkeys(m.group() for m in matches)),
                      **{k:v for k,v in primary.items() if not k.startswith('offset_')},
                      'actions':actions,'copies':len(entry['urls']),
                      'time_mentions':times,'selected_time_index':selected}
            records.append(record)
    records.sort(key=lambda r:(r['published'],r['sentence'],r['place_text']))
    counts = Counter(a for r in records for a in r['actions'])
    meta = {'generated_at_utc':utc_now(),'time_base':BASE.isoformat(),'time_unit':'minutes',
            'target_articles':len(articles),'article_outcomes':dict(article_counts),
            'sentence_occurrences_before_dedupe':candidate_occurrences,'sentences_kept':len(grouped),
            'records':len(records),'records_per_action':dict(counts),
            'emd_covered':len({c for r in records for c in r['emd_codes']}),
            'unmapped':sum(not r['emd_codes'] for r in records),
            'unresolved_time_records':sum(r['t'] is None for r in records),
            'dedupe':'Exact whitespace-normalized sentences; earliest publication; copies = distinct original URLs including keeper.',
            'selection':'One record per (sentence, EMD); multiple aliases of one EMD coalesced. Unmapped landmarks retain separate records.',
            'time_selection':'Nearest clock to any occurrence of the record place; tie picks first; all clocks retained in time_mentions.',
            'date_selection':'Last explicit NN일 before clock wins; otherwise nearest following day; nearest publication month when month absent. Relative day then publication day.',
            'uncertainty':'Unqualified 1–12시 without daypart => event_time/t null. No inferred PM from publication time.',
            'mapping':ALIASES,
            'caveats':['Sentence co-occurrence is not a verified event/action/time/place relation.',
                       'first is earliest extracted nominal time, not first actual event or official response.',
                       'Unknown landmark locations remain unmapped; no sigungu-to-EMD fanout.',
                       'Earliest publication may predate an updated version of the fetched body.',
                       'No body is replaced with title, description, or a Naver copy.']}
    write_json(ROOT/'data/raw/mentions_auto.json',records)
    write_json(ROOT/'data/raw/mentions_auto.meta.json',meta)
    by_emd = {}
    for code in codes.values():
        subset = [r for r in records if code in r['emd_codes']]
        first = {a:min((r['t'] for r in subset if a in r['actions'] and r['t'] is not None),default=None) for a in ACTIONS}
        count = {a:sum(a in r['actions'] for r in subset) for a in ACTIONS}
        hourly = Counter((r['t']//60)*60 for r in subset if r['t'] is not None)
        # Spread samples across actions then fill in publication order.
        samples = []
        for action in ACTIONS:
            for record in subset:
                if action in record['actions'] and record not in samples:
                    samples.append(record)
                    break
        samples += [r for r in subset if r not in samples][:12-len(samples)]
        by_emd[code] = {'first':first,'count':count,'hourly':sorted([h,n] for h,n in hourly.items()),
                        'samples':[{k:(r[k][:220] if k=='sentence' else r[k]) for k in ('t','sentence','url','outlet','actions')} for r in samples[:12]]}
    webmeta = {**meta,'hourly_unit':'t_hour_start in MINUTES since time_base; floor(t/60)*60. n counts deduplicated EMD records, once regardless of action count.',
               'count_unit':'Deduplicated sentence/EMD records per action, including unresolved times.'}
    write_json(ROOT/'web/public/data/mentions.json',{'by_emd':by_emd,'unmapped':meta['unmapped'],'meta':webmeta})
    # Stable random inspection queue; judgement is authored after reading bodies.
    rng = random.Random(20250321)
    sample = rng.sample(list(enumerate(records)),min(30,len(records)))
    write_json(ROOT/'data/raw/mentions_quality_sample.json',[{'record_index':i,**r} for i,r in sample])
    print(json.dumps(meta,ensure_ascii=False,indent=2))
    return records,meta


if __name__ == '__main__':
    extract()
