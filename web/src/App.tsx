import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type Layers } from './MapView'
import Timeline from './Timeline'
import type { FireData, FireEvent, NewsData } from './types'
import { ACTIVE_WINDOW, T_MAX, T_MIN, compass, eventLabel, fmt, hourIndex, toMinutes } from './time'
import './App.css'

const SPEEDS = [60, 180, 360] // simulated minutes per second

export default function App() {
  const [data, setData] = useState<FireData | null>(null)
  const [events, setEvents] = useState<FireEvent[]>([])
  const [news, setNews] = useState<NewsData | null>(null)
  const [t, setT] = useState(T_MIN + 13 * 60)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tab, setTab] = useState<'overview' | 'events' | 'news' | 'sources'>('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const [layers, setLayers] = useState<Layers>({ stations: true, burned: true, active: true, wind: true, events: true, terrain: true })

  useEffect(() => {
    fetch('data/fire.json')
      .then((r) => r.json())
      .then((d: FireData) => {
        setData(d)
        setT(d.meta.first_detection.t)
      })
    fetch('data/events.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: FireEvent[]) => setEvents(list.map((e) => ({ ...e, t: toMinutes(e.time) })).sort((a, b) => a.t! - b.t!)))
      .catch(() => setEvents([]))
    fetch('data/news.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(setNews)
      .catch(() => setNews(null))
  }, [])

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
    return { peak, peakFrom, gust, minRh, obsGusts, final: data.area[data.area.length - 1] }
  }, [data])

  if (!data || !stats) return <div className="loading">데이터 불러오는 중…</div>

  const tm = Math.round(t)
  const fw = data.weather.front[hourIndex(tm)]
  const activeCount = data.hotspots.filter((h) => h[2] <= tm && h[2] > tm - ACTIVE_WINDOW).length
  const curArea = [...data.area].reverse().find((a) => a.t <= tm)
  const sel = events.find((e) => e.id === selected)
  const officialStats = events.filter((e) => e.type === 'official_stat')
  const seen = events.filter((e) => (e.t ?? 0) <= tm)
  const recentNews = news ? news.articles.filter((a) => a[0] <= tm && a[0] > tm - 60).reverse() : []

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
        <div className="incident">2025 경북 산불 (의성 발화 → 안동·청송·영양·영덕)</div>
        <div className="period">2025.3.22 – 3.28</div>
        <div className="clock">{fmt(tm)}</div>
      </header>

      <main className="body">
        <section className="stage">
          <MapView data={data} events={events} t={tm} layers={layers} selected={selected} onSelectEvent={selectEvent} />
          <div className="map-legend">
            <div>
              <i className="sw active" /> 최근 12시간 위성 열점
            </div>
            <div>
              <i className="sw burned" /> 그 이전 열점(연소 흔적)
            </div>
            <div>
              <i className="sw wind">➜</i> 바람 (ERA5 재분석, 길이·진하기 = 풍속)
            </div>
            <div>
              <i className="sw stn-key" /> 기상청 관측소 (시간 풍속·습도)
            </div>
            <div>
              <i className="sw origin" /> 첫 위성 탐지 지점
            </div>
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
                <span>활성 열점</span>
              </div>
              <div>
                <b>{curArea ? curArea.area_ha.toLocaleString() : 0}</b>
                <span>누적 ha</span>
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
            </div>
          </div>
        </section>

        <aside className="panel">
          <nav className="tabs">
            {(
              [
                ['overview', '개요'],
                ['events', `기록 ${events.length ? `(${seen.length}/${events.length})` : ''}`],
                ['news', `보도 ${news ? `(${recentNews.length})` : ''}`],
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
                  ['active', '활성 열점'],
                  ['burned', '연소 흔적'],
                  ['wind', '바람장 (재분석)'],
                  ['stations', '기상청 관측소'],
                  ['events', '보도·공식 기록'],
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
                <dt>열점 누적 면적</dt>
                <dd>{stats.final.area_ha.toLocaleString()} ha (하한 추정)</dd>
                <dt>가장 빨랐던 구간</dt>
                <dd>
                  {fmt(stats.peakFrom)} → {fmt(stats.peak.t)}
                  <br />
                  <b className="hot">{Math.round(stats.peak.rate_ha_h ?? 0).toLocaleString()} ha/h</b>
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
              <p className="note">
                열점 면적은 위성이 지나간 시각(하루 2~4회)에 375m 화소로 잡힌 불만 셉니다. 연기·구름에 가린 곳이 빠져서 공식 피해 면적보다 작게
                나옵니다.
              </p>
            </div>
          )}

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
                  <li key={e.id} className={`${(e.t ?? 0) <= tm ? 'past' : 'future'} ${e.id === selected ? 'sel' : ''}`}>
                    <button onClick={() => selectEvent(e.id)}>
                      <span className="ev-t">{eventLabel(e.time, e.time_precision)}</span>
                      <span className="ev-title">
                        {e.official && <span className="dot" />}
                        {e.title}
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

          {tab === 'sources' && (
            <div className="pane sources">
              <h3>데이터</h3>
              <ul>
                <li>
                  <b>NASA FIRMS</b> 위성 열점 (VIIRS S-NPP·NOAA-20 375m, MODIS 1km, 표준처리 아카이브)
                </li>
                <li>
                  <b>Open-Meteo</b> ERA5 재분석 기상, 0.1° 격자 84개 지점, 시간별 풍속·풍향·돌풍·습도
                </li>
                <li>
                  <b>기상청 ASOS</b> 종관기상관측 6개 지점(의성·안동·청송·영덕·봉화·포항) 시간자료·일 최대순간풍속 (공공데이터포털)
                </li>
                <li>
                  <b>AWS Terrain Tiles</b> 고도 (3D 지형) · <b>Esri</b> 위성영상
                </li>
                <li>
                  <b>네이버 뉴스 검색 API</b> {news ? `${news.meta.count.toLocaleString()}건` : ''} (지역×주제 48개 검색어, 관련도순 상위 1,000건씩, 발행 3/22~31). 전수가 아닌 표본입니다.
                </li>
                <li>
                  <b>언론·정부 발표</b> 원문 링크와 인용문 포함, 공식 기록은 파란 점
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
        <Timeline data={data} news={news} events={events} t={tm} onSeek={setT} onSelectEvent={selectEvent} />
      </footer>
    </div>
  )
}
