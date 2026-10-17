import { useEffect, useMemo, useRef, useState } from 'react'
import MapView, { type Basemap, type FlyTarget, type Layers } from './MapView'
import Timeline from './Timeline'
import Response from './Response'
import EmdDetail from './EmdDetail'
import type { EmdCollection, FfasData, FireData, FireEvent, ForestTypeData, Gk2aData, SpreadData, FullMentionsData, GdacsData, GwisData, KfsData, MentionsData, NewsData, OfficialData, ResponseData } from './types'
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
  const [full, setFull] = useState<FullMentionsData | null>(null)
  const [ffas, setFfas] = useState<FfasData | null>(null)
  const [forest, setForest] = useState<ForestTypeData | null>(null)
  const [spread, setSpread] = useState<SpreadData | null>(null)
  const [gk2a, setGk2a] = useState<Gk2aData | null>(null)
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null)
  const [chase, setChase] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [t, setT] = useState(T_MIN + 13 * 60)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [tab, setTab] = useState<'overview' | 'response' | 'emd' | 'events' | 'news' | 'compare' | 'sources'>('overview')
  const [selected, setSelected] = useState<string | null>(null)
  const [basemap, setBasemap] = useState<Basemap>('terrain')
  const [layers, setLayers] = useState<Layers>({ gwis: true, smoke: false, emd: true, stations: true, burned: true, active: true, wind: true, events: true, terrain: true, situation: true, forest: false, spread: true, gk2a: true })

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
    setData(null); setEvents([]); setNews(null); setEmd(null); setKfs(null); setResp(null); setGwis(null); setGdacs(null); setIntlNews(null); setOfficial(null); setMentions(null); setFull(null); setFfas(null); setForest(null); setSpread(null); setGk2a(null); setChase(false); setFlyTarget(null)
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
    json<FullMentionsData>(base + 'mentions.json').then(setFull)
    json<FfasData>(base + 'ffas.json').then(setFfas)
    json<ForestTypeData>(base + 'forest_type.json').then(setForest)
    json<SpreadData>(base + 'spread.json').then(setSpread)
    json<Gk2aData>(base + 'gk2a.json').then(setGk2a)
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

  // Key scenes: each one sets the clock and flies the camera (FireTrace-style)
  const scenes = useMemo(() => {
    if (!data) return []
    const out: { label: string; sub: string; t: number; center: [number, number]; zoom: number; pitch: number; bearing?: number }[] = []
    const main = ffas?.members.find((m) => m.matched)
    const ign: [number, number] = main?.lonlat ?? [data.meta.first_detection.lon, data.meta.first_detection.lat]
    if (main?.reported) out.push({ label: '발화·신고', sub: main.address?.split(' ').slice(1, 4).join(' ') ?? '', t: toMinutes(main.reported), center: ign, zoom: 12.5, pitch: 62 })
    if (gk2a?.pixels.length) {
      const first = gk2a.pixels.reduce((a, b) => (b[2] < a[2] ? b : a))
      out.push({ label: '천리안 첫 탐지', sub: '정지궤도 위성, 10분 간격', t: first[2], center: [first[0], first[1]], zoom: 11.5, pitch: 55 })
    }
    out.push({ label: '극궤도 위성 첫 탐지', sub: 'VIIRS 375m', t: data.meta.first_detection.t, center: [data.meta.first_detection.lon, data.meta.first_detection.lat], zoom: 11.5, pitch: 55 })
    const f = gk2a?.fastest_hour
    if (f && gk2a) {
      const a = gk2a.head.find((h) => h[0] >= f.t_from)
      const b = gk2a.head.find((h) => h[0] >= f.t_to)
      if (a && b) {
        const br = (Math.atan2((b[1] - a[1]) * Math.cos((a[2] * Math.PI) / 180), b[2] - a[2]) * 180) / Math.PI
        out.push({ label: '가장 빨랐던 1시간', sub: `선두 ${f.kmh.toFixed(1)} km/h`, t: f.t_from, center: [(a[1] + b[1]) / 2, (a[2] + b[2]) / 2], zoom: 10.3, pitch: 65, bearing: br })
      }
    }
    const longest = spread?.vectors.filter((v) => v.head).sort((x, y) => y.km - x.km)[0]
    if (longest && longest.km >= 3) out.push({ label: '위성 통과 사이 최장 전진', sub: `${longest.km.toFixed(1)} km`, t: longest.t, center: [(longest.from[0] + longest.to[0]) / 2, (longest.from[1] + longest.to[1]) / 2], zoom: 9.6, pitch: 55, bearing: longest.bearing })
    const g = stats?.obsGusts[0]
    const st = g && data.stations.find((x) => x.name === g.name)
    if (g && st) out.push({ label: '관측 최대순간풍속', sub: `${g.name} ${g.v.toFixed(1)} m/s`, t: g.t, center: [st.lon, st.lat], zoom: 10.5, pitch: 55 })
    if (main?.extinguished) out.push({ label: '주불 진화', sub: '산림청 기록', t: toMinutes(main.extinguished), center: incident ? incident.center : ign, zoom: incident ? incident.zoom : 9.5, pitch: 45, bearing: -8 })
    return out.filter((x) => x.t >= T_MIN - 1440 && x.t <= T_MAX + 1440).sort((x, y) => x.t - y.t)
  }, [data, ffas, gk2a, spread, stats, incident])
  const goScene = (sc: (typeof scenes)[number]) => {
    setPlaying(false); setChase(false)
    setT(Math.max(T_MIN, Math.min(T_MAX, sc.t)))
    setFlyTarget({ key: Date.now(), center: sc.center, zoom: sc.zoom, pitch: sc.pitch, bearing: sc.bearing })
  }
  // GK2A fire head at the current minute, plus the last-hour advance and ERA5 wind at its position
  const head = useMemo(() => {
    if (!gk2a || !data) return null
    const h = [...gk2a.head].reverse().find((x) => x[0] <= t)
    if (!h || t - h[0] > 180) return null
    const prev = [...gk2a.reach].reverse().find((r) => r[0] <= h[0] - 60)
    const nowReach = [...gk2a.reach].reverse().find((r) => r[0] <= h[0])
    const g = data.weather.grid.reduce((a, b) => ((b.lon - h[1]) ** 2 + (b.lat - h[2]) ** 2 < (a.lon - h[1]) ** 2 + (a.lat - h[2]) ** 2 ? b : a))
    const i = Math.max(0, Math.min(g.ws.length - 1, data.weather.hours.findIndex((x) => x > t) - 1))
    return { t: h[0], lon: h[1], lat: h[2], km: h[3], reach: nowReach?.[1] ?? h[3], kmh: prev && nowReach ? Math.max(0, nowReach[1] - prev[1]) : null, ws: g.ws[i], wd: g.wd[i], rh: g.rh[i] }
  }, [gk2a, data, t])

  // Keyboard: Space play/pause · ←/→ ±1h (Shift ±10min) · 1–9 scenes · L layers · Esc close
  const sceneRef = useRef(scenes)
  useEffect(() => { sceneRef.current = scenes }, [scenes])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const step = e.shiftKey ? 10 : 60
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setT((v) => Math.min(T_MAX, Math.round(v) + step)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setT((v) => Math.max(T_MIN, Math.round(v) - step)) }
      else if (/^[1-9]$/.test(e.key)) {
        const sc = sceneRef.current[Number(e.key) - 1]
        if (sc) {
          setPlaying(false); setChase(false); setTab('overview')
          setT(Math.max(T_MIN, Math.min(T_MAX, sc.t)))
          setFlyTarget({ key: Date.now(), center: sc.center, zoom: sc.zoom, pitch: sc.pitch, bearing: sc.bearing })
        }
      } else if (e.key === 'l' || e.key === 'L') setLayersOpen((o) => !o)
      else if (e.key === 'Escape') { setLayersOpen(false); setLegendOpen(false); setChase(false) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

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
          <span className="logo">▲</span> 산불추적기 <span className="sub">위성·기상·보도 종합 분석</span>
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
          <MapView key={incident.id} view={{ center: incident.center, zoom: incident.zoom }} basemap={basemap} data={data} events={events} emd={emd} kfs={kfs?.fires ?? []} gwis={gwis} ffas={ffas} forest={forest} spread={spread} gk2a={gk2a} dataBase={base} flyTarget={flyTarget} chase={chase} focusCode={focusCode} onFocusEmd={focusEmd} t={tm} layers={layers} selected={selected} onSelectEvent={selectEvent} />
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
          <button className={`layers-btn ${layersOpen ? 'on' : ''}`} onClick={() => setLayersOpen((o) => !o)} aria-expanded={layersOpen}>
            레이어
          </button>
          {layersOpen && (
            <div className="layers-pop">
              {(
                [
                  ['불과 위성', [['gk2a', '천리안 2A 10분 탐지·선두'], ['spread', '확산 경로·피해 범위'], ['active', '최근 12시간 열점'], ['burned', '그 이전 열점'], ['situation', '산림청 상황도'], ['gwis', 'JRC GWIS 둘레']]],
                  ['날씨', [['wind', '바람장 (재분석)'], ['stations', '기상청 관측소'], ['smoke', 'PM2.5 (CAMS)']]],
                  ['땅과 사람', [['emd', '읍면동·인구'], ['forest', '숲 종류 (임상도)'], ['terrain', '3D 지형']]],
                  ['기록', [['events', '보도·공식·발생 기록']]],
                ] as const
              ).map(([group, items]) => (
                <div key={group}>
                  <h4>{group}</h4>
                  {items.map(([k, label]) => (
                    <label key={k} className="toggle">
                      <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
                      {label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
          <button className="legend-btn" onClick={() => setLegendOpen((o) => !o)}>{legendOpen ? '범례 닫기' : '범례'}</button>
          <div className="map-legend" hidden={!legendOpen}>
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
            {gk2a && layers.gk2a && gk2a.pixels.length > 0 && (
              <div>
                <i className="sw gk2a" /> 천리안 2A 산불탐지(2km, 최근 30분) · 하늘색 선 = 발화점에서 가장 멀리 간 불의 경로
              </div>
            )}
            {spread && layers.spread && spread.perimeters.length > 0 && (
              <div>
                <i className="sw perim" /> 피해 범위(위성 열점 375m 칸을 이어 그린 추정 경계, 통과 시각 기준)
              </div>
            )}
            {spread && layers.spread && spread.summary.major > 0 && (
              <div>
                <i className="sw spread" /> 확산 경로: 칸 색 = 첫 탐지 시각(노랑→진홍), 굵은 화살표 = 통과별 최장 전진
              </div>
            )}
            {ffas && layers.situation && ffas.situation.features.length > 0 && (
              <div>
                <i className="sw sttn" /> 산림청 상황도 화선(빨강)·진화완료선(회색), 작성 시각부터 표시
              </div>
            )}
            {forest && layers.forest && (
              <div>
                <i className="sw forest" /> 임상도: 갈색 계열 = 침엽수림, 노랑·초록 계열 = 활엽수림
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
          {head && layers.gk2a && (
            <div className="head-card">
              <div className="hc-top">
                <b>불의 선두</b>
                <span className="hc-src">천리안 2A · {fmt(head.t)}</span>
              </div>
              <div className="hc-grid">
                <div>
                  <span>발화점에서</span>
                  <b>{head.km.toFixed(1)}<small> km</small></b>
                </div>
                <div>
                  <span>최근 1시간 전진</span>
                  <b>{head.kmh != null ? head.kmh.toFixed(1) : '–'}<small> km</small></b>
                </div>
                <div>
                  <span>선두 바람(재분석)</span>
                  <b>{head.ws.toFixed(1)}<small> m/s {compass((head.wd + 180) % 360)}향</small></b>
                </div>
              </div>
              <div className="hc-actions">
                <button className={chase ? 'on' : ''} onClick={() => setChase((c) => !c)}>{chase ? '따라가는 중' : '따라가기'}</button>
                <button className="ghost" onClick={() => setFlyTarget({ key: Date.now(), center: [head.lon, head.lat], zoom: 11.5, pitch: 62 })}>선두로 이동</button>
              </div>
            </div>
          )}
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
                ['response', '기록 대조'],
                ['emd', focused ? focused.properties.emd : '읍면동'],
                ['events', '기록', events.length ? `${seen.length}` : ''],
                ['news', '보도', news ? `${recentNews.length}` : ''],
                ...(registry && registry.length > 1 ? ([['compare', '비교']] as const) : []),
                ['sources', '출처'],
              ] as const
            ).map(([k, label, badge]: readonly string[]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as typeof tab)}>
                {label}
                {badge ? <span className="tab-badge">{badge}</span> : null}
              </button>
            ))}
          </nav>

          {tab === 'overview' && (
            <div className="pane">
              {scenes.length > 0 && (
                <>
                  <h3>주요 장면 <span className="kbd-hint">숫자키 1~{Math.min(9, scenes.length)}</span></h3>
                  <ol className="scenes">
                    {scenes.map((sc) => (
                      <li key={sc.label}>
                        <button className={Math.abs(tm - Math.max(T_MIN, Math.min(T_MAX, sc.t))) < 1 ? 'on' : ''} onClick={() => goScene(sc)}>
                          <span className="sc-t">{fmt(sc.t)}</span>
                          <span className="sc-l">{sc.label}</span>
                          <small>{sc.sub}</small>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {gk2a && gk2a.reach.length > 0 && (() => {
                const first = gk2a.pixels.reduce((m, p) => Math.min(m, p[2]), Infinity)
                const last = gk2a.reach[gk2a.reach.length - 1]
                const maxKm = last[1]
                const t0r = gk2a.reach[0][0]
                const t1r = last[0]
                const W = 280, H = 64
                const x = (v: number) => ((v - t0r) / Math.max(1, t1r - t0r)) * W
                const y = (v: number) => H - (v / Math.max(1, maxKm)) * (H - 6) - 3
                const now = gk2a.reach.filter((r) => r[0] <= tm).pop()
                const reported = ffas?.members.find((m) => m.matched)?.reported
                const f = gk2a.fastest_hour
                return (
                  <>
                    <h3>천리안 2A로 본 10분 경로</h3>
                    <dl className="facts">
                      <dt>첫 탐지</dt>
                      <dd>
                        {fmt(first)}
                        {reported && <small> · 신고 {fmt(toMinutes(reported))}</small>}
                        {data && <small> · 극궤도 위성 {fmt(data.meta.first_detection.t)}</small>}
                      </dd>
                      <dt>지금까지 도달</dt>
                      <dd>{now ? `발화점에서 ${now[1].toFixed(1)} km` : '아직 탐지 없음'}</dd>
                      {f && (
                        <>
                          <dt>가장 빨랐던 1시간</dt>
                          <dd>
                            <button className="link-row" onClick={() => setT(f.t_from)}>
                              <b className="hot">{f.kmh.toFixed(1)} km/h</b> · {fmt(f.t_from)} → {fmt(f.t_to)} ({f.km_from.toFixed(0)} → {f.km_to.toFixed(0)} km)
                            </button>
                          </dd>
                        </>
                      )}
                    </dl>
                    <svg className="reach-chart" viewBox={`0 0 ${W} ${H}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.round(t0r + ((e.clientX - r.left) / r.width) * (t1r - t0r))) }}>
                      <polyline points={gk2a.reach.map((r) => `${x(r[0])},${y(r[1])}`).join(' ')} />
                      {now && <circle cx={x(now[0])} cy={y(now[1])} r={3.5} />}
                      <text x={2} y={10}>{maxKm.toFixed(0)} km</text>
                    </svg>
                    <p className="note top">
                      정지궤도 천리안위성 2A호가 10분마다 찍은 산불탐지 화소(2km)입니다. 하늘색 선은 매 시각 발화점에서 가장 멀리 있던 불의 위치를 이은 것이라, 극궤도 위성의 12시간 공백을 메웁니다. 구름이 가리거나 불이 작으면 놓치고, 화소가 2km라 위치 오차가 그만큼 있습니다. 받은 프레임 {gk2a.frames_available}/{gk2a.frames_total}.
                    </p>
                  </>
                )
              })()}

              {spread && spread.summary.major > 0 && (
                <>
                  <h3>확산 경로</h3>
                  <p className="spread-lead">
                    위성 통과마다 가장 멀리 간 전진(머리) {spread.summary.heads}개 중 <b className="hot">{spread.summary.heads_with_wind_45}개</b>가 바람이 불어 간 방향 ±45° 안입니다.
                    {(() => {
                      const long = spread.vectors.filter((v) => v.head && v.km >= 10)
                      return long.length ? ` 10km 넘게 간 ${long.length}번은 ${long.every((v) => v.wind_diff <= 45) ? '모두' : `${long.filter((v) => v.wind_diff <= 45).length}번`} 바람 방향이었습니다.` : ''
                    })()}
                  </p>
                  {spread.vectors
                    .filter((v) => v.head || v.separate_ignition)
                    .map((v) => (
                      <button key={v.t + ':' + v.to.join()} className="stat-row" onClick={() => setT(Math.max(T_MIN, Math.min(T_MAX, v.t)))}>
                        <span>
                          {fmt(v.t_prev)} → {fmt(v.t)} · {compass(v.bearing)} <b>{v.km.toFixed(1)} km</b>
                          <br />
                          <small>
                            {v.separate_ignition
                              ? `확산 아님: 그 사이 별도 발화(${v.separate_ignition.split(' ').slice(1, 4).join(' ')})`
                              : `최소 평균 ${v.min_kmh?.toFixed(1)} km/h · 바람은 ${compass(v.wind_to)}${compass(v.wind_to).endsWith('서') ? '로' : '으로'} ${v.wind_ms} m/s ${v.wind_diff <= 45 ? '(같은 방향)' : `(${v.wind_diff}° 어긋남)`}`}
                          </small>
                        </span>
                        <small>{v.separate_ignition ? '발화' : v.wind_diff <= 45 ? '바람 ✓' : ''}</small>
                      </button>
                    ))}
                  <p className="note">
                    색 칸 = 위성이 처음 불을 본 시각(노랑 → 진홍, 375m 칸). 화살표 = 직전 통과 이후 새로 탄 칸(1.5km 안에서 이어진 묶음)에서 이전 불과 가장 먼 칸까지, 굵은 것이 통과별 머리, 회색은 별도 발화. VIIRS 위성 2기가 거의 같은 시각에 지나가 관측이 약 12시간 간격이라, 화살표는 그 사이 어딘가로 불이 갔다는 뜻이지 실제 경로·속도가 아닙니다(속도는 최소값). 3km 넘는 화살표는 중간 경로가 관측되지 않은 구간입니다.
                  </p>
                </>
              )}

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

              {ffas && ffas.members.some((m) => m.matched) && (
                <>
                  <h3>산림청 산불정보시스템</h3>
                  {ffas.members.filter((m) => m.matched).map((m) => (
                    <div key={m.fire_id} className="ffas-fire">
                      <div className="ffas-head">
                        <span>{m.address}</span>
                        <b className={m.final_level === '초기대응' ? '' : 'hot'}>{m.final_level}</b>
                      </div>
                      <div className="ffas-steps">
                        {([['신고', m.reported], ['접수', m.received], ['확인', m.confirmed], ['진화', m.extinguished]] as const).map(([k, v]) =>
                          v ? (
                            <button key={k} className="link-row" onClick={() => setT(Math.max(T_MIN, Math.min(T_MAX, toMinutes(v))))}>
                              {k} {fmt(toMinutes(v))}{k !== '진화' && v.slice(17, 19) !== '00' ? `:${v.slice(17, 19)}` : ''}
                            </button>
                          ) : null,
                        )}
                      </div>
                      {m.resources && (m.resources.helicopters > 0 || m.resources.crew > 0) && (
                        <small className="ffas-res">
                          누적 투입 헬기 {m.resources.helicopters.toLocaleString()}대 · 인력 {m.resources.crew.toLocaleString()}명 · 장비 {m.resources.equipment.toLocaleString()}대
                        </small>
                      )}
                      {m.situation_maps?.map((sm) => (
                        <small key={sm.map_id} className="ffas-res">
                          상황도 「{sm.name}」 {sm.drawn_at ? fmt(toMinutes(sm.drawn_at)) : ''} 작성
                        </small>
                      ))}
                    </div>
                  ))}
                  <p className="note">
                    출처: 산림청 국가산불정보시스템 공개 화면. 투입 자원은 사건 전체 누적(연인원·연대수)입니다. 지도의 빨간 선은 마지막 상황도의 화선, 회색 선은 진화 완료선이며 면적 경계가 아닙니다. 상황도는 산불 1단계(10ha) 이상만 공개되고 마지막 한 장만 남아 있습니다.
                  </p>
                </>
              )}

              {forest && (
                <>
                  <h3>숲 종류 (임상도)</h3>
                  <div className="forest-bars">
                    {['침엽수림', '활엽수림', '혼효림', '기타 산림'].map((g) => {
                      const all = forest.whole_bbox.groups[g] ?? 0
                      const hot = forest.hotspot_cells?.groups[g]
                      return (
                        <div key={g} className="forest-row">
                          <span>{g}</span>
                          <div className="forest-track">
                            <i style={{ width: `${all * 100}%` }} className="all" />
                            {hot != null && <i style={{ width: `${hot * 100}%` }} className="hot" />}
                          </div>
                          <small>
                            {hot != null ? `${Math.round(hot * 100)}%` : '–'} <em>/ {Math.round(all * 100)}%</em>
                          </small>
                        </div>
                      )
                    })}
                  </div>
                  <small className="ffas-res">위 막대 = 열점 칸 안, 아래 옅은 막대 = 지도 범위 전체 (산림 화소 기준)</small>
                  {(() => {
                    const hot = forest.hotspot_cells?.classes['미립목지'] ?? 0
                    const all = forest.whole_bbox.classes['미립목지'] ?? 0
                    return hot > 0.1 && hot > all * 3 ? (
                      <p className="note top">
                        열점 칸의 <b>{Math.round(hot * 100)}%</b>가 지금 임상도에서 미립목지(나무 없는 산림)로 바뀌어 있습니다(전체 {Math.round(all * 100)}%). 현재판이 이미 피해를 반영했기 때문에, 이 사건은 불나기 전 숲 종류를 이 지도로 알 수 없습니다.
                      </p>
                    ) : null
                  })()}
                  <p className="note">
                    출처: 산림청 산림공간정보서비스 1:5,000 임상도. {forest.edition_note}. 375m 열점 칸 기준이라 실제 피해 경계보다 넓습니다.
                  </p>
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

          {tab === 'response' && resp && <Response data={resp} full={full} emdNames={Object.fromEntries((emd?.features ?? []).map((f) => [f.properties.code, `${f.properties.sigungu.replace(/[시군]$/, '')} ${f.properties.emd}`]))} t={tm} onSeek={(v) => setT(Math.max(T_MIN, Math.min(T_MAX, v)))} onFocusEmd={(c) => setFocusCode(c)} />}
          {tab === 'emd' && (
            <div className="pane">
              {focused ? (
                <EmdDetail
                  p={focused.properties}
                  centroid={centroidOf(focused.geometry)}
                  data={data}
                  resp={resp}
                  mentions={mentions?.by_emd[focused.properties.code] ?? null}
                  full={full?.by_emd[focused.properties.code] ?? null}
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
          {tab === 'response' && !resp && <div className="pane"><p className="note">기록 대조 자료가 없습니다.</p></div>}

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
                  <b>산림청 국가산불정보시스템</b> (fd.forest.go.kr) 공개 화면: 신고·접수·확인·진화 시각, 최종 대응단계, 누적 진화자원(헬기·인력·장비), 산불 1단계 이상 사건의 마지막 공개 상황도(화선·진화완료선). 상황도는 사건당 한 장만 공개됩니다
                </li>
                <li>
                  <b>산림청 임상도</b> (map.forest.go.kr 1:5,000 나무지도) 사건 범위를 한 장으로 받아 범례 색으로 숲 종류를 역분류했습니다. 2026-02 갱신 현재판이라 피해지가 이미 미립목지로 바뀐 사건이 있습니다
                </li>
                <li>
                  <b>천리안위성 2A호 산불탐지</b> 기상청 API허브(AMI L2 FF, 한반도 2km, 10분). 신뢰도 하·중·상만, 60분 안 2회 이상 탐지, VIIRS 칸 3km 안 화소만 사용. 원자료는 승인 이용자 제한이라 게시하지 않고 탐지 위치·시각만 씁니다
                </li>
                <li>
                  <b>확산 경로</b> FIRMS VIIRS 375m 칸의 첫 탐지 시각으로 도달 시각을 그리고, 통과 사이 새로 탄 칸의 전진 벡터를 ERA5 바람과 비교했습니다. 관측 간격이 약 12시간이라 경로·속도는 하한 추정입니다
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
                  <b>언론·정부 발표</b> 원문 링크와 인용문 포함, 공식 기록은 파란 점. 기록 대조 탭은 70건을 179개 주장으로 나눠 수동 검토한 결과
                </li>
                <li>
                  <b>기사 본문 문장 추출</b> 2,940개 기사 본문에서 시각·읍면동·행위어가 한 문장에 있는 1,760건(44개 읍면동). 30건 표본 검토 정밀도 66.7%. 후보이지 확정 기록이 아님
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
          <button className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? '정지' : '재생'} title="Space 재생·정지 · ←/→ 1시간(Shift 10분) · 1~9 주요 장면 · L 레이어">
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
          <button className="step more" onClick={() => setChartsOpen((o) => !o)} aria-expanded={chartsOpen}>
            {chartsOpen ? '차트 접기' : '차트 더보기'}
          </button>
        </div>
        <Timeline expanded={chartsOpen} data={data} news={news} events={events} fires={localFires} official={official} showSmoke={layers.smoke} t={tm} onSeek={setT} onSelectEvent={selectEvent} />
      </footer>
    </div>
  )
}
