import { useEffect, useMemo, useRef, useState } from 'react'
import type { FireData, FireEvent, KfsFire, NewsData } from './types'
import { T_MAX, T_MIN, eventLabel, fmt, hourIndex } from './time'

interface Props {
  data: FireData
  news: NewsData | null
  events: FireEvent[]
  fires: KfsFire[]
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

export default function Timeline({ data, news, events, fires, t, onSeek, onSelectEvent }: Props) {
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
      pm: front.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f.pm25 ?? 0, maxPm).toFixed(1)}`).join(' '),
      y,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotW, data])

  const days = Array.from({ length: 8 }, (_, i) => T_MIN + i * 1440)
  const hv = hover ?? t
  const fw = data.weather.front[hourIndex(hv)]
  const curArea = [...area].reverse().find((a) => a.t <= hv)
  const curRate = area.find((a, i) => i > 0 && area[i - 1].t < hv && a.t >= hv)

  const handle = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return inv(e.clientX - r.left)
  }

  const newsHourly = news?.hourly.filter(([m]) => m >= T_MIN && m < T_MAX) ?? []
  const maxNews = Math.max(1, ...newsHourly.map(([, n]) => n))
  const curNews = newsHourly.find(([m]) => m <= hv && hv < m + 60)?.[1] ?? 0
  const totalH = 26 + ROW_H * 6 + 22
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
              3/{21 + d / 1440}
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
              x={x(e.t) - 2}
              y={6}
              width={4}
              height={14}
              rx={2}
              className={`ev-tick ${e.official ? 'official' : ''}`}
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
            열점 누적 면적
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
            확산 속도
          </text>
          <text x={8} y={36} className="row-value">
            {curRate?.rate_ha_h != null ? `${Math.round(curRate.rate_ha_h).toLocaleString()} ha/h` : '–'}
          </text>
          {rows.bars.map((b) => (
            <rect key={b.a.t} x={b.x0} width={Math.max(1, b.x1 - b.x0)} y={ROW_H - 8 - b.h} height={b.h} rx={2} className="rate-bar">
              <title>
                {fmt(b.a.t)}까지 {Math.round(b.a.rate_ha_h ?? 0).toLocaleString()} ha/h
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

        {/* row 5: smoke PM2.5 at the fire front */}
        <g transform={`translate(0,${rowY(4)})`}>
          <text x={8} y={18} className="row-label">
            연기 PM2.5 (CAMS)
          </text>
          <text x={8} y={36} className="row-value">
            {fw?.pm25 != null ? `${Math.round(fw.pm25)} µg/m³` : '–'}
          </text>
          <line x1={LABEL_W} x2={LABEL_W + plotW} y1={rows.y(75, maxPm)} y2={rows.y(75, maxPm)} className="threshold" />
          <text x={LABEL_W + plotW - 2} y={rows.y(75, maxPm) - 3} className="axis" textAnchor="end">
            매우나쁨 75
          </text>
          <path d={rows.pm} className="pm-line" />
        </g>

        {/* row 6: press volume */}
        <g transform={`translate(0,${rowY(5)})`}>
          <text x={8} y={18} className="row-label">
            보도량 (시간당)
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
          <g transform={`translate(${Math.min(x(hover) + 8, width - 150)}, ${totalH - 40})`}>
            <rect width={140} height={20} rx={4} className="tip-bg" />
            <text x={8} y={14} className="tip">
              {fmt(hover)}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
