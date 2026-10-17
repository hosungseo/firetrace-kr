import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mlcontour from 'maplibre-contour'
import type { EmdCollection, FireData, FireEvent, GwisData, KfsFire } from './types'
import { ACTIVE_WINDOW, fmt, hourIndex } from './time'

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
}

export type Basemap = 'terrain' | 'night' | 'satellite' | 'daily'

interface Props {
  basemap: Basemap
  data: FireData
  events: FireEvent[]
  emd: EmdCollection | null
  kfs: KfsFire[]
  gwis: GwisData | null
  focusCode: string | null
  t: number
  layers: Layers
  selected: string | null
  onSelectEvent: (id: string) => void
}

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
// NASA GIBS daily true-colour imagery (VIIRS on Suomi-NPP, ~13:30 local overpass). Keyless WMTS.
const GIBS = (date: string) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
// KST calendar date for a timeline minute (t0 = 2025-03-21)
const kstDate = (t: number) => `2025-03-${String(21 + Math.floor(t / 1440)).padStart(2, '0')}`

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
    features: data.hotspots.map(([lon, lat, t, frp, sat]) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lon, lat] },
      properties: { t, frp, sat },
    })),
  }
}

function windGeoJSON(data: FireData, t: number) {
  const i = hourIndex(t)
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
  const i = hourIndex(t)
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

export default function MapView({ basemap, data, events, emd, kfs, gwis, focusCode, t, layers, selected, onSelectEvent }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const hillshadeKey = useRef('')
  const dailyKey = useRef('')
  const stationEls = useRef<HTMLDivElement[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)
  const latest = useRef({ t, layers, events, selected, basemap, emd, kfs, gwis })
  latest.current = { t, layers, events, selected, basemap, emd, kfs, gwis }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
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
      center: [129.0, 36.38],
      zoom: 9.2,
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

      // JRC GWIS near-real-time fire perimeter estimates (MODIS 1 km + VIIRS 375 m) — an independent agency's outline
      map.addSource('gwis', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'gwis',
        type: 'line',
        source: 'gwis',
        paint: { 'line-color': '#1d9a8c', 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'emd-focus',
        type: 'line',
        source: 'emd',
        paint: { 'line-color': '#1f4fd1', 'line-width': 3 },
        filter: ['==', ['get', 'code'], ''],
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

      ready.current = true
      apply(map)
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function apply(map: maplibregl.Map) {
    if (!ready.current) return
    const { t, layers, events, selected, basemap, emd, kfs } = latest.current
    const b = BASE[basemap]
    if (emd) (map.getSource('emd') as GeoJSONSource).setData(emd as never)
    if (gwis) (map.getSource('gwis') as GeoJSONSource).setData(gwis as never)
    map.setFilter('gwis', ['<=', ['get', 't_start_minutes'], t])
    map.setLayoutProperty('gwis', 'visibility', layers.gwis ? 'visible' : 'none')
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
    const hi = hourIndex(t)
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

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, layers, events, selected, basemap, emd, kfs, gwis])


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
