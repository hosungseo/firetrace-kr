// [lon, lat, minutes since t0 (KST), FRP MW, satellite, confidence (l/n/h or 0-100), brightness K]
export type Hotspot = [number, number, number, number, string, string | number | null, number]

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
  first_viirs?: number | null
  first_modis?: number | null
  hotspots: number
  daily?: [number, number][]
  decades?: number[] | null
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

export interface SlimClaim {
  claim_id: string
  action: string
  t: number | null
  precision: string
  approximate: boolean
  place?: string | null
  quote?: string | null
  url?: string | null
  source_kind?: string | null
  published?: string | null
}

export interface ResponsePair {
  code: string
  sigungu: string
  emd: string
  total: number | null
  age70share: number | null
  spread: SlimClaim | null
  response: SlimClaim | null
  role: string | null
  spatial: string
  satellite: { t: number | null; viirs: number | null; modis: number | null }
  gap_response_minus_spread: number | null
  gap_reason: string | null
  gap_satellite_minus_spread: number | null
  gap_satellite_minus_response: number | null
  approximate: boolean
}

export interface ResponseData {
  pairs: ResponsePair[]
  rows: { code: string; sigungu: string; emd: string; satellite: { t: number | null }; claims: SlimClaim[] }[]
  no_record: { code: string; sigungu: string; emd: string; first_hit: number }[]
  wide_scope: SlimClaim[]
  note: string
}

export interface GwisFeature {
  type: 'Feature'
  properties: { id: string; fire_id: string; initialdate: string; finaldate: string; t_start_minutes: number; t_end_minutes: number; source_area_ha: number | null }
  geometry: { type: string; coordinates: unknown }
}

export interface GwisData {
  type: 'FeatureCollection'
  features: GwisFeature[]
  meta: { product: string; layer: string; licence: string; mapped_polygon_count: number }
}

export interface GdacsData {
  episodes: { eventid: string; episodeid: string; t_minutes: string | number; alert_level: string; affected_population: string | number; polygon_date: string; severity: string }[]
  meta: Record<string, unknown>
}

export interface OfficialPoint {
  t: number
  v: number
  key: string
  id: string
  precision?: string
  official: boolean
  title: string
  outlet: string | null
}
export interface OfficialData {
  series: Record<'containment_pct' | 'impact_area_ha' | 'fireline_km' | 'deaths' | 'evacuees', OfficialPoint[]>
  county_containment: { t: number; id: string; pct: Record<string, number> }[]
  note: string
}
export interface MentionEmd {
  count: Record<string, number>
  first: Record<string, number>
  hourly: [number, number][]
  samples: { t: number; title: string; desc: string; url: string; actions: string[] }[]
  articles: number
}
export interface MentionsData {
  by_emd: Record<string, MentionEmd>
  meta: { source: string; articles_scanned: number; records: number; caveat: string }
}
