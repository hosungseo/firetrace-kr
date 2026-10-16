import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FireData, FireEvent } from './types'
import { ACTIVE_WINDOW, hourIndex } from './time'

export interface Layers {
  burned: boolean
  active: boolean
  wind: boolean
  events: boolean
  terrain: boolean
}

interface Props {
  data: FireData
  events: FireEvent[]
  t: number
  layers: Layers
  selected: string | null
  onSelectEvent: (id: string) => void
}

const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

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

function eventGeoJSON(events: FireEvent[]) {
  return {
    type: 'FeatureCollection' as const,
    features: events
      .filter((e) => e.lat != null && e.lon != null)
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [e.lon!, e.lat!] },
        properties: { id: e.id, t: e.t ?? 0, title: e.title },
      })),
  }
}

export default function MapView({ data, events, t, layers, selected, onSelectEvent }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const ready = useRef(false)
  const latest = useRef({ t, layers, events, selected })
  latest.current = { t, layers, events, selected }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: {
        version: 8,
        sources: {
          imagery: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 17, attribution: 'Imagery © Esri' },
          dem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
          hillshadeDem: { type: 'raster-dem', tiles: [DEM], tileSize: 256, encoding: 'terrarium', maxzoom: 14 },
        },
        layers: [
          { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-saturation': -0.25, 'raster-brightness-max': 0.92 } },
          { id: 'hillshade', type: 'hillshade', source: 'hillshadeDem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#2a1a0a' } },
        ],
      },
      center: [129.0, 36.38],
      zoom: 9.2,
      pitch: 55,
      bearing: -12,
      maxPitch: 75,
      attributionControl: { compact: true, customAttribution: 'Fire: NASA FIRMS · Weather: Open-Meteo (ERA5) · DEM: AWS Terrain Tiles' },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')

    map.on('load', () => {
      map.setTerrain({ source: 'dem', exaggeration: 1.6 })
      map.addImage('arrow', arrowImage(), { pixelRatio: 2, sdf: true })

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
      map.on('click', 'events', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id
        if (id) onSelectEvent(String(id))
      })
      map.on('mouseenter', 'events', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'events', () => (map.getCanvas().style.cursor = ''))

      ready.current = true
      apply(map)
    })
    return () => map.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function apply(map: maplibregl.Map) {
    if (!ready.current) return
    const { t, layers, events, selected } = latest.current
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
    map.setTerrain(layers.terrain ? { source: 'dem', exaggeration: 1.6 } : null)
  }

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, layers, events, selected])

  useEffect(() => {
    const ev = events.find((e) => e.id === selected)
    if (ev?.lat != null && ev.lon != null && mapRef.current) {
      mapRef.current.easeTo({ center: [ev.lon, ev.lat], duration: 900 })
    }
  }, [selected, events])

  return <div ref={el} className="map" />
}
