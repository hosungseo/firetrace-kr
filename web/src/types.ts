// [lon, lat, minutes since t0 (KST), FRP MW, satellite]
export type Hotspot = [number, number, number, number, string]

export interface AreaPoint {
  t: number
  t_start: number
  area_ha: number
  rate_ha_h: number | null
  n: number
  frp: number
}

export interface GridPoint {
  lat: number
  lon: number
  ws: number[]
  wd: number[]
  gust: number[]
  rh: number[]
  temp: number[]
  rain: number[]
}

export interface FrontWeather {
  t: number
  ws: number
  gust: number
  wd: number
  rh: number
  temp: number
  rain: number
  lat: number
  lon: number
  pm25?: number | null
}

export interface Station {
  id: number
  name: string
  lon: number
  lat: number
  ws: (number | null)[]
  wd: (number | null)[]
  rh: (number | null)[]
  ta: (number | null)[]
  rn: (number | null)[]
  daily_gust: { t: number; v: number; wd: number | null; min_rh: number | null }[]
}

export interface FireData {
  t0: string
  hotspots: Hotspot[]
  area: AreaPoint[]
  weather: { hours: number[]; grid: GridPoint[]; front: FrontWeather[] }
  stations: Station[]
  smoke: { lat: number; lon: number; pm25: (number | null)[]; aod: (number | null)[] }[]
  meta: { first_detection: { lon: number; lat: number; t: number }; hotspot_count: number; cell_km2: number }
}

export interface EventSource {
  outlet: string
  url: string
  published?: string
  quote?: string
}

export interface FireEvent {
  id: string
  time: string
  time_precision?: string
  type: string
  place?: string
  lat?: number | null
  lon?: number | null
  title: string
  detail?: string
  numbers?: Record<string, number | string>
  sources: EventSource[]
  official?: boolean
  t?: number // minutes since t0, filled on load (event time; day-precision events sit at day start)
  tv?: number // minutes from which the record counts as known (day-precision → end of that day)
  retro?: boolean // post-hoc analysis published later than its event time
}

// [minutes since t0, title, outlet, url, region indexes]
export type Article = [number, string, string, string, number[]]

export interface NewsData {
  regions: string[]
  hourly: [number, number][]
  articles: Article[]
  meta: { count: number; source: string }
}

export interface EmdProps {
  sido: string
  sigungu: string
  emd: string
  code: string
  total: number | null
  age70plus: number | null
  age70share: number | null
  first_hit: number | null
  hotspots: number
}

export interface EmdCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: EmdProps; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }[]
}

export interface KfsFire {
  si: string
  gungu: string
  emd: string
  ri: string
  jibun: string
  start: string
  end: string
  t: number
  t_end: number
  cause: string
  area_ha: number
  lonlat: [number, number] | null
}

export interface KfsData {
  source: string
  count: number
  fires: KfsFire[]
  note: string
}
