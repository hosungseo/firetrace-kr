"""Compact incident-month MOIS administrative-dong resident population."""
from incident import cli, raw_dir, out_dir, read, compact


def main(inc):
    rows=read(raw_dir(inc)/'population_emd.json',[]);out=[]
    def num(v):return None if v in ('',None) else int(str(v).replace(',',''))
    for r in rows:
        decades=[]
        for dec in range(0,101,10):
            values=[num(r.get(f'{sex}{dec}AgeNmprCnt')) for sex in ('male','feml')]
            decades.append(sum(values) if all(v is not None for v in values) else None)
        def age(index):return sum(decades[index:]) if all(v is not None for v in decades[index:]) else None
        out.append({'code':str(r['admmCd']),'sigungu':r['sggNm'],'emd':r['dongNm'],'total':num(r['totNmprCnt']),
                    'age60plus':age(6),'age70plus':age(7),'decades':decades,'male':num(r['maleNmprCnt']),'female':num(r['femlNmprCnt'])})
    compact(out_dir(inc)/'population.json',{'period':inc['start'][:7],'source':'행정안전부 주민등록 인구(읍면동, 거주자)','rows':out})
    print(inc['id'],'population',len(out),'emd',flush=True)


if __name__=='__main__':main(cli(__doc__))
