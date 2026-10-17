import type { EmdProps, FireData, FullMentionEmd, KfsFire, MentionEmd, ResponseData, SlimClaim } from './types'
import { fmt, fmtDay, hourIndex, kst } from './time'

interface Props {
  p: EmdProps
  centroid: [number, number]
  data: FireData
  resp: ResponseData | null
  mentions: MentionEmd | null
  full: FullMentionEmd | null
  kfs: KfsFire[]
  t: number
  onSeek: (t: number) => void
}

const ACTION_KO: Record<string, string> = { spread: '확산', evacuation: '대피', alert: '재난문자', control: '통제', containment: '진화', casualty: '인명' }
const DEC = ['0', '10', '20', '30', '40', '50', '60', '70', '80', '90', '100+']

const g0len = (d: FireData) => d.weather.grid[0]?.ws.length ?? Infinity

export default function EmdDetail({ p, centroid, data, resp, mentions, full, kfs, t, onSeek }: Props) {
  const row = resp?.rows.find((r) => r.code === p.code)
  const claims: SlimClaim[] = row?.claims ?? []
  const fires = kfs.filter((f) => f.si === '경북' && p.sigungu.startsWith(f.gungu) && p.emd.startsWith(f.emd))
  const hi = hourIndex(t, g0len(data))
  const st = [...data.stations].sort((a, b) => (a.lon - centroid[0]) ** 2 + (a.lat - centroid[1]) ** 2 - ((b.lon - centroid[0]) ** 2 + (b.lat - centroid[1]) ** 2))[0]
  const km = st ? Math.round(Math.hypot((st.lon - centroid[0]) * 89, (st.lat - centroid[1]) * 111)) : null
  const g = data.weather.grid.reduce((a, b) => ((b.lat - centroid[1]) ** 2 + (b.lon - centroid[0]) ** 2 < (a.lat - centroid[1]) ** 2 + (a.lon - centroid[0]) ** 2 ? b : a))
  const maxDec = Math.max(1, ...(p.decades ?? [1]))
  const maxDaily = Math.max(1, ...(p.daily ?? []).map(([, n]) => n))
  const hotspotsSoFar = (p.daily ?? []).filter(([d]) => d < t).reduce((a, [, n]) => a + n, 0)
  const mentionsSoFar = mentions ? mentions.hourly.filter(([h]) => h <= t).reduce((a, [, n]) => a + n, 0) : 0

  return (
    <div className="ed">
      <header className="ed-head">
        <h2>
          {p.sigungu} {p.emd}
        </h2>
        <span className="ed-code">행정동 코드 {p.code}</span>
      </header>

      <section>
        <h3>주민 (2025년 3월 주민등록)</h3>
        <div className="ed-kpis">
          <div>
            <b>{p.total?.toLocaleString() ?? '–'}</b>
            <span>전체</span>
          </div>
          <div>
            <b>{p.age70plus?.toLocaleString() ?? '–'}</b>
            <span>70세 이상 ({p.age70share != null ? Math.round(p.age70share * 100) : '–'}%)</span>
          </div>
        </div>
        {p.decades && (
          <div className="ed-bars" title="연령대별 주민 수">
            {p.decades.map((n, i) => (
              <div key={i} className="ed-bar">
                <i style={{ height: `${(n / maxDec) * 100}%` }} className={i >= 7 ? 'old' : ''} />
                <span>{DEC[i]}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>위성 열점 (경계 안)</h3>
        <dl className="facts">
          <dt>첫 탐지</dt>
          <dd>
            {p.first_hit != null ? (
              <button className="link-row" onClick={() => onSeek(p.first_hit!)}>
                {fmt(p.first_hit)} ({p.first_viirs === p.first_hit ? 'VIIRS 375m' : 'MODIS 1km'})
              </button>
            ) : (
              '없음'
            )}
          </dd>
          {p.first_viirs != null && p.first_modis != null && p.first_viirs !== p.first_modis && (
            <>
              <dt>센서별</dt>
              <dd>
                VIIRS {fmt(p.first_viirs)} · MODIS {fmt(p.first_modis)}
              </dd>
            </>
          )}
          <dt>누적 탐지</dt>
          <dd>
            {hotspotsSoFar.toLocaleString()} / {p.hotspots.toLocaleString()}개 (선택 시각까지 / 전체)
          </dd>
        </dl>
        {p.daily && p.daily.length > 0 && (
          <div className="ed-days">
            {p.daily.map(([d, n]) => (
              <div key={d} className="ed-day" title={`${fmtDay(d)}: 열점 ${n}개`}>
                <i style={{ height: `${(n / maxDaily) * 100}%` }} className={d < t ? 'past' : ''} />
                <span>{kst(d).d}일</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>선택 시각 기상 (가장 가까운 자료)</h3>
        <dl className="facts">
          <dt>재분석 격자</dt>
          <dd>
            {g.ws[hi].toFixed(1)} m/s · 돌풍 {g.gust[hi].toFixed(1)} · 습도 {Math.round(g.rh[hi])}%
          </dd>
          {st && (
            <>
              <dt>{st.name} 관측소</dt>
              <dd>
                {st.ws[hi] != null ? `${st.ws[hi]!.toFixed(1)} m/s · 습도 ${st.rh[hi] ?? '–'}%` : '결측'} <small>({km} km)</small>
              </dd>
            </>
          )}
        </dl>
      </section>

      {fires.length > 0 && (
        <section>
          <h3>산림청 발생 기록</h3>
          {fires.map((f) => (
            <button key={f.start + f.jibun} className="stat-row" onClick={() => onSeek(f.t)}>
              <span>
                {fmt(f.t)} {f.ri} {f.jibun} · {f.cause}
              </span>
              <small>{f.area_ha.toLocaleString()} ha</small>
            </button>
          ))}
        </section>
      )}

      <section>
        <h3>검토된 기록 ({claims.length})</h3>
        {claims.length === 0 && <p className="note">70건 보도·공식 기록 중 이 읍면동을 지목한 시각 기록이 없습니다.</p>}
        {claims.map((c) => (
          <div key={c.claim_id} className="ed-claim">
            <button className="link-row" onClick={() => c.t != null && onSeek(c.t)}>
              <b>{c.t != null ? fmt(c.t) : '시각 미상'}</b> · {ACTION_KO[c.action] ?? c.action}
              {c.approximate ? ' (근사)' : ''}
            </button>
            {c.quote && <blockquote>“{c.quote.length > 160 ? c.quote.slice(0, 160) + '…' : c.quote}”</blockquote>}
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer">
                원문 ↗
              </a>
            )}
          </div>
        ))}
      </section>

      {full && (
        <section>
          <h3>기사 본문 문장 (자동 추출 · 표본 정밀도 약 67%)</h3>
          <table className="ed-table">
            <thead>
              <tr>
                <th>행위어</th>
                <th>문장</th>
                <th>가장 이른 사건 시각</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(full.first)
                .filter(([k]) => (full.count[k] ?? 0) > 0)
                .sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9))
                .map(([k, v]) => (
                  <tr key={k}>
                    <td>{ACTION_KO[k] ?? k}</td>
                    <td>{full.count[k]}</td>
                    <td>
                      {v != null ? (
                        <button className="link-row" onClick={() => onSeek(v)}>
                          {fmt(v)}
                        </button>
                      ) : (
                        '시각 미상'
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <ul className="ed-sentences">
            {[...full.samples]
              .sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9))
              .slice(0, 8)
              .map((r, i) => (
                <li key={i} className={r.t != null && r.t <= t ? 'past' : ''}>
                  <span className="ed-st">{r.t != null ? fmt(r.t) : '시각 미상'}</span>
                  <span className="ed-sent">{r.sentence.length > 180 ? r.sentence.slice(0, 180) + '…' : r.sentence}</span>
                  <small>
                    {r.actions.map((a) => ACTION_KO[a] ?? a).join('·')} ·{' '}
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.outlet.replace(/^www\./, '')} ↗
                    </a>
                  </small>
                </li>
              ))}
          </ul>
          <p className="note">문장 안의 시각·지명·행위어를 기계로 묶은 후보입니다. 30건 표본 검토에서 20건이 맞았습니다(다른 사건의 시각이 붙거나 날짜가 어긋나는 경우가 있음). 확정 기록이 아니라 확인할 단서로 쓰세요.</p>
        </section>
      )}

      <section>
        <h3>보도 언급 (요약문 기반·미검토)</h3>
        {!mentions ? (
          <p className="note">이 읍면동을 언급한 기사 요약이 없습니다.</p>
        ) : (
          <>
            <p className="ed-mention-sum">
              기사 {mentionsSoFar.toLocaleString()} / {mentions.articles.toLocaleString()}건 (선택 시각까지 / 전체)
            </p>
            <table className="ed-table">
              <thead>
                <tr>
                  <th>행위어</th>
                  <th>건수</th>
                  <th>첫 보도 (발행 시각)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(mentions.first)
                  .sort((a, b) => a[1] - b[1])
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>{ACTION_KO[k] ?? k}</td>
                      <td>{mentions.count[k]}</td>
                      <td>
                        <button className="link-row" onClick={() => onSeek(v)}>
                          {fmt(v)}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <ul className="ed-samples">
              {mentions.samples.slice(0, 6).map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>
                  <small>
                    {fmt(s.t)} · {s.actions.map((a) => ACTION_KO[a] ?? a).join('·')}
                  </small>
                </li>
              ))}
            </ul>
            <p className="note">요약문 150자에 지명과 행위어가 같이 있는 기사의 발행 시각입니다. 사건 시각이 아니며 같은 문장이라는 보장도 없습니다.</p>
          </>
        )}
      </section>
    </div>
  )
}
