"""Check extraction boundary cases and reconcile all generated mention outputs."""
from collections import Counter
from datetime import datetime
import hashlib
import json
from pathlib import Path
import random
import sys
from incident import load, out_dir

from extract_mentions import (ACTIONS, BASE, CLOCK, ROOT, date_for, extract,
                              place_index, places_in, resolve_clock, split_sentences)
from fetch_article_text import BodyParser, extract_body, text_path


def fixtures():
    pub = datetime.fromisoformat('2025-04-01T11:00:00+09:00')
    cases = [
        ('31일 오후 2시 안평면 확산', '2025-03-31T14:00:00+09:00', 'explicit_day'),
        ('어제 오후 2시 길안면 대피', '2025-03-31T14:00:00+09:00', 'previous_day'),
        ('이날 오전 12시 단촌면 확산', '2025-04-01T00:00:00+09:00', 'article_day'),
        ('24일에 정오 안평면 확산', '2025-03-24T12:00:00+09:00', 'explicit_day'),
        ('오늘 3시 풍천면 대피', None, 'article_day'),
        ('이날 15시 안평면 대피', '2025-04-01T15:00:00+09:00', 'article_day'),
        ('이날 밤 1시 길안면 대피', '2025-04-01T01:00:00+09:00', 'article_day'),
        ('어제 자정 길안면 대피', '2025-03-31T00:00:00+09:00', 'previous_day'),
        ('3월 25일 오후 6시47분 석보면 대피', '2025-03-25T18:47:00+09:00', 'explicit_day'),
        ('4월 31일 오후 3시 길안면 확산', None, 'unknown'),
        ('27일 09시 길안면 대피', '2025-03-27T09:00:00+09:00', 'explicit_day'),
        ('이날 29시 길안면 확산', None, 'article_day'),
    ]
    for sentence, expected, basis in cases:
        result = resolve_clock(sentence, CLOCK.search(sentence), pub)
        assert (result['event_time'],result['date_basis']) == (expected,basis), (sentence,result)
    past_sentence = '지난 22일 오후 3시 길안면에서 대피했다.'
    assert resolve_clock(past_sentence, CLOCK.search(past_sentence), datetime.fromisoformat('2025-04-15T11:00:00+09:00'))['event_time'] == '2025-03-22T15:00:00+09:00'
    sentence = '24일 오후 3시 길안면에 확산했고 25일 오전 4시 석보면에서 대피했다.'
    matches = list(CLOCK.finditer(sentence))
    assert [resolve_clock(sentence,m,pub)['event_time'] for m in matches] == [
        '2025-03-24T15:00:00+09:00','2025-03-25T04:00:00+09:00']
    assert CLOCK.search('안평면에서 24시간 동안 확산') is None
    assert len(split_sentences('풍속 3.4m다. 길안면에 번졌다. 오후 3시 대피했다.')) == 3
    assert len(split_sentences('“오후 3시 대피했다.” 길안면에 번졌다.')) == 2
    codes,names = place_index()
    groups = places_in('오후 3시 안평면 괴산리에서 대피했고 주왕산도 통제했다.',names)
    assert len(groups) == 2 and (codes['안평면'],) in groups
    assert ('주왕산',) in groups and '주왕산면' not in groups
    fixture = '<nav>오후 3시 안평면 통제</nav><div class="articleView"><div itemprop="articleBody"><p>' + ('본문입니다. '*60) + '</p><script>evil</script></div><p>' + ('오염된 관련기사 '*100) + '</p></div>'
    body,_ = extract_body(fixture.encode())
    assert '오염된' not in body and 'evil' not in body and '통제' not in body
    short_body,_ = extract_body(('<div class=articleView><div id=articleBody>짧은 본문</div><p>' + '추천 기사 '*100 + '</p></div>').encode())
    assert short_body == '짧은 본문'
    return len(cases) + 9


def outputs():
    records = json.loads((ROOT/'data/raw/mentions_auto.json').read_text())
    meta = json.loads((ROOT/'data/raw/mentions_auto.meta.json').read_text())
    web = json.loads((ROOT/'web/public/data/mentions.json').read_text())
    assert web == json.loads((out_dir(load())/'mentions.json').read_text())
    codes,names = place_index()
    assert len(records) == meta['records']
    assert len({r['sentence'] for r in records}) == meta['sentences_kept']
    action_counts = Counter(a for r in records for a in r['actions'])
    assert {a:action_counts[a] for a in ACTIONS} == meta['records_per_action']
    assert web['unmapped'] == sum(not r['emd_codes'] for r in records)
    assert set(web['by_emd']) == set(codes.values())
    keys = set()
    source_articles = {a['url']:a for a in json.loads((ROOT/'data/raw/naver_news.json').read_text())}
    for r in records:
        key = (r['sentence'], tuple(r['emd_codes']) or (r['place_text'],))
        assert key not in keys, key
        keys.add(key)
        assert CLOCK.search(r['sentence']) and r['copies'] >= 1
        assert r['copies'] == len(set(r['copy_urls'])) and r['url'] in r['copy_urls']
        assert datetime.fromisoformat(r['published']) == min(datetime.fromisoformat(source_articles[u]['pub']) for u in r['copy_urls'])
        assert r['actions'] == [a for a,words in ACTIONS.items() if any(w in r['sentence'] for w in words)]
        assert r['sentence'] in ' '.join(text_path(r['url']).read_text().split()), r['url']
        assert r['date_basis'] in {'explicit_day','article_day','previous_day','unknown'}
        if r['t'] is not None:
            assert int((datetime.fromisoformat(r['event_time'])-BASE).total_seconds()/60) == r['t']
        else:
            assert r['event_time'] is None
        assert r['time_text'] == r['time_mentions'][r['selected_time_index']]['time_text']
    for code, row in web['by_emd'].items():
        subset = [r for r in records if code in r['emd_codes']]
        assert len(row['samples']) <= 12 and all(len(r['sentence']) <= 220 for r in row['samples'])
        assert row['hourly'] == sorted([h,n] for h,n in Counter((r['t']//60)*60 for r in subset if r['t'] is not None).items())
        for action in ACTIONS:
            assert row['count'][action] == sum(action in r['actions'] for r in subset)
            assert row['first'][action] == min((r['t'] for r in subset if action in r['actions'] and r['t'] is not None),default=None)
    return {'records':len(records),'sentences':meta['sentences_kept'],'emd_covered':meta['emd_covered']}


if __name__ == '__main__':
    print(json.dumps({'boundary_cases_passed':fixtures(),'outputs_checked':outputs()},ensure_ascii=False))
