"""Collect date-filtered Naver title/snippet samples for one wildfire incident."""
import html
import re
import urllib.parse
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from incident import (KST, cli, raw_dir, read, compact, secret, api_json, blocked,
                      clear_blocked, SourceError)

TERMS=['산불','산불 대피','산불 진화율','산불 강풍','산불 재난문자','산불 확산']


def fetch(inc):
    queries=[f'{region} {term}' for region in inc['sigungu'] for term in TERMS]+[inc['sido']+' 산불']
    lo=datetime.fromisoformat(inc['start']).replace(tzinfo=KST)
    hi=datetime.fromisoformat(inc['end']).replace(tzinfo=KST)+timedelta(days=4)
    path=raw_dir(inc)/'naver_news.json';mp=path.with_suffix('.meta.json')
    spec={'queries':queries,'start':lo.isoformat(),'end_exclusive':hi.isoformat()}
    if path.exists() and read(mp,{}).get('request')==spec and read(mp,{}).get('complete'):return read(path)
    env={}
    for line in secret('naver-api.env').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k,v=line.removeprefix('export ').split('=',1);env[k.strip()]=v.strip().strip('\"\'')
    hdr={'X-Naver-Client-Id':env['NAVER_CLIENT_ID'],'X-Naver-Client-Secret':env['NAVER_CLIENT_SECRET']}
    clean=lambda s:html.unescape(re.sub(r'<[^>]+>','',s))
    arts={a['url']:a for a in read(path,[]) if lo<=datetime.fromisoformat(a['pub'])<hi}
    failures=[];scanned=0
    for query in queries:
        for page in range(1,1001,100):
            url='https://openapi.naver.com/v1/search/news.json?'+urllib.parse.urlencode({'query':query,'display':100,'start':page,'sort':'sim'})
            try:
                data=api_json(inc,'naver',url,headers=hdr,interval=.15,timeout=30,secrets=tuple(env.values()))
                if 'items' not in data:raise SourceError('NAVER error response (see cached body)')
                items=data['items'];scanned+=len(items)
                for it in items:
                    pub=parsedate_to_datetime(it['pubDate']).astimezone(KST)
                    if lo<=pub<hi:
                        url=it.get('originallink') or it['link']
                        if url not in arts:arts[url]={'title':clean(it['title']),'desc':clean(it['description']),'url':url,'naver':it['link'],'pub':pub.isoformat(),'queries':[]}
                        if query not in arts[url]['queries']:arts[url]['queries'].append(query)
                if len(items)<100:break
            except SourceError as exc:failures.append(f'{query} page {page}: {exc}');break
    values=sorted(arts.values(),key=lambda a:a['pub']);compact(path,values)
    compact(mp,{'request':spec,'complete':not failures,'rows':len(values),'items_scanned':scanned,'source':'NAVER News Search API','caveat':'Similarity-ranked top 1000 per query; local publication-date filter. A historical search sample, not exhaustive coverage. Article rights remain with publishers.'})
    if failures:blocked(inc,'naver_news','\n'.join(failures))
    else:clear_blocked(inc,'naver_news')
    print(inc['id'],'news',len(values),flush=True)
    return values


if __name__=='__main__':fetch(cli(__doc__))
