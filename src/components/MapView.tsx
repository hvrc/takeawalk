import { useEffect, useRef, useState } from 'react'
import { Map as MLMap, Marker, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl'
// MapLibre resolves its worker relative to its own module URL, which breaks once
// Vite bundles everything into hashed chunks. Let Vite bundle the worker too.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { GeoPoint, Member, Polaroid, Segment } from '../lib/types'
import { boundsOf } from '../lib/geo'
import { inkStyle, PAPER, registerPatterns } from '../lib/mapStyle'
import Walker from './Walker'

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
  /** Show photos as polaroids on the map; otherwise as small pins that keep the route clear. */
  showPolaroids: boolean
  /** Where to open: a finished walk at its start, an ongoing one where it is now. */
  focus: 'start' | 'current' | null
}

export default function MapView({
  segments,
  members,
  polaroids,
  meId,
  myFix,
  tracking,
  follow,
  onUserMove,
  onPolaroidClick,
  fitKey,
  showPolaroids,
  focus,
}: Props) {
  const el = useRef<HTMLDivElement>(null)
  // Covers the blank map until the style and first tiles have rendered.
  const [ready, setReady] = useState(false)
  const [noMap, setNoMap] = useState(false)
  const mapRef = useRef<MLMap | null>(null)
  const loaded = useRef(false)
  const readyQueue = useRef<Array<() => void>>([])
  const whenReady = (fn: () => void) => {
    if (loaded.current) fn()
    else readyQueue.current.push(fn)
  }
  const headMarkers = useRef<Map<string, Marker>>(new Map())
  const pinMarkers = useRef<Map<string, Marker>>(new Map())
  const layoutRef = useRef<() => void>(() => undefined)
  const didInitialFit = useRef(false)
  const clickRef = useRef(onPolaroidClick)
  clickRef.current = onPolaroidClick
  const moveRef = useRef(onUserMove)
  moveRef.current = onUserMove

  // Create map once.
  useEffect(() => {
    if (!el.current || mapRef.current) return
    let map: MLMap
    try {
      map = new MLMap({
        container: el.current,
        style: inkStyle(),
        center: [0, 20],
        zoom: 1.5,
        attributionControl: { compact: true },
        pitchWithRotate: false,
        dragRotate: false,
      })
    } catch (e) {
      // No WebGL (switched off, or an old graphics card): say so instead of crashing the app.
      console.warn('map unavailable', e)
      setNoMap(true)
      return
    }
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
    // Pins shrink as you zoom out; groups are recomputed once a zoom settles.
    const setPinScale = () => el.current?.style.setProperty('--pin-scale', String(pinScale(map.getZoom())))
    setPinScale()
    map.on('zoom', setPinScale)
    map.on('zoomend', () => layoutRef.current())
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
      const pos = id === meId ? (myFix ?? m.lastPos) : m.lastPos
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

  // Switching between pins and polaroids rebuilds the markers.
  useEffect(() => {
    for (const marker of pinMarkers.current.values()) marker.remove()
    pinMarkers.current.clear()
  }, [showPolaroids])

  // Photo markers. Pins (default) shrink as you zoom out, and below
  // GROUP_BELOW_ZOOM pins that would overlap merge into one numbered group;
  // tapping a group zooms in until it splits. Polaroid mode shows every photo.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layout = () => {
      type Spot = { key: string; lng: number; lat: number; items: Polaroid[] }
      const spots: Spot[] = []
      if (showPolaroids || map.getZoom() >= GROUP_BELOW_ZOOM) {
        polaroids.forEach((p) => spots.push({ key: `p:${p.id}`, lng: p.lng, lat: p.lat, items: [p] }))
      } else {
        // Greedy screen-space grouping: each photo joins the first group whose seed is within reach.
        const groups: Array<{ x: number; y: number; items: Polaroid[] }> = []
        for (const p of polaroids) {
          const pt = map.project([p.lng, p.lat])
          const g = groups.find((g) => Math.hypot(g.x - pt.x, g.y - pt.y) < GROUP_RADIUS_PX)
          if (g) g.items.push(p)
          else groups.push({ x: pt.x, y: pt.y, items: [p] })
        }
        for (const g of groups) {
          if (g.items.length === 1) {
            const p = g.items[0]
            spots.push({ key: `p:${p.id}`, lng: p.lng, lat: p.lat, items: [p] })
          } else {
            const lng = g.items.reduce((a, p) => a + p.lng, 0) / g.items.length
            const lat = g.items.reduce((a, p) => a + p.lat, 0) / g.items.length
            spots.push({
              key: `g:${g.items
                .map((p) => p.id)
                .sort()
                .join(',')}`,
              lng,
              lat,
              items: g.items,
            })
          }
        }
      }

      const wanted = new Set<string>()
      spots.forEach((spot, i) => {
        wanted.add(spot.key)
        let marker = pinMarkers.current.get(spot.key)
        const p = spot.items[0]
        if (!marker) {
          const node = document.createElement('div')
          if (spot.items.length > 1) {
            node.className = 'pin-group'
            node.setAttribute('role', 'button')
            node.setAttribute('aria-label', `${spot.items.length} photos here`)
            node.innerHTML = `<span>${spot.items.length}</span>`
            const items = spot.items
            node.addEventListener('click', (e) => {
              e.stopPropagation()
              const b = boundsOf(items.map((q) => ({ lat: q.lat, lng: q.lng, t: 0, acc: 0 })))
              if (!b) return
              map.fitBounds(
                [
                  [b.minLng, b.minLat],
                  [b.maxLng, b.maxLat],
                ],
                {
                  padding: { top: 140, bottom: 240, left: 60, right: 60 },
                  maxZoom: GROUP_BELOW_ZOOM + 1,
                  duration: 600,
                },
              )
            })
            marker = new Marker({ element: node, anchor: 'center' }).setLngLat([spot.lng, spot.lat]).addTo(map)
          } else if (!showPolaroids) {
            node.className = 'pin-photo'
            node.setAttribute('role', 'button')
            node.setAttribute('aria-label', p.caption ? `Photo: ${p.caption}` : 'Photo')
            node.innerHTML = `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 30.5C7 23.6 2 18.3 2 12a10 10 0 0120 0c0 6.3-5 11.6-10 18.5z"/><circle cx="12" cy="12" r="3.6"/></svg>`
            node.addEventListener('click', (e) => {
              e.stopPropagation()
              clickRef.current(p.id)
            })
            marker = new Marker({ element: node, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map)
          } else {
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
          }
          pinMarkers.current.set(spot.key, marker)
        }
        const node = marker.getElement()
        node.style.zIndex = String(spot.items.length > 1 ? 1000 + i : i + 1)
        node.style.setProperty('--c', dominantColor(spot.items))
        node.classList.toggle(
          'pending',
          spot.items.some((q) => q.pending),
        )
        const img = node.querySelector('img') as HTMLImageElement | null
        if (img && img.getAttribute('src') !== p.imageUrl) img.src = p.imageUrl
        const cap = node.querySelector('.polaroid-caption')
        if (cap) cap.textContent = p.caption.length > 14 ? p.caption.slice(0, 13) + '…' : p.caption
      })
      for (const [key, marker] of pinMarkers.current) {
        if (!wanted.has(key)) {
          marker.remove()
          pinMarkers.current.delete(key)
        }
      }
    }
    layoutRef.current = layout
    layout()
  }, [polaroids, showPolaroids])

  // Follow my position while tracking
  useEffect(() => {
    const map = mapRef.current
    if (!map || !myFix || !follow) return
    const z = map.getZoom()
    map.easeTo({ center: [myFix.lng, myFix.lat], zoom: z < 15 ? 16.5 : z, duration: 600 })
  }, [myFix, follow])

  // Opening view: zoom to where the walk started (finished) or where it is now (ongoing).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus || fitKey !== 0 || didInitialFit.current) return
    let at: { lat: number; lng: number } | null = null
    if (focus === 'start') {
      const first = [...segments].filter((s) => s.points.length).sort((a, b) => a.startedAt - b.startedAt)[0]
      at = first?.points[0] ?? [...polaroids].sort((a, b) => a.takenAt - b.takenAt)[0] ?? null
    } else {
      let best: { lat: number; lng: number; t: number } | null = myFix
      for (const m of Object.values(members)) if (m.lastPos && (!best || m.lastPos.t > best.t)) best = m.lastPos
      for (const s of segments) {
        const last = s.points[s.points.length - 1]
        if (last && (!best || last.t > best.t)) best = last
      }
      at = best
    }
    if (!at) return
    const target = at
    didInitialFit.current = true
    whenReady(() => map.jumpTo({ center: [target.lng, target.lat], zoom: 16.5 }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, segments.length > 0, polaroids.length > 0, myFix !== null])

  // Fit to everything (on request, or initially if there's no focus point)
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
    if (fitKey === 0 && (didInitialFit.current || focus)) return
    whenReady(run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, segments.length > 0, polaroids.length > 0, myFix !== null])

  return (
    <>
      <div ref={el} className="map" />
      {noMap ? (
        <div className="map-loading no-map">
          <Walker variant="dotted" color="var(--ink)" size={44} looking />
          <span>This browser can't show the map</span>
          <small>Maps need WebGL. Try turning on hardware acceleration in your browser settings, or use another browser. Everything else still works.</small>
        </div>
      ) : (
        <div className={`map-loading ${ready ? 'done' : ''}`} aria-hidden={ready}>
          <Walker variant="dotted" color="var(--leaf)" size={44} walking />
          <span>Loading map…</span>
        </div>
      )}
    </>
  )
}

const GROUP_BELOW_ZOOM = 15.5
const GROUP_RADIUS_PX = 40

/** 1 at street level (zoom 16+), down to 0.5 by zoom 12. */
function pinScale(zoom: number): number {
  return Math.min(1, Math.max(0.5, 0.5 + ((zoom - 12) / 4) * 0.5))
}

/** The colour most of these photos share (whoever took most of them). */
function dominantColor(items: Polaroid[]): string {
  const n = new Map<string, number>()
  for (const p of items) n.set(p.color, (n.get(p.color) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
