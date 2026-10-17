"""Fetch MOIS administrative-dong residents for the incident's ignition month."""
import urllib.parse
from incident import (cli, raw_dir, compact, read, api_json, secret, blocked,
                      clear_blocked, SourceError)

BASE='https://apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn'


def items(response):
    if 'response' in response:
        body=response['response'].get('body',{})
        value=body.get('items',{})
        return value.get('item',[]) if isinstance(value,dict) else value,body.get('totalCount')
    data=response.get('Response',response)
    if isinstance(data,list):data=data[0]
    if 'items' in data:
        head=data.get('head',{})
        if head.get('resultCode') not in ('0','00',None):
            raise SourceError(f'MOIS: {head.get("resultCode")} {head.get("resultMsg")}')
        value=data['items'];return (value.get('item',[]) if isinstance(value,dict) else value or []),head.get('totalCount')
    raise SourceError('MOIS: response has no items (see cached body)')


def historical_code(code, month):
    # Gangwon special-autonomy prefix changed 42 -> 51 on 2023-06-11.
    return '42'+code[2:] if code.startswith('51') and month<'202306' else code


def fetch(inc):
    month=inc['start'][:7].replace('-','');path=raw_dir(inc)/'population_emd.json'
    mp=path.with_suffix('.meta.json');spec={'month':month,'sigungu_codes':inc['sigungu_codes']}
    if path.exists() and read(mp,{}).get('request')==spec and read(mp,{}).get('complete'):return read(path)
    key=urllib.parse.unquote(secret('data-go-kr-firetrace-key'));rows=[];failures=[]
    for code in inc['sigungu_codes']:
        query_code=historical_code(code,month)
        for page in range(1,50):
            params={'serviceKey':key,'pageNo':page,'numOfRows':1000,'type':'JSON','year':month[:4],'month':month[4:],
                    'statsYm':month,'srchFrYm':month,'srchToYm':month,
                    'admmCd':query_code+'00000','lv':3,'regSeCd':1}
            try:
                data=api_json(inc,'data_go_kr',BASE+'?'+urllib.parse.urlencode(params),secrets=(key,),interval=.4)
                got,total=items(data)
                if isinstance(got,dict):got=[got]
                if not got and page==1:raise SourceError(f'MOIS returned no residents for {query_code} {month}')
                for r in got:
                    r['sigungu_code_at_source']=str(r['admmCd'])[:5]
                    # Normalize the changed prefix for the pinned boundary join.
                    if code.startswith('51') and str(r['admmCd']).startswith('42'):r['admmCd']='51'+str(r['admmCd'])[2:]
                    if str(r['admmCd'])[:5]!=code or r.get('statsYm')!=month:
                        raise SourceError('MOIS ignored requested region/month')
                rows.extend(got)
                if len(got)<1000 or (total is not None and page*1000>=int(total)):break
            except SourceError as exc:
                failures.append(str(exc));break
    compact(path,rows);compact(mp,{'request':spec,'complete':not failures,'period':inc['start'][:7],'rows':len(rows),'source':BASE,
                                 'licence':'공공누리 제1유형 (data.go.kr)', 'caveat':'lv=3, regSeCd=1; Gangwon historical prefix normalized to the 2025 boundary snapshot.'})
    if failures:blocked(inc,'population','\n'.join(failures))
    else:clear_blocked(inc,'population')
    print(inc['id'],'population',len(rows),flush=True)
    return rows


if __name__=='__main__':fetch(cli(__doc__))
