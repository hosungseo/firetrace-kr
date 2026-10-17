import { useEffect, useMemo, useRef, useState } from 'react'
import type { FireData, FireEvent, KfsFire, NewsData, OfficialData } from './types'
import { T_MAX, T_MIN, eventLabel, fmt, fmtDay, hourIndex } from './time'

interface Props {
  data: FireData
  news: NewsData | null
  events: FireEvent[]
  fires: KfsFire[]
  official: OfficialData | null
  showSmoke: boolean
  t: number
  onSeek: (t: number) => void
  onSelectEvent: (id: string) => void
}

const LABEL_W = 132
const PAD_R = 16
const ROW_H = 62

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(900)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export default function Timeline({ data, news, events, fires, official, showSmoke, t, onSeek, onSelectEvent }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const dragging = useRef(false)
  const plotW = Math.max(200, width - LABEL_W - PAD_R)
  const x = (m: number) => LABEL_W + ((m - T_MIN) / (T_MAX - T_MIN)) * plotW
  const inv = (px: number) => Math.round(Math.min(T_MAX, Math.max(T_MIN, T_MIN + ((px - LABEL_W) / plotW) * (T_MAX - T_MIN))))

  const front = data.weather.front.filter((f) => f.t >= T_MIN && f.t <= T_MAX)
  const area = data.area
  const maxArea = Math.max(...area.map((a) => a.area_ha))
  const maxRate = Math.max(...area.map((a) => a.rate_ha_h ?? 0))
  const obs = data.stations.flatMap((st) => st.daily_gust.filter((g) => g.t >= T_MIN && g.t <= T_MAX).map((g) => ({ ...g, name: st.name })))
  const maxWind = Math.ceil(Math.max(...front.map((f) => f.gust), ...obs.map((g) => g.v)) / 5) * 5
  const maxPm = Math.ceil(Math.max(50, ...front.map((f) => f.pm25 ?? 0)) / 50) * 50

  const rows = useMemo(() => {
    const y = (v: number, max: number) => ROW_H - 8 - (v / max) * (ROW_H - 18)
    // cumulative area: step function, flat before first detection
    let areaPath = `M${x(T_MIN)},${y(0, maxArea)}`
    let last = 0
    for (const a of area) {
      areaPath += ` L${x(a.t)},${y(last, maxArea)} L${x(a.t)},${y(a.area_ha, maxArea)}`
      last = a.area_ha
    }
    areaPath += ` L${x(T_MAX)},${y(last, maxArea)}`
    const areaFill = `${areaPath} L${x(T_MAX)},${y(0, maxArea)} L${x(T_MIN)},${y(0, maxArea)} Z`

    const bars = area.slice(1).map((a, i) => {
      const x0 = x(area[i].t) + 1
      const x1 = x(a.t) - 1
      const h = ((a.rate_ha_h ?? 0) / maxRate) * (ROW_H - 18)
      return { x0, x1, h, a }
    })

    const line = (key: 'ws' | 'gust' | 'rh', max: number) =>
      front.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f[key], max).toFixed(1)}`).join(' ')
    return {
      areaPath,
      areaFill,
      bars,
      ws: line('ws', maxWind),
      gust: line('gust', maxWind),
      rh: line('rh', 100),
      pm: front.map((f, i) => (f.pm25 == null ? '' : `${i === 0 || front[i - 1].pm25 == null ? 'M' : 'L'}${x(f.t).toFixed(1)},${y(f.pm25, maxPm).toFixed(1)}`)).join(' '),
      y,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotW, data])

  const days = Array.from({ length: Math.round((T_MAX - T_MIN) / 1440) + 1 }, (_, i) => T_MIN + i * 1440)
  // Row values always describe the selected time t; hovering only moves the crosshair/tooltip.
  const fw = data.weather.front[hourIndex(t, data.weather.front.length)]
  const curArea = [...area].reverse().find((a) => a.t <= t)
  // Only windows that have fully elapsed at t are reported (the rate is a post-hoc per-window figure).
  const lastDone = [...area].reverse().find((a, i, arr) => a.t <= t && i < arr.length - 1)
  const hoverFw = hover != null ? data.weather.front[hourIndex(hover, data.weather.front.length)] : null

  const handle = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return inv(e.clientX - r.left)
  }

  const newsHourly = news?.hourly.filter(([m]) => m >= T_MIN && m < T_MAX) ?? []
  const maxNews = Math.max(1, ...newsHourly.map(([, n]) => n))
  const curNews = newsHourly.find(([m]) => m <= t && t < m + 60)?.[1] ?? 0
  const cont = official?.series.containment_pct.filter((o) => o.t >= T_MIN && o.t <= T_MAX) ?? []
  const curCont = [...cont].reverse().find((o) => o.t <= t)
  const nRows = (showSmoke ? 6 : 5) + (cont.length ? 1 : 0)
  const totalH = 26 + ROW_H * nRows + 22
  const rowY = (i: number) => 26 + i * ROW_H

  return (
    <div className="timeline" ref={ref}>
      <svg
        width={width}
        height={totalH}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          onSeek(handle(e))
        }}
        onPointerMove={(e) => {
          const m = handle(e)
          setHover(m)
          if (dragging.current) onSeek(m)
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => setHover(null)}
      >
        {/* day grid */}
        {days.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={18} y2={totalH - 18} className="grid" />
            <text x={x(d) + 4} y={totalH - 4} className="tick">
              {fmtDay(d)}
            </text>
          </g>
        ))}

        {/* event ticks */}
        <text x={8} y={16} className="row-label">
          보도·공식 기록
        </text>
        {events.map((e) =>
          e.t != null && e.t >= T_MIN && e.t <= T_MAX ? (
            <rect
              key={e.id}
              x={e.time_precision === 'day' ? x(e.t) + 1 : x(e.t) - 2}
              y={e.time_precision === 'day' ? 9 : 6}
              width={e.time_precision === 'day' ? x(e.t + 1440) - x(e.t) - 2 : 4}
              height={e.time_precision === 'day' ? 8 : 14}
              rx={2}
              className={`ev-tick ${e.official ? 'official' : ''} ${e.time_precision === 'day' ? 'day' : ''} ${e.retro ? 'retro' : ''}`}
              onPointerDown={(ev) => {
                ev.stopPropagation()
                onSelectEvent(e.id)
              }}
            >
              <title>
                {eventLabel(e.time, e.time_precision)} · {e.title}
              </title>
            </rect>
          ) : null,
        )}

        {fires.map((f) => (
          <polygon
            key={f.start + f.jibun}
            points={`${x(f.t)},6 ${x(f.t) + 5},20 ${x(f.t) - 5},20`}
            className="fire-tick"
            onPointerDown={(ev) => {
              ev.stopPropagation()
              onSeek(f.t)
            }}
          >
            <title>
              산림청 발생 기록 {fmt(f.t)} {f.gungu} {f.emd} · {f.area_ha} ha
            </title>
          </polygon>
        ))}

        {/* row 1: cumulative area */}
        <g transform={`translate(0,${rowY(0)})`}>
          <text x={8} y={18} className="row-label">
            열점 격자 환산 면적
          </text>
          <text x={8} y={36} className="row-value">
            {curArea ? `${curArea.area_ha.toLocaleString()} ha` : '–'}
          </text>
          <path d={rows.areaFill} className="area-fill" />
          <path d={rows.areaPath} className="area-line" />
        </g>

        {/* row 2: spread rate */}
        <g transform={`translate(0,${rowY(1)})`}>
          <text x={8} y={18} className="row-label">
            신규 탐지 격자 <tspan className="muted">(관측 구간·사후)</tspan>
          </text>
          <text x={8} y={36} className="row-value">
            {lastDone?.rate_ha_h != null ? `${Math.round(lastDone.rate_ha_h).toLocaleString()} ha/h` : '–'}
          </text>
          {rows.bars.map((b) => (
            <rect key={b.a.t} x={b.x0} width={Math.max(1, b.x1 - b.x0)} y={ROW_H - 8 - b.h} height={b.h} rx={2} className="rate-bar">
              <title>
                {fmt(b.a.t_start)}~{fmt(b.a.t)} 관측 구간: 신규 격자 {Math.round(b.a.rate_ha_h ?? 0).toLocaleString()} ha/h (위성 통과 간격에 좌우됨)
              </title>
            </rect>
          ))}
        </g>

        {/* row 3: wind */}
        <g transform={`translate(0,${rowY(2)})`}>
          <text x={8} y={18} className="row-label">
            바람 <tspan className="legend-ws">━풍속</tspan> <tspan className="legend-gust">┅돌풍</tspan> <tspan className="legend-obs">●관측</tspan>
          </text>
          <text x={8} y={36} className="row-value">
            {fw ? `${fw.ws.toFixed(1)} / ${fw.gust.toFixed(1)} m/s` : '–'}
          </text>
          <text x={LABEL_W + 4} y={rows.y(maxWind, maxWind) + 4} className="axis">
            {maxWind} m/s
          </text>
          <path d={rows.gust} className="gust-line" />
          <path d={rows.ws} className="ws-line" />
          {obs.map((g) => (
            <circle key={g.name + g.t} cx={x(g.t)} cy={rows.y(g.v, maxWind)} r={g.v >= 20 ? 4.5 : 3} className={`obs-dot ${g.v >= 20 ? 'strong' : ''}`}>
              <title>
                {g.name} 최대순간풍속 {g.v} m/s · {fmt(g.t)}
              </title>
            </circle>
          ))}
        </g>

        {/* row 4: humidity */}
        <g transform={`translate(0,${rowY(3)})`}>
          <text x={8} y={18} className="row-label">
            상대습도
          </text>
          <text x={8} y={36} className="row-value">
            {fw ? `${Math.round(fw.rh)} %` : '–'}
          </text>
          <line x1={LABEL_W} x2={LABEL_W + plotW} y1={rows.y(30, 100)} y2={rows.y(30, 100)} className="threshold" />
          <text x={LABEL_W + plotW - 2} y={rows.y(30, 100) - 3} className="axis" textAnchor="end">
            30%
          </text>
          <path d={rows.rh} className="rh-line" />
        </g>

        {/* row 5 (optional): CAMS PM2.5 near the detection centroid */}
        {showSmoke && (
        <g transform={`translate(0,${rowY(4)})`}>
          <text x={8} y={18} className="row-label">
            PM2.5 (CAMS 모델, 약 40km)
          </text>
          <text x={8} y={36} className="row-value">
            {fw?.pm25 != null ? `${Math.round(fw.pm25)} µg/m³` : '–'}
          </text>
          <line x1={LABEL_W} x2={LABEL_W + plotW} y1={rows.y(75, maxPm)} y2={rows.y(75, maxPm)} className="threshold" />
          <text x={LABEL_W + plotW - 2} y={rows.y(75, maxPm) - 3} className="axis" textAnchor="end">
            75 µg/m³
          </text>
          <path d={rows.pm} className="pm-line" />
        </g>
        )}

        {/* official containment announcements */}
        {cont.length > 0 && (
          <g transform={`translate(0,${rowY(nRows - 2)})`}>
            <text x={8} y={18} className="row-label">
              발표 진화율 <tspan className="muted">(보도·공식)</tspan>
            </text>
            <text x={8} y={36} className="row-value">
              {curCont ? `${curCont.v}%` : '–'}
            </text>
            <path
              d={cont.map((o, i) => `${i ? 'L' : 'M'}${x(o.t).toFixed(1)},${rows.y(o.v, 100).toFixed(1)}`).join(' ')}
              className="cont-line"
            />
            {cont.map((o) => (
              <circle key={o.id} cx={x(o.t)} cy={rows.y(o.v, 100)} r={3.2} className={`cont-dot ${o.official ? 'official' : ''}`} onPointerDown={(ev) => { ev.stopPropagation(); onSelectEvent(o.id) }}>
                <title>
                  {fmt(o.t)} {o.v}% · {o.title}
                </title>
              </circle>
            ))}
            <text x={LABEL_W + plotW - 2} y={rows.y(100, 100) + 9} className="axis" textAnchor="end">
              100%
            </text>
          </g>
        )}

        {/* last row: collected-article count */}
        <g transform={`translate(0,${rowY(nRows - 1)})`}>
          <text x={8} y={18} className="row-label">
            수집 기사 수 <tspan className="muted">(표본·시간당)</tspan>
          </text>
          <text x={8} y={36} className="row-value">
            {news ? `${curNews}건` : '–'}
          </text>
          {newsHourly.map(([m, n]) => {
            const h = (n / maxNews) * (ROW_H - 18)
            return <rect key={m} x={x(m)} width={Math.max(1, x(m + 60) - x(m) - 0.5)} y={ROW_H - 8 - h} height={h} className="news-bar" />
          })}
        </g>

        {/* hover crosshair */}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={18} y2={totalH - 18} className="hover-line" />}
        {/* current time */}
        <line x1={x(t)} x2={x(t)} y1={4} y2={totalH - 18} className="now-line" />
        <circle cx={x(t)} cy={4} r={4} className="now-dot" />
        {hover != null && (
          <g transform={`translate(${Math.min(x(hover) + 8, width - 260)}, ${totalH - 40})`}>
            <rect width={250} height={20} rx={4} className="tip-bg" />
            <text x={8} y={14} className="tip">
              {fmt(hover)}{hoverFw ? ` · ${hoverFw.ws.toFixed(1)}/${hoverFw.gust.toFixed(0)} m/s · 습도 ${Math.round(hoverFw.rh)}%` : ''}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
