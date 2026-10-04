import { useEffect, useRef, useState } from 'react'
import { Map as MLMap, Marker, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl'
// MapLibre resolves its worker relative to its own module URL, which breaks once
// Vite bundles everything into hashed chunks. Let Vite bundle the worker too.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { GeoPoint, Member, Polaroid, Segment } from '../lib/types'
import { boundsOf } from '../lib/geo'
import { inkStyle, PAPER, registerPatterns } from '../lib/mapStyle'

setWorkerUrl(maplibreWorkerUrl)

interface Props {
  segments: Segment[]
  members: Record<string, Member>
  polaroids: Polaroid[]
  meId: string
  myFix: GeoPoint | null
  tracking: boolean
  /** When true the map keeps following myFix. Cleared on user drag. */
  follow: boolean
  onUserMove: () => void
  onPolaroidClick: (id: string) => void
  /** Increment to request a fit-to-everything. */
  fitKey: number
}

export default function MapView({ segments, members, polaroids, meId, myFix, tracking, follow, onUserMove, onPolaroidClick, fitKey }: Props) {
  const el = useRef<HTMLDivElement>(null)
  // Covers the blank map until the style and first tiles have rendered.
  const [ready, setReady] = useState(false)
  const mapRef = useRef<MLMap | null>(null)
  const loaded = useRef(false)
  const readyQueue = useRef<Array<() => void>>([])
  const whenReady = (fn: () => void) => {
    if (loaded.current) fn()
    else readyQueue.current.push(fn)
  }
  const headMarkers = useRef<Map<string, Marker>>(new Map())
  const pinMarkers = useRef<Map<string, Marker>>(new Map())
  const didInitialFit = useRef(false)
  const clickRef = useRef(onPolaroidClick)
  clickRef.current = onPolaroidClick
  const moveRef = useRef(onUserMove)
  moveRef.current = onUserMove

  // Create map once.
  useEffect(() => {
    if (!el.current || mapRef.current) return
    const map = new MLMap({
      container: el.current,
      style: inkStyle(),
      center: [0, 20],
      zoom: 1.5,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    registerPatterns(map)
    map.once('idle', () => setReady(true))
    // Never leave the overlay up forever on a flaky connection.
    const readyTimeout = setTimeout(() => setReady(true), 20_000)
    map.on('load', () => {
      map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': PAPER, 'line-width': 8, 'line-opacity': 0.9 },
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 },
      })
      loaded.current = true
      const q = readyQueue.current
      readyQueue.current = []
      q.forEach((fn) => fn())
    })
    const userMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) moveRef.current()
    }
    map.on('dragstart', userMove)
    map.on('zoomstart', userMove)
    mapRef.current = map
    return () => {
      clearTimeout(readyTimeout)
      map.remove()
      mapRef.current = null
      loaded.current = false
    }
  }, [])

  // Routes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const src = map.getSource('routes') as GeoJSONSource | undefined
      if (!src) return
      src.setData({
        type: 'FeatureCollection',
        features: segments
          .filter((s) => s.points.length >= 2)
          .map((s) => ({
            type: 'Feature',
            properties: { color: s.color, memberId: s.memberId },
            geometry: { type: 'LineString', coordinates: s.points.map((p) => [p.lng, p.lat]) },
          })),
      })
    }
    whenReady(apply)
  }, [segments])

  // Head markers (other walkers' latest positions + mine)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const wanted = new Set<string>()
    const now = Date.now()
    for (const [id, m] of Object.entries(members)) {
      const pos = id === meId ? myFix ?? m.lastPos : m.lastPos
      if (!pos) continue
      const recent = id === meId ? true : now - m.lastSeenAt < 60 * 60_000
      if (!recent && !m.tracking) continue
      wanted.add(id)
      const live = id === meId ? tracking : !!m.tracking && now - m.lastSeenAt < 5 * 60_000
      let marker = headMarkers.current.get(id)
      if (!marker) {
        const node = document.createElement('div')
        node.className = 'head-marker'
        node.innerHTML = `<div class="ring"></div><div class="core"></div><div class="label"></div>`
        marker = new Marker({ element: node, anchor: 'center' }).setLngLat([pos.lng, pos.lat]).addTo(map)
        headMarkers.current.set(id, marker)
      } else {
        marker.setLngLat([pos.lng, pos.lat])
      }
      const node = marker.getElement()
      node.style.setProperty('--c', m.color)
      node.classList.toggle('live', live)
      node.querySelector('.label')!.textContent = id === meId ? 'you' : m.name
    }
    for (const [id, marker] of headMarkers.current) {
      if (!wanted.has(id)) {
        marker.remove()
        headMarkers.current.delete(id)
      }
    }
  }, [members, meId, myFix, tracking])

  // Polaroid pins
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const wanted = new Set<string>()
    polaroids.forEach((p, i) => {
      wanted.add(p.id)
      let marker = pinMarkers.current.get(p.id)
      if (!marker) {
        const node = document.createElement('div')
        node.className = 'pin-polaroid'
        node.style.width = '56px'
        const angle = ((hash(p.id) % 17) - 8) * 1.1
        node.style.transform = `rotate(${angle}deg)`
        node.innerHTML = `
          <div class="polaroid thumb"><div class="polaroid-photo"><img alt="" draggable="false"/></div><div class="polaroid-caption"></div></div>
          <div class="pin-tack"></div>`
        node.addEventListener('click', (e) => {
          e.stopPropagation()
          clickRef.current(p.id)
        })
        marker = new Marker({ element: node, anchor: 'bottom', offset: [0, 6] }).setLngLat([p.lng, p.lat]).addTo(map)
        pinMarkers.current.set(p.id, marker)
      }
      const node = marker.getElement()
      node.style.zIndex = String(i + 1)
      node.style.setProperty('--c', p.color)
      node.classList.toggle('pending', !!p.pending)
      const img = node.querySelector('img') as HTMLImageElement
      if (img.getAttribute('src') !== p.imageUrl) img.src = p.imageUrl
      node.querySelector('.polaroid-caption')!.textContent = p.caption.length > 14 ? p.caption.slice(0, 13) + '…' : p.caption
    })
    for (const [id, marker] of pinMarkers.current) {
      if (!wanted.has(id)) {
        marker.remove()
        pinMarkers.current.delete(id)
      }
    }
  }, [polaroids])

  // Follow my position while tracking
  useEffect(() => {
    const map = mapRef.current
    if (!map || !myFix || !follow) return
    const z = map.getZoom()
    map.easeTo({ center: [myFix.lng, myFix.lat], zoom: z < 15 ? 16.5 : z, duration: 600 })
  }, [myFix, follow])

  // Fit to everything (initial load and on request)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const run = () => {
      const pts: { lat: number; lng: number }[] = []
      for (const s of segments) pts.push(...s.points)
      for (const p of polaroids) pts.push({ lat: p.lat, lng: p.lng })
      for (const m of Object.values(members)) if (m.lastPos) pts.push(m.lastPos)
      if (myFix) pts.push(myFix)
      const b = boundsOf(pts)
      if (!b) return
      didInitialFit.current = true
      if (pts.length === 1) {
        map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 16.5 })
        return
      }
      const bounds: LngLatBoundsLike = [
        [b.minLng, b.minLat],
        [b.maxLng, b.maxLat],
      ]
      map.fitBounds(bounds, { padding: { top: 130, bottom: 220, left: 50, right: 50 }, maxZoom: 17.5, duration: fitKey ? 700 : 0 })
    }
    if (fitKey === 0 && didInitialFit.current) return
    whenReady(run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, segments.length > 0, polaroids.length > 0, myFix !== null])

  return (
    <>
      <div ref={el} className="map" />
      <div className={`map-loading ${ready ? 'done' : ''}`} aria-hidden={ready}>
        <span className="spinner" />
        <span>Loading map…</span>
      </div>
    </>
  )
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
