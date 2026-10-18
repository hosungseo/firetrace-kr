import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mlcontour from 'maplibre-contour'
// maplibre v6 resolves its worker next to import.meta.url, which the bundle doesn't ship; emit it as an asset.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { EmdCollection, FfasData, FireData, FireEvent, ForestTypeData, GwisData, Gk2aData, KfsFire, SpreadData } from './types'
import { ACTIVE_WINDOW, T_MAX, fmt, hourIndex, kstDate, toMinutes } from './time'

export interface Layers {
  gwis: boolean
  smoke: boolean
  emd: boolean
  stations: boolean
  burned: boolean
  active: boolean
  wind: boolean
  events: boolean
  terrain: boolean
  situation: boolean
  forest: boolean
  spread: boolean
  gk2a: boolean
  gk2aRaw: boolean
}

export interface FlyTarget {
  key: number
  center: [number, number]
  zoom: number
  pitch?: number
  bearing?: number
}

export type Basemap = 'terrain' | 'night' | 'satellite' | 'daily'

interface Props {
  view: { center: [number, number]; zoom: number }
  basemap: Basemap
  data: FireData
  events: FireEvent[]
  emd: EmdCollection | null
  kfs: KfsFire[]
  gwis: GwisData | null
  ffas: FfasData | null
  forest: ForestTypeData | null
  spread: SpreadData | null
  gk2a: Gk2aData | null
  dataBase: string
  flyTarget: FlyTarget | null
  chase: boolean
  focusCode: string | null
  onFocusEmd: (code: string) => void
  t: number
  layers: Layers
  selected: string | null
  onSelectEvent: (id: string) => void
}

