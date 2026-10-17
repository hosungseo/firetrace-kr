import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type Basemap, type Layers } from './MapView'
import Timeline from './Timeline'
import Response from './Response'
import EmdDetail from './EmdDetail'
import type { EmdCollection, FireData, FireEvent, GdacsData, GwisData, KfsData, MentionsData, NewsData, OfficialData, ResponseData } from './types'
import { ACTIVE_WINDOW, T_MAX, T_MIN, compass, eventLabel, fmt, fmtDay, hourIndex, setIncident, toMinutes } from './time'
import './App.css'

const SPEEDS = [60, 180, 360] // simulated minutes per second

export interface Incident {
  id: string
  name: string
  short: string
  start: string
  end: string
  t0: string
  display_days: number
  center: [number, number]
  zoom: number
  bbox?: number[]
  sido?: string
  sigungu: string[]
  reviewed?: boolean
  files?: string[]
  stats?: Record<string, number>
}
// Fallback registry used until data/incidents.json exists (single-incident layout at data/).
const FALLBACK: Incident = { id: 'uiseong-2025', name: '2025 경북 산불 (의성 발화 → 안동·청송·영양·영덕)', short: '의성 2025', start: '2025-03-22', end: '2025-03-31', t0: '2025-03-21T00:00:00+09:00', display_days: 8, center: [129.0, 36.38], zoom: 9.2, sigungu: ['의성군', '안동시', '청송군', '영양군', '영덕군'], reviewed: true }
const idFromHash = () => decodeURIComponent(location.hash.replace(/^#/, '')) || null
const json = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null)

export default function App() {
  const [registry, setRegistry] = useState<Incident[] | null>(null)
  const [incident, setIncidentState] = useState<Incident | null>(null)
  const [base, setBase] = useState('data/')
  const [data, setData] = useState<FireData | null>(null)
  const [events, setEvents] = useState<FireEvent[]>([])
  const [news, setNews] = useState<NewsData | null>(null)
  const [emd, setEmd] = useState<EmdCollection | null>(null)
  const [kfs, setKfs] = useState<KfsData | null>(null)
  const [resp, setResp] = useState<ResponseData | null>(null)
  const [gwis, setGwis] = useState<GwisData | null>(null)
  const [gdacs, setGdacs] = useState<GdacsData | null>(null)
  const [intlNews, setIntlNews] = useState<{ gdelt_volume?: { series: [number, number, string][] } } | null>(null)
  const [focusCode, setFocusCode] = useState<string | null>(null)
  const [official, setOfficial] = useState<OfficialData | null>(null)
  const [mentions, setMentions] = useState<MentionsData | null>(null)
  const [t, setT] = useState(T_MIN + 13 * 60)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tab, setTab] = useState<'overview' | 'response' | 'emd' | 'events' | 'news' | 'compare' | 'sources'>('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const [basemap, setBasemap] = useState<Basemap>('terrain')
  const [layers, setLayers] = useState<Layers>({ gwis: true, smoke: false, emd: true, stations: true, burned: true, active: true, wind: true, events: true, terrain: true })

  // Registry → incident (from URL hash) → per-incident data directory
  useEffect(() => {
    json<{ incidents: Incident[] }>('data/incidents.json').then((reg) => {
      const list = reg?.incidents?.length ? reg.incidents : [FALLBACK]
      setRegistry(list)
      const pick = list.find((i) => i.id === idFromHash()) ?? list.find((i) => i.id === 'uiseong-2025') ?? list[0]
      setIncidentState(pick)
      setBase(reg?.incidents?.length ? `data/${pick.id}/` : 'data/')
    })
    const onHash = () => setRegistry((list) => {
      const pick = list?.find((i) => i.id === idFromHash())
      if (pick) {
        setIncidentState(pick)
        setBase(`data/${pick.id}/`)
      }
      return list
    })
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!incident) return
    setIncident(incident.t0, incident.display_days)
    setData(null); setEvents([]); setNews(null); setEmd(null); setKfs(null); setResp(null); setGwis(null); setGdacs(null); setIntlNews(null); setOfficial(null); setMentions(null)
    setSelected(null); setFocusCode(null); setPlaying(false)
    json<FireData>(base + 'fire.json').then((d) => {
      if (!d) return
      setData(d)
      setT(d.meta.first_detection.t)
    })
    json<FireEvent[]>(base + 'events.json').then((list) =>
      setEvents(
        (list ?? [])
          .map((e) => {
            const t = toMinutes(e.time)
            // A day-precision record is only "known" once that day is over; a later-published analysis is retro.
            const tv = e.time_precision === 'day' ? Math.floor(t / 1440) * 1440 + 1439 : t
            const pub = e.sources.map((s) => s.published).filter(Boolean).sort()[0]
            const retro = !!pub && toMinutes(pub + 'T00:00:00+09:00') - t > 1440
            return { ...e, t, tv, retro }
          })
          .sort((a, b) => a.t! - b.t!),
      ),
    )
    json<NewsData>(base + 'news.json').then(setNews)
    json<EmdCollection>(base + 'emd.json').then(setEmd)
    json<KfsData>(base + 'kfs_fires.json').then(setKfs)
    json<ResponseData>(base + 'response.json').then(setResp)
    json<GwisData>(base + 'intl_burned.json').then(setGwis)
    json<GdacsData>(base + 'intl_gdacs.json').then(setGdacs)
    json<OfficialData>(base + 'official.json').then(setOfficial)
    json<MentionsData>(base + 'mentions_snippets.json').then(setMentions)
    json<{ gdelt_volume?: { series: [number, number, string][] } }>(base + 'intl_news.json').then(setIntlNews)
  }, [incident, base])

  // playback
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const step = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) / 1000
        setT((cur) => {
          const nxt = cur + dt * SPEEDS[speed]
          if (nxt >= T_MAX) {
            setPlaying(false)
            return T_MAX
          }
          return nxt
        })
      }
      last.current = now
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [playing, speed])

  const stats = useMemo(() => {
    if (!data) return null
    const peak = data.area.reduce((a, b) => ((b.rate_ha_h ?? 0) > (a.rate_ha_h ?? 0) ? b : a))
    const peakIdx = data.area.indexOf(peak)
    const peakFrom = data.area[peakIdx - 1]?.t ?? peak.t
    const gust = data.weather.front.filter((f) => f.t >= T_MIN && f.t <= T_MAX).reduce((a, b) => (b.gust > a.gust ? b : a))
    const minRh = data.weather.front.filter((f) => f.t >= T_MIN && f.t <= T_MAX).reduce((a, b) => (b.rh < a.rh ? b : a))
    const obsGusts = data.stations
      .flatMap((st) => st.daily_gust.map((g) => ({ ...g, name: st.name })))
      .filter((g) => g.t >= T_MIN && g.t <= T_MAX)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
    const inWindow = data.area.filter((a) => a.t <= T_MAX)
    return { peak, peakFrom, gust, minRh, obsGusts, final: inWindow[inWindow.length - 1] }
  }, [data])

  useEffect(() => {
    document.documentElement.dataset.theme = basemap === 'night' || basemap === 'daily' ? 'dark' : 'light'
  }, [basemap])

  if (!incident || !data || !stats) return <div className="loading">데이터 불러오는 중…</div>

  const tm = Math.round(t)
  const fw = data.weather.front[hourIndex(tm, data.weather.front.length)]
  const activeCount = data.hotspots.filter((h) => h[2] <= tm && h[2] > tm - ACTIVE_WINDOW).length
  const curArea = [...data.area].reverse().find((a) => a.t <= tm)
  const sel = events.find((e) => e.id === selected)
  const officialStats = events.filter((e) => e.type === 'official_stat')
  const seen = events.filter((e) => (e.tv ?? e.t ?? 0) <= tm)
  const recentNews = news ? news.articles.filter((a) => a[0] <= tm && a[0] > tm - 60).reverse() : []
  const hitEmd = emd ? emd.features.map((f) => f.properties).filter((p) => p.first_hit != null && p.first_hit <= tm) : []
  const exposure = { n: hitEmd.length, total: hitEmd.reduce((a, p) => a + (p.total ?? 0), 0), old: hitEmd.reduce((a, p) => a + (p.age70plus ?? 0), 0) }
  const AREA = incident.sigungu.map((n) => n.replace(/[시군구]$/, ''))
  const localFires = kfs ? kfs.fires.filter((f) => AREA.includes(f.gungu) && f.t >= T_MIN && f.t <= T_MAX) : []

  const focusEmd = (code: string) => {
    setFocusCode(code)
    setTab('emd')
  }
  const focused = emd?.features.find((f) => f.properties.code === focusCode)
  const centroidOf = (geom: { coordinates: unknown }): [number, number] => {
    const pts: number[][] = []
    const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === 'number' ? pts.push(c as number[]) : Array.isArray(c) && c.forEach(walk))
    walk(geom.coordinates)
    return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  }

  const selectEvent = (id: string) => {
    const e = events.find((x) => x.id === id)
    setSelected(id)
    setTab('events')
    if (e?.t != null) setT(Math.max(T_MIN, Math.min(T_MAX, e.t)))
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▲</span> 산불 추적 <span className="sub">위성·기상·보도 종합 분석</span>
        </div>
        <div className="incident">
          {registry && registry.length > 1 ? (
            <select value={incident.id} onChange={(e) => (location.hash = e.target.value)} aria-label="산불 선택">
              {registry.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          ) : (
            incident.name
          )}
        </div>
        <div className="period">
          {incident.start.replace(/-0?/g, '.').slice(0)} – {incident.end.slice(5).replace(/-0?/, '.').replace(/^0?/, '')}
          {incident.reviewed && <span className="badge-r">보도 검토본</span>}
        </div>
        <div className="clock">{fmt(tm)}</div>
      </header>

      <main className="body">
        <section className="stage">
          <MapView key={incident.id} view={{ center: incident.center, zoom: incident.zoom }} basemap={basemap} data={data} events={events} emd={emd} kfs={kfs?.fires ?? []} gwis={gwis} focusCode={focusCode} onFocusEmd={focusEmd} t={tm} layers={layers} selected={selected} onSelectEvent={selectEvent} />
          <div className="basemap-switch" role="radiogroup" aria-label="배경지도">
            {(
              [
                ['terrain', '지형'],
                ['night', '밤'],
                ['satellite', '위성'],
                ['daily', '당일 위성'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={basemap === k ? 'on' : ''} onClick={() => setBasemap(k)} role="radio" aria-checked={basemap === k}>
                {label}
              </button>
            ))}
          </div>
          <div className="map-legend">
            <div>
              <i className="sw active" /> 최근 12시간 탐지 열점
            </div>
            <div>
              <i className="sw burned" /> 12시간 이전 탐지 열점
            </div>
            <div>
              <i className="sw wind">➜</i> 바람 (ERA5 재분석, 길이·진하기 = 풍속)
            </div>
            <div>
              <i className="sw smoke" /> 연기 (CAMS PM2.5, 진할수록 짙음)
            </div>
            <div>
              <i className="sw stn-key" /> 기상청 관측소 (시간 풍속·습도)
            </div>
            <div>
              <i className="sw origin" /> 첫 위성 탐지 지점
            </div>
            {localFires.length > 0 && (
              <div>
                <i className="sw kfs" /> 산림청 발생 기록 (위치 근사: 읍면 중심)
              </div>
            )}
            {gwis && (
              <div>
                <i className="sw gwis" /> JRC GWIS 화재 둘레 추정 (MODIS·VIIRS)
              </div>
            )}
            {emd && (
              <div>
                <i className="sw emd" /> 읍면동 (진할수록 70세 이상 비율↑, 주황 = 열점 탐지됨)
              </div>
            )}
            {events.length > 0 && (
              <div>
                <i className="sw event" /> 보도·공식 기록
              </div>
            )}
          </div>
          <div className="now-card">
            <div className="now-time">{fmt(tm)}</div>
            <div className="now-grid">
              <div>
                <b>{activeCount.toLocaleString()}</b>
                <span>최근 12h 탐지</span>
              </div>
              <div>
                <b>{curArea ? curArea.area_ha.toLocaleString() : 0}</b>
                <span>격자 환산 ha</span>
              </div>
              <div>
                <b>
                  {fw.ws.toFixed(1)}
                  <small>/{fw.gust.toFixed(0)}</small>
                </b>
                <span>{compass(fw.wd)}풍 m/s</span>
              </div>
              <div>
                <b>{Math.round(fw.rh)}%</b>
                <span>습도</span>
              </div>
              <div>
                <b>{fw.pm25 != null ? Math.round(fw.pm25) : '–'}</b>
                <span>PM2.5 µg/m³</span>
              </div>
            </div>
            {emd && (
              <div className="exposure">
                열점 탐지 읍면동 <b>{exposure.n}</b>곳 · 해당 지역 주민등록 인구 <b>{exposure.total.toLocaleString()}</b>명 · 70세 이상 <b>{exposure.old.toLocaleString()}</b>명
                <div className="exposure-note">2025년 3월 기준. 실제 피해·노출·대피 인원이 아닙니다.{activeCount === 0 ? ' 최근 탐지 없음 ≠ 진화 완료.' : ''}</div>
              </div>
            )}
          </div>
        </section>

        <aside className="panel">
          <nav className="tabs">
            {(
              [
                ['overview', '개요'],
                ['response', '대응 시차'],
                ['emd', focused ? focused.properties.emd : '읍면동'],
                ['events', `기록 ${events.length ? `(${seen.length}/${events.length})` : ''}`],
                ['news', `보도 ${news ? `(${recentNews.length})` : ''}`],
                ...(registry && registry.length > 1 ? ([['compare', '사건 비교']] as const) : []),
                ['sources', '출처'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          {tab === 'overview' && (
            <div className="pane">
              <h3>레이어</h3>
              {(
                [
                  ['active', '최근 12시간 탐지 열점'],
                  ['burned', '12시간 이전 탐지 열점'],
                  ['wind', '바람장 (재분석)'],
                  ['smoke', 'PM2.5 (CAMS 모델, 기본 꺼짐)'],
                  ['stations', '기상청 관측소'],
                  ['events', '보도·공식 기록·발생 기록'],
                  ['emd', '읍면동 경계·인구'],
                  ['gwis', 'JRC GWIS 화재 둘레 추정'],
                  ['terrain', '3D 지형'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="toggle">
                  <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}

              <h3>위성이 본 산불</h3>
              <dl className="facts">
                <dt>첫 위성 탐지</dt>
                <dd>{fmt(data.meta.first_detection.t)}</dd>
                <dt>위성 열점</dt>
                <dd>{data.meta.hotspot_count.toLocaleString()}개 (VIIRS 2기 + MODIS)</dd>
                <dt>열점 격자 환산</dt>
                <dd>{stats.final.area_ha.toLocaleString()} ha (375m 격자 × 14ha, {fmtDay(T_MAX - 1)}까지)</dd>
                <dt>신규 격자 최대 구간</dt>
                <dd>
                  {fmt(stats.peakFrom)} → {fmt(stats.peak.t)}
                  <br />
                  <b className="hot">{Math.round(stats.peak.rate_ha_h ?? 0).toLocaleString()} ha/h</b> <small>사후 계산 · 위성 통과 간격 기준</small>
                </dd>
              </dl>
              <button className="jump" onClick={() => setT(stats.peakFrom)}>
                이 구간으로 이동 →
              </button>

              <h3>바람과 습도</h3>
              <dl className="facts">
                <dt>관측 최대순간풍속</dt>
                <dd>
                  {stats.obsGusts.map((g) => (
                    <button key={g.name + g.t} className="link-row" onClick={() => setT(g.t)}>
                      <b className="hot">{g.v.toFixed(1)}</b> m/s {g.name} · {fmt(g.t)}
                    </button>
                  ))}
                </dd>
                <dt>최대 돌풍(재분석)</dt>
                <dd>
                  {stats.gust.gust.toFixed(1)} m/s · {fmt(stats.gust.t)}
                </dd>
                <dt>최저 습도</dt>
                <dd>
                  {Math.round(stats.minRh.rh)}% · {fmt(stats.minRh.t)}
                </dd>
              </dl>

              {localFires.length > 0 && (
                <>
                  <h3>산림청 발생 기록 (5개 시군)</h3>
                  {localFires.map((f) => (
                    <button key={f.start + f.jibun} className="stat-row" onClick={() => setT(f.t)}>
                      <span>
                        {fmt(f.t)} {f.gungu} {f.emd} {f.ri} · {f.cause}
                      </span>
                      <small>{f.area_ha >= 1000 ? `${Math.round(f.area_ha).toLocaleString()} ha` : `${f.area_ha} ha`}</small>
                    </button>
                  ))}
                  {incident.id === 'uiseong-2025' && (
                  <p className="note">
                    산림청은 의성 산불을 <b>2건</b>으로 기록합니다. 안평면 괴산리(11:24, 원인 '기타') 46,575.2ha와 안계면 용기리(14:40, 농산부산물소각) 52,707.3ha.
                    두 건의 합은 99,282.5ha로, 4/18 발표 잠정 피해면적 99,289ha와 6.5ha 차이가 납니다(집계 기준 미확인).
                  </p>
                  )}
                </>
              )}

              {officialStats.length > 0 && (
                <>
                  <h3>공식 통계</h3>
                  {officialStats.map((e) => (
                    <button key={e.id} className="stat-row" onClick={() => selectEvent(e.id)}>
                      <span>{e.title}</span>
                      <small>{eventLabel(e.time, 'day')}</small>
                    </button>
                  ))}
                </>
              )}
              {official && (
                <>
                  <h3>발표 수치 vs 위성 (같은 시각)</h3>
                  <table className="cmp-table">
                    <thead>
                      <tr>
                        <th>발표 시각</th>
                        <th>진화율</th>
                        <th>영향구역</th>
                        <th>열점 격자</th>
                        <th>12h 탐지</th>
                      </tr>
                    </thead>
                    <tbody>
                      {official.series.impact_area_ha
                        .filter((o) => o.t <= T_MAX)
                        .map((o) => {
                          const c = [...official.series.containment_pct].reverse().find((q) => q.t <= o.t)
                          const a = [...data.area].reverse().find((q) => q.t <= o.t)
                          const n = data.hotspots.filter((h) => h[2] <= o.t && h[2] > o.t - ACTIVE_WINDOW).length
                          return (
                            <tr key={o.id} onClick={() => selectEvent(o.id)}>
                              <td>{fmt(o.t)}</td>
                              <td>{c ? `${c.v}%` : '–'}</td>
                              <td>{o.v.toLocaleString()}</td>
                              <td>{a ? a.area_ha.toLocaleString() : 0}</td>
                              <td>{n.toLocaleString()}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                  <p className="note">영향구역·진화율은 발표 당시 수치(경북 또는 전국, 발표 주체별 기준 상이). 열점 격자는 그 시각까지의 위성 누적, 12h 탐지는 직전 12시간 열점 수.</p>
                </>
              )}

              {gdacs && gdacs.episodes.length > 0 && (
                <>
                  <h3>국제 기관 기록</h3>
                  <dl className="facts">
                    <dt>GDACS 경보</dt>
                    <dd>
                      {gdacs.episodes[0].alert_level} (낮음) · 영향 인구 추정 최대{' '}
                      {Math.max(...gdacs.episodes.map((e) => Number(e.affected_population) || 0)).toLocaleString()}명
                      <br />
                      <small>EC JRC 자동 산출. 이 앱의 읍면동 인구 합과 정의가 다름</small>
                    </dd>
                    {intlNews?.gdelt_volume && (
                      <>
                        <dt>해외 보도 비중</dt>
                        <dd>
                          {(() => {
                            const pk = [...intlNews.gdelt_volume!.series].sort((a, b) => b[1] - a[1])[0]
                            return `최고 ${pk[2].replace('-', '/')} (${pk[1].toFixed(2)}%)`
                          })()}
                          <br />
                          <small>GDELT 전 세계 모니터링 기사 중 비율, 일 단위. 국내 보도 정점(3/26)과 같은 날</small>
                        </dd>
                      </>
                    )}
                    {gwis && (
                      <>
                        <dt>GWIS 둘레</dt>
                        <dd>
                          {gwis.meta.mapped_polygon_count}개 추정 둘레, 최대 {Math.max(...gwis.features.map((f) => f.properties.source_area_ha ?? 0)).toLocaleString()} ha
                          <br />
                          <small>열점 기반 자동 둘레, 피해면적 아님</small>
                        </dd>
                      </>
                    )}
                  </dl>
                </>
              )}
              <p className="note">
                열점 격자 환산 면적은 위성이 지나간 시각(하루 2~4회)에 375m 화소로 잡힌 자리를 세어 14ha씩 더한 값입니다. 가려진 곳은 빠지고 화소 일부만 탄 곳은
                통째로 들어가므로 실제 연소면적의 상한도 하한도 아닙니다. 신규 격자 증가율은 위성 통과 간격에 좌우되는 사후 지표입니다.
              </p>
            </div>
          )}

          {tab === 'response' && resp && <Response data={resp} t={tm} onSeek={(v) => setT(Math.max(T_MIN, Math.min(T_MAX, v)))} onFocusEmd={(c) => setFocusCode(c)} />}
          {tab === 'emd' && (
            <div className="pane">
              {focused ? (
                <EmdDetail
                  p={focused.properties}
                  centroid={centroidOf(focused.geometry)}
                  data={data}
                  resp={resp}
                  mentions={mentions?.by_emd[focused.properties.code] ?? null}
                  kfs={kfs?.fires ?? []}
                  t={tm}
                  onSeek={(v) => setT(Math.max(T_MIN, Math.min(T_MAX, v)))}
                />
              ) : (
                <p className="note top">지도에서 읍면동을 클릭하거나 아래에서 고르세요.</p>
              )}
              <h3>읍면동 ({emd?.features.length ?? 0})</h3>
              <p className="rp-norecord">
                {[...(emd?.features ?? [])]
                  .sort((a, b) => (a.properties.first_hit ?? 1e9) - (b.properties.first_hit ?? 1e9))
                  .map((f) => (
                    <button key={f.properties.code} className={`chip-btn ${f.properties.first_hit != null ? 'hit' : ''} ${f.properties.code === focusCode ? 'on' : ''}`} onClick={() => setFocusCode(f.properties.code)}>
                      {f.properties.sigungu.replace(/[시군]$/, '')} {f.properties.emd}
                    </button>
                  ))}
              </p>
            </div>
          )}
          {tab === 'response' && !resp && <div className="pane"><p className="note">대응 시차 자료가 없습니다.</p></div>}

          {tab === 'events' && (
            <div className="pane">
              {events.length === 0 && <p className="note">보도·공식 기록을 모으는 중입니다.</p>}
              {sel && (
                <article className="ev-detail">
                  <div className="ev-time">
                    {eventLabel(sel.time, sel.time_precision)} {sel.official && <span className="badge">공식</span>}
                  </div>
                  <h4>{sel.title}</h4>
                  {sel.place && <div className="ev-place">{sel.place}</div>}
                  {sel.detail && <p>{sel.detail}</p>}
                  {sel.sources.map((s, i) => (
                    <blockquote key={i}>
                      {s.quote && <p>“{s.quote}”</p>}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.outlet}
                        {s.published ? ` · ${s.published}` : ''} ↗
                      </a>
                    </blockquote>
                  ))}
                </article>
              )}
              <ol className="ev-list">
                {events.map((e) => (
                  <li key={e.id} className={`${(e.tv ?? e.t ?? 0) <= tm ? 'past' : 'future'} ${e.id === selected ? 'sel' : ''}`}>
                    <button onClick={() => selectEvent(e.id)}>
                      <span className="ev-t">{eventLabel(e.time, e.time_precision)}</span>
                      <span className="ev-title">
                        {e.official && <span className="dot" />}
                        {e.title}
                        {e.retro && <span className="chip">사후 분석</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {tab === 'news' && (
            <div className="pane">
              <p className="note top">
                {fmt(tm - 60)} ~ {fmt(tm, false)} 사이 발행된 기사 {recentNews.length}건
              </p>
              <ol className="news-list">
                {recentNews.slice(0, 80).map((a) => (
                  <li key={a[3]}>
                    <a href={a[3]} target="_blank" rel="noreferrer">
                      {a[1]}
                    </a>
                    <div className="news-meta">
                      {fmt(a[0], false)} · {a[2]}
                      {a[4].map((r) => (
                        <span key={r} className="chip">
                          {news!.regions[r]}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              {recentNews.length > 80 && <p className="note">외 {recentNews.length - 80}건</p>}
            </div>
          )}

          {tab === 'compare' && registry && (
            <div className="pane">
              <p className="note top">산림청 산불발생통계 기준 피해면적 100ha 이상 산불(2023~2026). 같은 파이프라인으로 수집한 위성·인구 지표를 나란히 둡니다. 보도 검토본은 의성뿐입니다.</p>
              <table className="cmp-table cmp-inc">
                <thead>
                  <tr>
                    <th>산불</th>
                    <th>산림청 ha</th>
                    <th>열점</th>
                    <th>격자 ha</th>
                    <th>읍면동</th>
                    <th>인구</th>
                  </tr>
                </thead>
                <tbody>
                  {[...registry]
                    .sort((a, b) => (b.stats?.kfs_area_ha ?? 0) - (a.stats?.kfs_area_ha ?? 0))
                    .map((i) => (
                      <tr key={i.id} className={i.id === incident.id ? 'on' : ''} onClick={() => (location.hash = i.id)}>
                        <td>
                          {i.short}
                          {i.reviewed && <span className="dot" style={{ marginLeft: 4 }} />}
                        </td>
                        <td>{i.stats?.kfs_area_ha != null ? Math.round(i.stats.kfs_area_ha).toLocaleString() : '–'}</td>
                        <td>{i.stats?.hotspots?.toLocaleString() ?? '–'}</td>
                        <td>{i.stats?.grid_area_ha != null ? Math.round(i.stats.grid_area_ha).toLocaleString() : '–'}</td>
                        <td>{i.stats?.emd_touched ?? '–'}</td>
                        <td>{i.stats?.population_touched?.toLocaleString() ?? '–'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="note">열점·격자·읍면동·인구는 위성 열점 기반(관측 시각·화소 한계 동일). 작은 산불은 위성이 거의 못 볼 수 있어 열점 0~수 개가 정상입니다. 행을 누르면 그 산불로 이동합니다.</p>
            </div>
          )}

          {tab === 'sources' && (
            <div className="pane sources">
              <h3>데이터</h3>
              <ul>
                <li>
                  <b>NASA FIRMS</b> 위성 열점 (VIIRS S-NPP·NOAA-20 375m, MODIS 1km, 표준처리 아카이브)
                </li>
                <li>
                  <b>Open-Meteo</b> ERA5 재분석(models=era5, 원해상도 0.25°)을 0.1° 간격 84개 지점으로 요청. 시간별 풍속·풍향·돌풍·습도. 격자 평균값이라 관측소
                  순간풍속과 다름
                </li>
                <li>
                  <b>기상청 ASOS</b> 종관기상관측 6개 지점(의성·안동·청송·영덕·봉화·포항) 시간자료·일 최대순간풍속 (공공데이터포털)
                </li>
                <li>
                  <b>NASA GIBS</b> 당일 위성 영상 (VIIRS Suomi-NPP 트루컬러, 오후 1시 30분경 통과, 날짜는 슬라이더를 따름)
                </li>
                <li>
                  <b>CAMS (ECMWF)</b> 전지구 대기조성 예측 제품(약 40km, 3시간)을 Open-Meteo가 보간. PM2.5는 산불 외 발생원 포함. 기본 꺼짐
                </li>
                <li>
                  <b>AWS Terrain Tiles</b> 고도 → 3D 지형·음영기복·등고선(브라우저에서 생성, 지형 2배 과장) · <b>Esri</b> 위성영상
                </li>
                <li>
                  <b>네이버 뉴스 검색 API</b> {news ? `${news.meta.count.toLocaleString()}건` : ''} (지역×주제 48개 검색어, 관련도순 상위 1,000건씩, 발행 3/22~31). 전수가 아닌 표본입니다.
                </li>
                <li>
                  <b>언론·정부 발표</b> 원문 링크와 인용문 포함, 공식 기록은 파란 점. 대응 시차 탭은 70건을 179개 주장으로 나눠 수동 검토한 결과
                </li>
                <li>
                  <b>EC JRC GWIS</b> 근실시간 화재 둘레 추정(MODIS 1km·VIIRS 375m 열점 기반, CC BY 4.0) · <b>GDACS</b> 재난 경보·영향 인구 자동 추정
                </li>
                <li>
                  <b>NASA GIBS 가용성</b> 3/22~28 VIIRS SNPP·NOAA-20, MODIS Terra·Aqua 일별 영상 56장 모두 존재 확인
                </li>
                <li>
                  <b>산림청 산불발생통계</b> 건별 발생·진화 일시, 지번, 원인, 피해면적 (공공데이터포털). 좌표가 없어 읍면 중심에 표시
                </li>
                <li>
                  <b>행정안전부 주민등록 인구</b> 2025년 3월 읍면동 거주자, 연령대별 (공공데이터포털)
                </li>
                <li>
                  <b>읍면동 경계</b> 통계청 SGIS 행정동 경계(공공누리 1유형)를 vuski/admdongkor가 가공(CC BY 4.0), 2025-01-01판, 50m 단순화
                </li>
              </ul>
              <h3>구하지 못한 자료</h3>
              <ul>
                <li>
                  <b>재난문자 발송 이력</b>: 국민재난안전포털 아카이브는 최근 7일만 검색되고 2025년 3월은 "데이터가 존재하지 않습니다"로 응답. 재난안전데이터
                  공유플랫폼 API는 키 승인 대기. 그래서 재난문자 시각은 보도 기록에 의존합니다.
                </li>
                <li>
                  <b>기상특보 이력</b>(강풍·건조): 공공데이터포털 특보 API는 최근 6일만 제공. 기상청 API허브 키 필요.
                </li>
                <li>
                  <b>산불위험지수</b>: 공개 API가 2025년 2월까지만 제공.
                </li>
                <li>
                  <b>해외 위성 긴급지도</b>: Maxar Open Data(55개 컬렉션), Copernicus EMS(활성화 1,067건), UNOSAT 모두 이 산불 해당 없음. ReliefWeb API 403/410.
                </li>
              </ul>
              <h3>주의</h3>
              <ul>
                <li>재분석 기상은 격자 평균값이라 관측소 순간최대풍속보다 낮게 나옵니다. 관측소 위치는 근삿값입니다.</li>
                <li>"불 앞 날씨"는 최근 12시간 열점 중심에서 가장 가까운 격자의 값입니다.</li>
                <li>확산 속도는 위성 통과 사이의 열점 면적 증가분을 시간으로 나눈 값입니다.</li>
              </ul>
            </div>
          )}
        </aside>
      </main>

      <footer className="dock">
        <div className="controls">
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? '정지' : '재생'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="speed"
            onClick={() => setSpeed((speed + 1) % SPEEDS.length)}
            title="재생 속도 (1초당 시뮬레이션 시간)"
          >
            1초={SPEEDS[speed] / 60}시간
          </button>
          <button className="step" onClick={() => setT(Math.max(T_MIN, tm - 60))}>
            −1h
          </button>
          <button className="step" onClick={() => setT(Math.min(T_MAX, tm + 60))}>
            +1h
          </button>
        </div>
        <Timeline data={data} news={news} events={events} fires={localFires} official={official} showSmoke={layers.smoke} t={tm} onSeek={setT} onSelectEvent={selectEvent} />
      </footer>
    </div>
  )
}
