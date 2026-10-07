import { useEffect, useRef, useState } from 'react'
import { Map as MLMap } from 'maplibre-gl'
import { inkStyle, MAP_PALETTES, registerPatterns } from '../lib/mapStyle'
import { getTheme, useTheme } from '../lib/theme'

/**
 * A small, still map of somewhere nice on the home page. Each time the app
 * loads it shows the next place in the list (in order), then a completely
 * random spot on Earth, then starts over.
 */
interface Place {
  name: string
  where: string
  lng: number
  lat: number
  zoom: number
}

const PLACES: Place[] = [
  { name: 'Aarey Milk Colony', where: 'Mumbai', lng: 72.8756, lat: 19.1563, zoom: 14 },
  { name: 'Shivaji Park', where: 'Mumbai', lng: 72.8384, lat: 19.0272, zoom: 15.5 },
  { name: 'Kensington Market', where: 'Toronto', lng: -79.4005, lat: 43.6547, zoom: 16 },
  { name: 'Old Town', where: 'Toronto', lng: -79.3717, lat: 43.6497, zoom: 15.5 },
  { name: 'Christie Pits', where: 'Toronto', lng: -79.4206, lat: 43.6647, zoom: 15.5 },
  { name: 'Malana', where: 'Himachal Pradesh, India', lng: 77.2603, lat: 32.0631, zoom: 14.5 },
  { name: 'Manali', where: 'Himachal Pradesh, India', lng: 77.1887, lat: 32.2432, zoom: 14.5 },
  { name: 'Roopkund', where: 'Uttarakhand Himalayas, India', lng: 79.7317, lat: 30.2622, zoom: 16.5 },
  { name: 'Higashiyama', where: 'Kyoto, Japan', lng: 135.7808, lat: 34.9985, zoom: 15.5 },
  { name: 'French Concession', where: 'Shanghai, China', lng: 121.4553, lat: 31.2089, zoom: 15.5 },
  { name: 'Montmartre', where: 'Paris', lng: 2.3431, lat: 48.8867, zoom: 15.5 },
  { name: 'Greenwich Village', where: 'New York', lng: -74.0027, lat: 40.7336, zoom: 15.5 },
]
const RANDOM_SLOT = PLACES.length // the last stop in the cycle
const KEY = 'taw.placeIndex'

// Advance once per app load, not every time the home page re-renders.
let thisLoad: number | null = null
function placeIndexForThisLoad(): number {
  if (thisLoad !== null) return thisLoad
  let i = 0
  try {
    const prev = Number(localStorage.getItem(KEY))
    i = Number.isFinite(prev) && localStorage.getItem(KEY) !== null ? (prev + 1) % (PLACES.length + 1) : 0
    localStorage.setItem(KEY, String(i))
  } catch {
    /* no storage: always the first place */
  }
  thisLoad = i
  return i
}

function randomPoint(): Place {
  // Latitudes where people mostly live; the map checks for land and retries.
  const lat = -45 + Math.random() * 105
  const lng = -180 + Math.random() * 360
  return {
    name: 'Somewhere',
    where: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`,
    lng,
    lat,
    zoom: 12,
  }
}

export default function PlaceMap() {
  const el = useRef<HTMLDivElement>(null)
  const [index] = useState(placeIndexForThisLoad)
  const [place, setPlace] = useState<Place>(() => (index === RANDOM_SLOT ? randomPoint() : PLACES[index]))
  const [ready, setReady] = useState(false)
  const mapRef = useRef<MLMap | null>(null)
  const theme = useTheme()

  useEffect(() => {
    if (!el.current) return
    // Maps need WebGL. If this browser can't do it, the background just stays plain paper.
    let map: MLMap
    try {
      map = new MLMap({
        container: el.current,
        style: inkStyle(MAP_PALETTES[getTheme()]),
        center: [place.lng, place.lat],
        zoom: place.zoom,
        // Drag to pan, pinch or double-tap to zoom. The wheel still scrolls the page.
        scrollZoom: false,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      })
    } catch (e) {
      console.warn('background map unavailable', e)
      return
    }
    map.touchZoomRotate.disableRotation()
    registerPatterns(map, getTheme)
    mapRef.current = map
    let tries = 0
    const onIdle = () => {
      // For the random stop, keep looking until we land on somewhere with roads or buildings.
      if (index === RANDOM_SLOT && tries < 12) {
        const found = map.queryRenderedFeatures().some((f) => f.sourceLayer === 'transportation' || f.sourceLayer === 'building')
        if (!found) {
          tries++
          const next = randomPoint()
          setPlace(next)
          map.jumpTo({ center: [next.lng, next.lat], zoom: next.zoom })
          map.once('idle', onIdle)
          return
        }
      }
      setReady(true)
    }
    map.once('idle', onIdle)
    return () => {
      map.remove()
      mapRef.current = null
    }
    // The map is created once; `place` changes only move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching themes redraws the map in that theme's colours.
  const firstTheme = useRef(theme)
  useEffect(() => {
    const map = mapRef.current
    if (!map || theme === firstTheme.current) return
    firstTheme.current = theme
    map.setStyle(inkStyle(MAP_PALETTES[theme]))
  }, [theme])

  return (
    <figure className={`place-map ${ready ? 'ready' : ''}`} aria-label={`Map of ${place.name}, ${place.where}`}>
      <div ref={el} className="place-map-canvas" />
    </figure>
  )
}