maplibregl.setWorkerUrl(workerUrl)

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
// NASA GIBS daily true-colour imagery (VIIRS on Suomi-NPP, ~13:30 local overpass). Keyless WMTS.
const GIBS = (date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`


// Shared DEM for terrain, hillshade and client-side contour generation.
const demSource = new mlcontour.DemSource({ url: DEM, encoding: 'terrarium', maxzoom: 14, worker: true, cacheSize: 200 })
demSource.setupMaplibre(maplibregl)

// Sun azimuth by local hour: east at dawn, south at noon, west at dusk; flat northern light at night.
// Quantised to 2-hour steps because changing it means rebuilding the hillshade layer (see ensureHillshade).
function sunAzimuth(t: number) {
  const h = Math.floor(((t / 60) % 24) / 2) * 2
  return h >= 6 && h <= 18 ? 90 + (h - 6) * 15 : 335
}

const BASE = {
  terrain: { bg: '#e7dfd0', shadow: '#4a3a28', highlight: '#fffaf0', accent: '#b9a07a', exag: 0.55, contour: '#7a5f41', burned: '#3b0d06', burnedOp: 0.8, arrow: ['#1d4f8f', '#2b7dd6', '#0b5fd0'], halo: 'rgba(255,255,255,0.85)' },
  night: { bg: '#15141a', shadow: '#000000', highlight: '#5d5a66', accent: '#26242c', exag: 0.75, contour: '#6c6878', burned: '#6e2410', burnedOp: 0.85, arrow: ['#b8c8e0', '#9fd0ff', '#4aa8ff'], halo: 'rgba(0,0,0,0.7)' },
  satellite: { bg: '#000', shadow: '#2a1a0a', highlight: '#ffffff', accent: '#000000', exag: 0.35, contour: '#ffffff', burned: '#3b0d06', burnedOp: 0.75, arrow: ['#e6f1fb', '#9fd0ff', '#4aa8ff'], halo: 'rgba(10,20,40,0.75)' },
  daily: { bg: '#0b0d12', shadow: '#000000', highlight: '#ffffff', accent: '#000000', exag: 0.25, contour: '#ffffff', burned: '#5a1a0c', burnedOp: 0.55, arrow: ['#e6f1fb', '#9fd0ff', '#4aa8ff'], halo: 'rgba(10,20,40,0.75)' },
} as const

function arrowImage(): ImageData {
  const s = 48
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.strokeStyle = '#ffffff'
  g.fillStyle = '#ffffff'
  g.lineWidth = 3
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(s / 2, s - 6)
  g.lineTo(s / 2, 12)
  g.stroke()
  g.beginPath()
  g.moveTo(s / 2, 4)
  g.lineTo(s / 2 - 9, 18)
  g.lineTo(s / 2 + 9, 18)
  g.closePath()
  g.fill()
  return g.getImageData(0, 0, s, s)
}

function hotspotGeoJSON(data: FireData) {
  return {
    type: 'FeatureCollection' as const,
    features: data.hotspots.map((h) => ({
      ...(([lon, lat, t, frp, sat]) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lon, lat] },
      properties: { t, frp, sat, conf: h[5] ?? '', bright: h[6] ?? 0 },
      }))(h as unknown as [number, number, number, number, string]),
    })),
  }
}

function windGeoJSON(data: FireData, t: number) {
  const i = hourIndex(t, data.weather.grid[0]?.ws.length)
  return {
    type: 'FeatureCollection' as const,
    features: data.weather.grid.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      // wd is where wind comes FROM; arrow points downwind
      properties: { ws: p.ws[i], rot: (p.wd[i] + 180) % 360 },
    })),
  }
}

function smokeGeoJSON(data: FireData, t: number) {
  const i = hourIndex(t, data.smoke[0]?.pm25.length)
  return {
    type: 'FeatureCollection' as const,
    features: data.smoke.map((p) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
      properties: { pm: p.pm25[i] ?? 0 },
    })),
  }
}

function kfsGeoJSON(kfs: KfsFire[]) {
  return {
    type: 'FeatureCollection' as const,
    features: kfs
      .filter((f) => f.lonlat)
      .map((f, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: f.lonlat! },
        properties: { i, t: f.t, area: f.area_ha },
      })),
  }
}

function eventGeoJSON(events: FireEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events
      .filter((e) => e.lat != null && e.lon != null)
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [e.lon!, e.lat!] },
        properties: { id: e.id, t: e.tv ?? e.t ?? 0, title: e.title },
      })),
  }
}

export default function MapView({ view, basemap, data, events, emd, kfs, gwis, ffas, forest, spread, gk2a, dataBase, flyTarget, chase, focusCode, onFocusEmd, t, layers, selected, onSelectEvent }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const hillshadeKey = useRef('')
  const dailyKey = useRef('')
  const stationEls = useRef<HTMLDivElement[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)
  const latest = useRef({ t, layers, events, selected, basemap, emd, kfs, gwis, ffas, forest, spread, gk2a })
  latest.current = { t, layers, events, selected, basemap, emd, kfs, gwis, ffas, forest, spread, gk2a }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        transition: { duration: 300, delay: 0 },
        sources: {
          imagery: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 17, attribution: 'Imagery © Esri' },
          contours: {
            type: 'vector',
            maxzoom: 14,
            tiles: [
              demSource.contourProtocolUrl({
                multiplier: 1,
                thresholds: { 8: [200, 1000], 10: [100, 500], 12: [50, 250], 14: [20, 100] },
                elevationKey: 'ele',
                levelKey: 'level',
                contourLayer: 'contours',
              }),
            ],
          },
          dem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
          hillshadeDem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': BASE.terrain.bg } },
          { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.92 } },
          { id: 'hillshade', type: 'hillshade', source: 'hillshadeDem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#2a1a0a' } },
        ],
      },
      center: view.center,
      zoom: view.zoom,
      pitch: 50,
      bearing: -8,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: 'Fire: NASA FIRMS · Weather: Open-Meteo (ERA5) · DEM: AWS Terrain Tiles' },
    })
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      map.setTerrain({ source: 'dem', exaggeration: 1.6 })
      map.addImage('arrow', arrowImage(), { pixelRatio: 2, sdf: true })
      map.addLayer({
        id: 'contours',
        type: 'line',
        source: 'contours',
        'source-layer': 'contours',
        paint: {
          'line-color': BASE.terrain.contour,
          'line-opacity': ['case', ['>', ['get', 'level'], 0], 0.7, 0.3],
          'line-width': ['case', ['>', ['get', 'level'], 0], 1.1, 0.5],
        },
      })

      map.addSource('smoke', { type: 'geojson', data: smokeGeoJSON(data, latest.current.t) })
      map.addLayer({
        id: 'smoke',
        type: 'circle',
        source: 'smoke',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 16, 11, 64],
          'circle-color': ['interpolate', ['linear'], ['get', 'pm'], 35, '#b3a797', 150, '#7a6c5e', 400, '#4a3f36'],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'pm'], 25, 0, 75, 0.18, 300, 0.38],
          'circle-blur': 1,
          'circle-pitch-alignment': 'map',
        },
      })

      // 읍면동: population choropleth (70+ share), boundary lines, and a fire-coloured fill once a hotspot has landed inside
      map.addSource('emd', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'emd-fill',
        type: 'fill',
        source: 'emd',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'age70share'], 0], 0.15, 'rgba(96,70,150,0.03)', 0.45, 'rgba(96,70,150,0.28)'],
        },
      })
      map.addLayer({
        id: 'emd-hit',
        type: 'fill',
        source: 'emd',
        paint: { 'fill-color': '#e8551b', 'fill-opacity': 0.16 },
        filter: ['<=', ['coalesce', ['get', 'first_hit'], 1e9], -1],
      })
      map.addLayer({
        id: 'emd-line',
        type: 'line',
        source: 'emd',
        paint: { 'line-color': '#5a4a8a', 'line-width': 0.6, 'line-opacity': 0.45 },
      })
      popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'emd-popup' })
      map.on('mousemove', 'emd-fill', (e: MapLayerMouseEvent) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined
        if (!p || !latest.current.layers.emd) return
        const share = typeof p.age70share === 'number' ? `${Math.round(p.age70share * 100)}%` : '–'
        const hit = typeof p.first_hit === 'number' && p.first_hit <= latest.current.t ? `열점 첫 관측 ${fmt(p.first_hit)}` : '아직 열점 없음'
        popup.current!
          .setLngLat(e.lngLat)
          .setHTML(`<b>${p.sigungu} ${p.emd}</b><br>주민 ${(p.total as number)?.toLocaleString() ?? '–'}명 · 70세 이상 ${share}<br><span class="${hit.startsWith('열점') ? 'hit' : ''}">${hit}</span>`)
          .addTo(map)
      })
      map.on('mouseleave', 'emd-fill', () => popup.current?.remove())
      map.on('click', 'emd-fill', (e: MapLayerMouseEvent) => {
        // hotspots / events / kfs are drawn above and handle their own clicks; only react when nothing else is under the cursor
        const top = map.queryRenderedFeatures(e.point, { layers: ['active', 'burned', 'events', 'kfs'] })
        if (top.length) return
        const code = e.features?.[0]?.properties?.code
        if (code) onFocusEmd(String(code))
      })

      // JRC GWIS near-real-time fire perimeter estimates (MODIS 1 km + VIIRS 375 m) — an independent agency's outline
      map.addSource('gwis', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'gwis',
        type: 'line',
        source: 'gwis',
        paint: { 'line-color': '#1d9a8c', 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.9 },
      })
      // 산림청 상황도: the last public situation map per fire (fire line = still burning, extinguished line = out)
      map.addSource('situation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'situation',
        type: 'line',
        source: 'situation',
        paint: {
          'line-color': ['match', ['get', 'kind'], 'fire_line', '#e8361c', '#6b7280'],
          'line-width': ['match', ['get', 'kind'], 'fire_line', 2.6, 1.6],
          'line-opacity': 0.95,
        },
      })
      // GK2A geostationary fire pixels (2 km, every 10 min) and the leading-edge track
      map.addSource('gk2a', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'gk2a-track',
        type: 'line',
        source: 'gk2a',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#06b6d4', 'line-width': 3, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'gk2a-px',
        type: 'circle',
        source: 'gk2a',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 8, 2.5, 12, 18],
          'circle-color': '#06b6d4',
          'circle-opacity': ['case', ['get', 'now'], 0.75, 0.3],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': ['case', ['get', 'now'], 1, 0],
        },
      })
      // Front-advance vectors between satellite passes
      map.addSource('spread', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'spread-glow',
        type: 'line',
        source: 'spread',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'sep']], ['get', 'head']],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#FF6B00', 'line-width': 14, 'line-blur': 10, 'line-opacity': ['case', ['get', 'latest'], 0.75, 0.35] },
      })
      map.addLayer({
        id: 'spread-line',
        type: 'line',
        source: 'spread',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['get', 'sep']]],
        layout: { 'line-cap': 'round' },
        paint: {
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#FFD700', 1, '#FF6B00'],
          'line-width': ['case', ['get', 'head'], 5, 1.6],
          'line-opacity': ['case', ['get', 'head'], 1, 0.55],
        },
      })
      map.addLayer({
        id: 'spread-sep',
        type: 'line',
        source: 'spread',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['get', 'sep']],
        paint: { 'line-color': '#6b7280', 'line-width': 2, 'line-dasharray': [2, 2] },
      })
      map.addLayer({
        id: 'spread-head',
        type: 'symbol',
        source: 'spread',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'icon-image': 'arrow',
          'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': ['case', ['get', 'head'], 2.8, 1.3],
        },
        paint: { 'icon-color': ['case', ['get', 'sep'], '#6b7280', '#FF6B00'], 'icon-halo-color': '#fff', 'icon-halo-width': 1, 'icon-opacity': ['case', ['get', 'head'], 1, 0.6] },
      })
      map.addLayer({
        id: 'emd-focus',
        type: 'line',
        source: 'emd',
        paint: { 'line-color': '#1f4fd1', 'line-width': 3 },
        filter: ['==', ['get', 'code'], ''],
      })

      // Comparison view: cumulative GK2A pixels drawn as raw 2 km squares
      map.addSource('gk2a-raw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'gk2a-raw-fill', type: 'fill', source: 'gk2a-raw', paint: { 'fill-color': '#06b6d4', 'fill-opacity': 0.22 } })
      map.addLayer({ id: 'gk2a-raw-line', type: 'line', source: 'gk2a-raw', paint: { 'line-color': '#06b6d4', 'line-width': 1, 'line-opacity': 0.7 } })
      // Burned-area outline traced from cumulative 375 m cells at each satellite pass
      map.addSource('perimeter', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'perimeter-fill', type: 'fill', source: 'perimeter', paint: { 'fill-color': 'rgba(139,43,34,0.45)' } })
      map.addLayer({ id: 'perimeter-line', type: 'line', source: 'perimeter', paint: { 'line-color': '#D84C2E', 'line-width': 2 } })
      // Arrival time: each 375 m cell coloured by when a satellite first saw fire there
      map.addSource('arrival', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'arrival',
        type: 'fill',
        source: 'arrival',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'f'], 0, '#ffd166', 0.35, '#f4842d', 0.7, '#c2261b', 1, '#5c0a28'],
          'fill-opacity': 0.55,
        },
      })
      map.addSource('hotspots', { type: 'geojson', data: hotspotGeoJSON(data) })
      map.addLayer({
        id: 'burned',
        type: 'circle',
        source: 'hotspots',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 6],
          'circle-color': '#3b0d06',
          'circle-opacity': 0.75,
        },
      })
      map.addLayer({
        id: 'active-glow',
        type: 'circle',
        source: 'hotspots',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 20],
          'circle-color': '#ff6a1a',
          'circle-opacity': 0.22,
          'circle-blur': 1,
        },
      })
      map.addLayer({
        id: 'active',
        type: 'circle',
        source: 'hotspots',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['interpolate', ['linear'], ['get', 'frp'], 0, 1.8, 200, 4], 12, 8],
          'circle-color': ['interpolate', ['linear'], ['get', 'frp'], 0, '#ffb347', 40, '#ff6a1a', 150, '#e8170b'],
          'circle-opacity': 0.95,
        },
      })

      map.addSource('wind', { type: 'geojson', data: windGeoJSON(data, latest.current.t) })
      map.addLayer({
        id: 'wind',
        type: 'symbol',
        source: 'wind',
        layout: {
          'icon-image': 'arrow',
          'icon-rotate': ['get', 'rot'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['get', 'ws'], 0, 0.6, 6, 1.4, 14, 2.4],
        },
        paint: {
          'icon-color': ['interpolate', ['linear'], ['get', 'ws'], 0, '#e6f1fb', 5, '#9fd0ff', 10, '#4aa8ff'],
          'icon-halo-color': 'rgba(10,20,40,0.75)',
          'icon-halo-width': 1.2,
          'icon-opacity': ['interpolate', ['linear'], ['get', 'ws'], 0, 0.55, 6, 0.95],
        },
      })

      const fd = data.meta.first_detection
      map.addSource('origin', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [fd.lon, fd.lat] }, properties: {} },
      })
      map.addLayer({
        id: 'origin',
        type: 'circle',
        source: 'origin',
        paint: { 'circle-radius': 7, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 },
      })

      map.addSource('events', { type: 'geojson', data: eventGeoJSON(latest.current.events) })
      map.addLayer({
        id: 'events',
        type: 'circle',
        source: 'events',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'id'], ''], 9, 6],
          'circle-color': '#1f4fd1',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })
      map.addSource('kfs', { type: 'geojson', data: kfsGeoJSON(latest.current.kfs) })
      map.addLayer({
        id: 'kfs',
        type: 'circle',
        source: 'kfs',
        paint: {
          'circle-radius': 6,
          'circle-color': '#8a2a0c',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      })
      for (const id of ['active', 'burned']) {
        map.on('click', id, (e: MapLayerMouseEvent) => {
          const q = e.features?.[0]?.properties as Record<string, unknown> | undefined
          if (!q) return
          const conf = typeof q.conf === 'number' ? `${q.conf}%` : ({ l: '낮음', n: '보통', h: '높음' } as Record<string, string>)[String(q.conf)] ?? String(q.conf)
          new maplibregl.Popup({ offset: 8, className: 'emd-popup' })
            .setLngLat(e.lngLat)
            .setHTML(`<b>위성 열점</b><br>${fmt(q.t as number)} · ${q.sat}<br>FRP ${q.frp} MW · 밝기 ${q.bright} K · 신뢰도 ${conf}<br><small>${q.sat === 'MODIS' ? '약 1 km 화소' : '375 m 화소'} 중심점</small>`)
            .addTo(map)
        })
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
      }

      map.on('click', 'kfs', (e: MapLayerMouseEvent) => {
        const i = e.features?.[0]?.properties?.i as number | undefined
        const f = i != null ? latest.current.kfs[i] : undefined
        if (!f) return
        new maplibregl.Popup({ offset: 12, className: 'emd-popup' })
          .setLngLat(f.lonlat!)
          .setHTML(`<b>산림청 발생 기록</b><br>${f.gungu} ${f.emd} ${f.ri} ${f.jibun}<br>${fmt(f.t)} 발생 · ${fmt(f.t_end)} 진화<br>원인 ${f.cause} · 피해 ${f.area_ha.toLocaleString()} ha<br><small>위치는 읍면 중심(지번 미지오코딩)</small>`)
          .addTo(map)
      })
      map.on('mouseenter', 'kfs', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'kfs', () => (map.getCanvas().style.cursor = ''))

      map.on('click', 'events', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id
        if (id) onSelectEvent(String(id))
      })
      map.on('mouseenter', 'events', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'events', () => (map.getCanvas().style.cursor = ''))

      stationEls.current = data.stations.map((st) => {
        const div = document.createElement('div')
        div.className = 'stn'
        new maplibregl.Marker({ element: div, anchor: 'left', offset: [-7, 0] }).setLngLat([st.lon, st.lat]).addTo(map)
        return div
      })

      map.moveLayer('perimeter-fill', 'burned')
      map.moveLayer('perimeter-line', 'burned')
      map.moveLayer('arrival', 'active')
      map.moveLayer('gk2a-px')
      map.moveLayer('gk2a-track')
      map.moveLayer('spread-glow')
      map.moveLayer('spread-line')
      map.moveLayer('spread-sep')
      map.moveLayer('spread-head')
      ready.current = true
      apply(map)
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function apply(map: maplibregl.Map) {
    if (!ready.current) return
    const { t, layers, events, selected, basemap, emd, kfs, ffas, forest, spread, gk2a } = latest.current
    const b = BASE[basemap]
    if (emd) (map.getSource('emd') as GeoJSONSource).setData(emd as never)
    if (gwis) (map.getSource('gwis') as GeoJSONSource).setData(gwis as never)
    map.setFilter('gwis', ['<=', ['get', 't_start_minutes'], t])
    map.setLayoutProperty('gwis', 'visibility', layers.gwis ? 'visible' : 'none')
    if (ffas) (map.getSource('situation') as GeoJSONSource).setData(situationGeoJSON(ffas))
    // A situation map is a snapshot: show it only from the moment it was drawn
    map.setFilter('situation', ['<=', ['get', 't'], t])
    map.setLayoutProperty('situation', 'visibility', layers.situation ? 'visible' : 'none')
    ensureForest(map, forest)
    // With the GK2A layer on, arrival times and the outline follow the 10-minute hybrid timing
    const hyb = layers.gk2a && gk2a?.cells_hybrid?.length === spread?.cells.length ? gk2a : null
    if (spread) {
      ;(map.getSource('arrival') as GeoJSONSource).setData(arrivalGeoJSON(spread, t, hyb))
      ;(map.getSource('spread') as GeoJSONSource).setData(spreadGeoJSON(spread, t))
    }
    if (spread) (map.getSource('perimeter') as GeoJSONSource).setData(perimeterGeoJSON(spread, t, hyb))
    for (const id of ['perimeter-fill', 'perimeter-line', 'arrival', 'spread-glow', 'spread-line', 'spread-sep', 'spread-head']) map.setLayoutProperty(id, 'visibility', layers.spread ? 'visible' : 'none')
    if (gk2a) (map.getSource('gk2a') as GeoJSONSource).setData(gk2aGeoJSON(gk2a, t))
    for (const id of ['gk2a-track', 'gk2a-px']) map.setLayoutProperty(id, 'visibility', layers.gk2a ? 'visible' : 'none')
    if (gk2a && layers.gk2aRaw) (map.getSource('gk2a-raw') as GeoJSONSource).setData(gk2aRawGeoJSON(gk2a, t))
    for (const id of ['gk2a-raw-fill', 'gk2a-raw-line']) map.setLayoutProperty(id, 'visibility', layers.gk2aRaw ? 'visible' : 'none')
    if (map.getLayer('forest')) map.setLayoutProperty('forest', 'visibility', layers.forest ? 'visible' : 'none')
    ;(map.getSource('kfs') as GeoJSONSource).setData(kfsGeoJSON(kfs))
    map.setFilter('emd-hit', ['<=', ['coalesce', ['get', 'first_hit'], 1e9], t])
    map.setFilter('kfs', ['<=', ['get', 't'], t])
    map.setPaintProperty('emd-line', 'line-color', basemap === 'night' ? '#b7a8e8' : basemap === 'satellite' ? '#e9e2ff' : '#5a4a8a')
    const sat = basemap === 'satellite' || basemap === 'daily'
    map.setLayoutProperty('imagery', 'visibility', basemap === 'satellite' ? 'visible' : 'none')
    ensureDaily(map, basemap === 'daily' ? kstDate(t) : null)
    map.setLayoutProperty('contours', 'visibility', sat ? 'none' : 'visible')
    ;(map.getSource('smoke') as GeoJSONSource).setData(smokeGeoJSON(data, t))
    map.setLayoutProperty('smoke', 'visibility', layers.smoke && basemap !== 'daily' ? 'visible' : 'none')
    map.setPaintProperty('emd-fill', 'fill-opacity', basemap === 'daily' ? 0 : 1)
    map.setPaintProperty('emd-hit', 'fill-opacity', basemap === 'daily' ? 0.06 : 0.16)
    map.setPaintProperty('contours', 'line-color', b.contour)
    ensureHillshade(map, basemap, sunAzimuth(t))
    map.setPaintProperty('burned', 'circle-color', b.burned)
    map.setPaintProperty('burned', 'circle-opacity', b.burnedOp)
    map.setPaintProperty('wind', 'icon-color', ['interpolate', ['linear'], ['get', 'ws'], 0, b.arrow[0], 5, b.arrow[1], 10, b.arrow[2]])
    map.setPaintProperty('wind', 'icon-halo-color', b.halo)
    map.setFilter('burned', ['<=', ['get', 't'], t - ACTIVE_WINDOW])
    const activeF: maplibregl.FilterSpecification = ['all', ['<=', ['get', 't'], t], ['>', ['get', 't'], t - ACTIVE_WINDOW]]
    map.setFilter('active', activeF)
    map.setFilter('active-glow', activeF)
    ;(map.getSource('wind') as GeoJSONSource).setData(windGeoJSON(data, t))
    ;(map.getSource('events') as GeoJSONSource).setData(eventGeoJSON(events))
    map.setFilter('events', ['<=', ['get', 't'], t])
    map.setPaintProperty('events', 'circle-radius', ['case', ['==', ['get', 'id'], selected ?? ''], 10, 6])
    const vis = (on: boolean) => (on ? 'visible' : 'none')
    map.setLayoutProperty('burned', 'visibility', vis(layers.burned))
    map.setLayoutProperty('active', 'visibility', vis(layers.active))
    map.setLayoutProperty('active-glow', 'visibility', vis(layers.active))
    map.setLayoutProperty('wind', 'visibility', vis(layers.wind))
    map.setLayoutProperty('events', 'visibility', vis(layers.events))
    map.setLayoutProperty('kfs', 'visibility', vis(layers.events))
    for (const id of ['emd-fill', 'emd-hit', 'emd-line']) map.setLayoutProperty(id, 'visibility', vis(layers.emd))
    const hi = hourIndex(t, data.stations[0]?.ws.length)
    data.stations.forEach((st, k) => {
      const el = stationEls.current[k]
      if (!el) return
      const ws = st.ws[hi]
      const wd = st.wd[hi]
      el.style.display = layers.stations ? '' : 'none'
      el.innerHTML =
        `<i class="stn-dot"></i><span class="stn-arrow" style="transform:rotate(${((wd ?? 0) + 180) % 360}deg);opacity:${ws ? 1 : 0.2}">↑</span>` +
        `<b>${st.name}</b> ${ws != null ? ws.toFixed(1) : '–'}<small>m/s</small> · ${st.rh[hi] ?? '–'}%`
      el.classList.toggle('strong', (ws ?? 0) >= 6)
    })
    map.setTerrain(layers.terrain ? { source: 'dem', exaggeration: sat ? 1.4 : 1.6 } : null)
  }

  // Daily imagery is a raster source whose URL carries the date; swap source + layer when the date changes
  // (raster layers are cached by the terrain pass too, so a plain setTiles would not repaint).
  function ensureDaily(map: maplibregl.Map, date: string | null) {
    const key = date ?? ''
    if (dailyKey.current === key) return
    dailyKey.current = key
    if (map.getLayer('daily')) map.removeLayer('daily')
    if (map.getSource('daily')) map.removeSource('daily')
    if (!date) return
    map.addSource('daily', { type: 'raster', tiles: [GIBS(date)], tileSize: 256, maxzoom: 9, attribution: 'Daily imagery: NASA GIBS / VIIRS SNPP' })
    map.addLayer({ id: 'daily', type: 'raster', source: 'daily', paint: { 'raster-fade-duration': 0 } }, 'hillshade')
  }

  // With terrain enabled MapLibre bakes the hillshade into the terrain pass, so paint updates
  // on the existing layer never show. Rebuild the layer when its look (basemap or sun) changes.
  function ensureHillshade(map: maplibregl.Map, basemap: Basemap, azimuth: number) {
    const key = `${basemap}:${azimuth}`
    if (hillshadeKey.current === key) return
    hillshadeKey.current = key
    const b = BASE[basemap]
    // The background layer is cached by the terrain pass as well, so rebuild it too.
    if (map.getLayer('bg')) map.removeLayer('bg')
    map.addLayer({ id: 'bg', type: 'background', paint: { 'background-color': b.bg } }, 'imagery')
    if (map.getLayer('hillshade')) map.removeLayer('hillshade')
    map.addLayer(
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshadeDem',
        paint: {
          'hillshade-exaggeration': b.exag,
          'hillshade-shadow-color': b.shadow,
          'hillshade-highlight-color': b.highlight,
          'hillshade-accent-color': b.accent,
          'hillshade-illumination-direction': azimuth,
        },
      },
      'contours',
    )
  }

  // 임상도 overlay: one georeferenced PNG per incident, draped under the vector layers
  function ensureForest(map: maplibregl.Map, f: ForestTypeData | null) {
    if (!f || map.getSource('forest')) return
    const [w, s, e, n] = f.bounds
    map.addSource('forest', { type: 'image', url: dataBase + f.image, coordinates: [[w, n], [e, n], [e, s], [w, s]] })
    map.addLayer({ id: 'forest', type: 'raster', source: 'forest', paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0 } }, 'emd-fill')
  }

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, layers, events, selected, basemap, emd, kfs, gwis, ffas, forest, spread, gk2a])


  // Cinematic scene jumps: centre, zoom, pitch and bearing interpolate together
  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTarget) return
    map.flyTo({ center: flyTarget.center, zoom: flyTarget.zoom, pitch: flyTarget.pitch ?? map.getPitch(), bearing: flyTarget.bearing ?? map.getBearing(), duration: 2500, essential: true, padding: { top: 120, bottom: 200, left: 0, right: 0 } })
  }, [flyTarget])

  // Chase: keep the GK2A fire head in view while time moves
  useEffect(() => {
    const map = mapRef.current
    if (!map || !chase || !gk2a) return
    const h = [...gk2a.head].reverse().find((x) => x[0] <= t)
    if (h) map.easeTo({ center: [h[1], h[2]], duration: 400 })
  }, [chase, t, gk2a])

  // Highlight + fly to a 읍면동 chosen in the response tab
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    map.setFilter('emd-focus', ['==', ['get', 'code'], focusCode ?? ''])
    const f = emd?.features.find((x) => x.properties.code === focusCode)
    if (f) {
      const pts: number[][] = []
      const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === 'number' ? pts.push(c as number[]) : Array.isArray(c) && c.forEach(walk))
      walk(f.geometry.coordinates)
      const lon = pts.reduce((a, p) => a + p[0], 0) / pts.length
      const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length
      map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 10.2), duration: 900 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCode])

  useEffect(() => {
    const ev = events.find((e) => e.id === selected)
    if (ev?.lat != null && ev.lon != null && mapRef.current) {
      mapRef.current.easeTo({ center: [ev.lon, ev.lat], duration: 900 })
    }
  }, [selected, events])

  return <div ref={el} className="map" />
}

function situationGeoJSON(ffas: FfasData) {
  const drawn = new Map<string, number>()
  for (const m of ffas.members) for (const sm of m.situation_maps ?? []) if (sm.drawn_at) drawn.set(sm.map_id, Math.min(toMinutes(sm.drawn_at), T_MAX - 1))  // drawn after the window → show at its end
  return {
    type: 'FeatureCollection' as const,
    features: ffas.situation.features.map((f) => ({ ...f, properties: { ...f.properties, t: drawn.get((f.properties as { map_id?: string }).map_id ?? '') ?? 1e9 } })),
  } as never
}

function arrivalGeoJSON(sp: SpreadData, t: number, hyb: Gk2aData | null) {
  const [dx, dy] = sp.cell_deg.map((d) => d / 2)
  const times = hyb?.cells_hybrid ?? sp.cells.map((c) => c[2])
  const t0 = Math.min(...times)
  const span = Math.max(1, Math.max(...times) - t0)
  return {
    type: 'FeatureCollection' as const,
    features: sp.cells
      .map(([x, y], i) => [x, y, times[i]] as [number, number, number])
      .filter((c) => c[2] <= t)
      .map(([x, y, tc]) => ({
        type: 'Feature' as const,
        properties: { t: tc, f: (tc - t0) / span },
        geometry: { type: 'Polygon' as const, coordinates: [[[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy], [x - dx, y - dy]]] },
      })),
  } as never
}

function spreadGeoJSON(sp: SpreadData, t: number) {
  const shown = sp.vectors.filter((v) => v.major && v.t <= t)
  const lastT = shown.reduce((m, v) => Math.max(m, v.t), -1)
  const features = shown.flatMap((v) => {
    const props = { cells: v.cells, latest: v.t === lastT, rot: v.bearing, km: v.km, head: v.head, sep: !!v.separate_ignition }
    return [
      { type: 'Feature' as const, properties: props, geometry: { type: 'LineString' as const, coordinates: [v.from, v.to] } },
      { type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: v.to } },
    ]
  })
  return { type: 'FeatureCollection' as const, features } as never
}

// Pixels active within the last 30 minutes (latest frame highlighted) and the leading-edge track so far
function gk2aGeoJSON(g: Gk2aData, t: number) {
  const recent = g.frames.filter(([ft]) => ft <= t && ft > t - 30)
  const lastT = recent.length ? recent[recent.length - 1][0] : -1
  const now = new Set(recent.length ? recent[recent.length - 1][1] : [])
  const ids = new Set(recent.flatMap(([, a]) => a))
  const pts = [...ids].map((i) => ({
    type: 'Feature' as const,
    properties: { now: now.has(i), t: lastT },
    geometry: { type: 'Point' as const, coordinates: [g.pixels[i][0], g.pixels[i][1]] },
  }))
  // track: head positions where the reach envelope grew
  const track: number[][] = [g.ignition]
  let best = -1
  for (const [ht, lon, lat, km] of g.head) {
    if (ht > t) break
    if (km > best + 0.5) { track.push([lon, lat]); best = km }
  }
  const line = track.length > 1 ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: track } }] : []
  return { type: 'FeatureCollection' as const, features: [...line, ...pts] } as never
}

function perimeterGeoJSON(sp: SpreadData, t: number, hyb: Gk2aData | null) {
  const list = hyb?.perimeters_hybrid ?? sp.perimeters
  const p = [...list].reverse().find((x) => x.t <= t)
  return { type: 'FeatureCollection' as const, features: p ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiPolygon' as const, coordinates: p.coordinates } }] : [] } as never
}

// 2 km x 2 km square around each GK2A pixel centre first seen by time t
function gk2aRawGeoJSON(g: Gk2aData, t: number) {
  const dy = 1 / 110.57
  return {
    type: 'FeatureCollection' as const,
    features: g.pixels
      .filter((p) => p[2] <= t)
      .map(([x, y]) => {
        const dx = 1 / (111.32 * Math.cos((y * Math.PI) / 180))
        return { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy], [x - dx, y - dy]]] } }
      }),
  } as never
}
