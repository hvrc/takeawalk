import type { ExpressionSpecification, Map as MLMap, StyleSpecification } from 'maplibre-gl'

// Hand-drawn "ink on paper" map, in the spirit of a printed campground map:
// cream paper, stippled woods and fields, roads as double ink lines, spaced
// uppercase labels. Data is OpenFreeMap's OpenMapTiles schema (no API key).

export const PAPER = '#efe9dc'
export const INK = '#2b2622'
const INK_SOFT = '#6b625a'

// Pale watercolour washes laid under the ink. Each becomes a mottled pattern
// (see wash() below); `edge` is the deeper tint that pools along the borders.
const WASH = {
  paper: { base: PAPER },
  forest: { base: '#cfdcb6', edge: '#a9bf8c' },
  meadow: { base: '#e3e7c4', edge: '#c6cf9a' },
  wheat: { base: '#ede1bd', edge: '#d9c58f' },
  sand: { base: '#f1e4c3', edge: '#ddc993' },
  water: { base: '#c8dde3', edge: '#93bccb' },
  building: { base: '#f0e0d4' },
  civic: { base: '#f0dccd' },
  industry: { base: '#e4dde3' },
}
const ROAD_MAJOR = '#f3dea3'
const ROAD_MINOR = '#f8f1df'

const FONT = ['Noto Sans Bold']
const FONT_ITALIC = ['Noto Sans Italic']

const z = (stops: Array<[number, number]>): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.flat()] as unknown as ExpressionSpecification

const polygons: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const lines: ExpressionSpecification = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel']

// Paper-coloured road widths per class; the ink casing is drawn ~2.4px wider.
const ROAD_W: Record<string, Array<[number, number]>> = {
  major: [[8, 1], [12, 3], [15, 7], [18, 22]],
  minor: [[12, 0.6], [14, 2.2], [16, 5], [18, 14]],
  service: [[14, 0.5], [16, 2.5], [18, 7]],
}
const roadGroups: Array<{ id: string; classes: string[]; w: Array<[number, number]>; minzoom: number }> = [
  { id: 'service', classes: ['service', 'track'], w: ROAD_W.service, minzoom: 14 },
  { id: 'minor', classes: ['minor'], w: ROAD_W.minor, minzoom: 12 },
  { id: 'major', classes: ['tertiary', 'secondary', 'primary', 'trunk', 'motorway'], w: ROAD_W.major, minzoom: 6 },
]
const casingStops = (w: Array<[number, number]>): Array<[number, number]> => w.map(([zz, v]) => [zz, v + 2.4])

type WashName = keyof typeof WASH

function washFill(id: string, sourceLayer: string, classes: string[], wash: WashName) {
  return {
    id,
    type: 'fill' as const,
    source: 'openmaptiles',
    'source-layer': sourceLayer,
    filter: ['all', polygons, ['match', ['get', 'class'], classes, true, false]] as ExpressionSpecification,
    paint: { 'fill-pattern': `wash-${wash}` },
  }
}

// Watercolour pools pigment at the edge of a wash: a soft, deeper band.
function edgeBloom(id: string, sourceLayer: string, classes: string[] | null, color: string) {
  return {
    id,
    type: 'line' as const,
    source: 'openmaptiles',
    'source-layer': sourceLayer,
    minzoom: 11,
    filter: (classes
      ? ['all', polygons, ['match', ['get', 'class'], classes, true, false]]
      : polygons) as ExpressionSpecification,
    layout: { 'line-join': 'round' as const },
    paint: { 'line-color': color, 'line-opacity': 0.55, 'line-width': z([[11, 2], [16, 6]]), 'line-blur': z([[11, 2], [16, 5]]) },
  }
}

export function inkStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'takeawalk ink',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-pattern': 'wash-paper' } },

      // Watercolour washes, all laid down before any ink.
      washFill('landuse-civic', 'landuse', ['school', 'university', 'college', 'hospital'], 'civic'),
      washFill('landuse-industry', 'landuse', ['industrial', 'railway'], 'industry'),
      washFill('sand', 'landcover', ['sand'], 'sand'),
      washFill('fields-wash', 'landcover', ['farmland'], 'wheat'),
      washFill('meadow-wash', 'landcover', ['grass', 'wetland'], 'meadow'),
      washFill('landuse-green-wash', 'landuse', ['cemetery', 'pitch', 'stadium', 'playground'], 'meadow'),
      { id: 'park-wash', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', filter: polygons, paint: { 'fill-pattern': 'wash-meadow' } },
      edgeBloom('park-bloom', 'park', null, WASH.meadow.edge),
      washFill('wood-wash', 'landcover', ['wood'], 'forest'),
      edgeBloom('wood-bloom', 'landcover', ['wood'], WASH.forest.edge),
      {
        id: 'water-wash',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['all', polygons, notTunnel],
        paint: { 'fill-pattern': 'wash-water' },
      },
      edgeBloom('water-bloom', 'water', null, WASH.water.edge),

      // Light stipple: fields, grass, parks, cemeteries, pitches.
      {
        id: 'fields',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['all', polygons, ['match', ['get', 'class'], ['grass', 'farmland', 'wetland'], true, false]],
        paint: { 'fill-pattern': 'stipple-light' },
      },
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['all', polygons, ['match', ['get', 'class'], ['cemetery', 'pitch', 'stadium', 'playground'], true, false]],
        paint: { 'fill-pattern': 'stipple-light' },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        filter: polygons,
        paint: { 'fill-pattern': 'stipple-light' },
      },
      {
        id: 'park-edge',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'park',
        minzoom: 12,
        filter: polygons,
        paint: { 'line-color': INK, 'line-width': 1, 'line-dasharray': [1, 2.5], 'line-opacity': 0.7 },
      },

      // Dense stipple: woods.
      {
        id: 'wood',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['all', polygons, ['==', ['get', 'class'], 'wood']],
        paint: { 'fill-pattern': 'stipple-dense' },
      },
      {
        id: 'wood-edge',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        minzoom: 12,
        filter: ['all', polygons, ['==', ['get', 'class'], 'wood']],
        paint: { 'line-color': INK, 'line-width': z([[12, 0.6], [16, 1.4]]) },
      },

      // Water: horizontal hatching with an ink shoreline.
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['all', polygons, notTunnel],
        paint: { 'fill-pattern': 'hatch' },
      },
      {
        id: 'water-edge',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['all', polygons, notTunnel],
        paint: { 'line-color': INK, 'line-width': z([[8, 0.6], [16, 1.6]]) },
      },
      {
        id: 'waterway-wash',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: ['all', lines, notTunnel],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': WASH.water.edge, 'line-opacity': 0.6, 'line-blur': 2, 'line-width': z([[10, 2], [16, 8]]) },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        filter: ['all', lines, notTunnel],
        paint: { 'line-color': INK, 'line-width': z([[10, 0.5], [16, 2]]) },
      },

      // Road casings first, then fills, so junctions merge into one outline.
      ...roadGroups.map((g) => ({
        id: `road-${g.id}-casing`,
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: g.minzoom,
        filter: ['all', lines, notTunnel, ['match', ['get', 'class'], g.classes, true, false]] as ExpressionSpecification,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': INK, 'line-width': z(casingStops(g.w)) },
      })),
      ...roadGroups.map((g) => ({
        id: `road-${g.id}`,
        type: 'line' as const,
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: g.minzoom,
        filter: ['all', lines, notTunnel, ['match', ['get', 'class'], g.classes, true, false]] as ExpressionSpecification,
        layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
        paint: { 'line-color': g.id === 'major' ? ROAD_MAJOR : ROAD_MINOR, 'line-width': z(g.w) },
      })),

      // Footpaths and trails: a dotted ink line.
      {
        id: 'path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 14,
        filter: ['all', lines, notTunnel, ['==', ['get', 'class'], 'path']],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': INK, 'line-opacity': 0.6, 'line-width': z([[14, 0.9], [18, 2]]), 'line-dasharray': [0.1, 2.4] },
      },
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 10,
        filter: ['all', lines, notTunnel, ['match', ['get', 'class'], ['rail', 'transit'], true, false]],
        paint: { 'line-color': INK, 'line-width': z([[10, 0.6], [16, 1.6]]), 'line-dasharray': [3, 1.5] },
      },

      // Buildings: paper with an ink outline, like the little drawn huts.
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'fill-pattern': 'wash-building' },
      },
      {
        id: 'building-edge',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 14,
        paint: { 'line-color': INK, 'line-width': z([[14, 0.5], [18, 1.6]]) },
      },

      // Labels: spaced uppercase ink with a paper halo.
      {
        id: 'water-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT_ITALIC,
          'text-size': 13,
          'text-letter-spacing': 0.15,
          'text-transform': 'uppercase',
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 2 },
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': z([[13, 9.5], [17, 12.5]]),
          'text-letter-spacing': 0.25,
          'text-transform': 'uppercase',
          'text-max-angle': 30,
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 2.5 },
      },
      {
        id: 'place-small',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        minzoom: 12,
        filter: ['match', ['get', 'class'], ['neighbourhood', 'quarter', 'suburb', 'hamlet', 'village'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-letter-spacing': 0.3,
          'text-transform': 'uppercase',
          'text-max-width': 8,
        },
        paint: { 'text-color': INK_SOFT, 'text-halo-color': PAPER, 'text-halo-width': 2.5 },
      },
      {
        id: 'place-big',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'state', 'country'], true, false],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': ['match', ['get', 'class'], 'country', 15, 'state', 12, 'city', 15, 13],
          'text-letter-spacing': 0.3,
          'text-transform': 'uppercase',
          'text-max-width': 8,
        },
        paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 3 },
      },
    ],
  }
}

// --- Patterns, drawn once on a canvas and handed to MapLibre on demand ---

const PX = 2 // device pixels per CSS pixel for crisp dots on phones
const TILE = 64 // CSS px; patterns repeat seamlessly at this size

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

// Jittered-grid stipple: one dot per cell, wrapped at the edges so it tiles.
function stipple(cell: number, rMin: number, rMax: number, seed: number) {
  const c = document.createElement('canvas')
  c.width = c.height = TILE * PX
  const g = c.getContext('2d')!
  g.scale(PX, PX)
  g.fillStyle = INK
  const r = rng(seed)
  const n = Math.round(TILE / cell)
  const step = TILE / n
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const x = (i + 0.15 + r() * 0.7) * step
      const y = (j + 0.15 + r() * 0.7) * step
      const rad = rMin + r() * (rMax - rMin)
      for (const dx of [-TILE, 0, TILE])
        for (const dy of [-TILE, 0, TILE]) {
          g.beginPath()
          g.arc(x + dx, y + dy, rad, 0, Math.PI * 2)
          g.fill()
        }
    }
  return g.getImageData(0, 0, c.width, c.height)
}

function hatch() {
  const c = document.createElement('canvas')
  c.width = c.height = TILE * PX
  const g = c.getContext('2d')!
  g.scale(PX, PX)
  g.strokeStyle = INK
  g.globalAlpha = 0.28
  g.lineWidth = 0.9
  for (let y = TILE / 12; y < TILE; y += TILE / 6) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(TILE, y)
    g.stroke()
  }
  return g.getImageData(0, 0, c.width, c.height)
}

const WASH_TILE = 256 // large so the mottling doesn't visibly repeat

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// A pale base colour, mottled with soft lighter and deeper blooms and a little
// paper grain. Blobs are drawn wrapped so the tile repeats seamlessly.
function wash(hex: string, seed: number, strength = 1) {
  const size = WASH_TILE * PX
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.scale(PX, PX)
  g.fillStyle = hex
  g.fillRect(0, 0, WASH_TILE, WASH_TILE)
  const r = rng(seed)
  const [cr, cg, cb] = hexRgb(hex)
  for (let i = 0; i < 46; i++) {
    const x = r() * WASH_TILE
    const y = r() * WASH_TILE
    const rad = 18 + r() * 60
    const darker = r() < 0.5
    const k = darker ? 0.86 : 1.08
    const col = `${Math.min(255, cr * k) | 0},${Math.min(255, cg * k) | 0},${Math.min(255, cb * k) | 0}`
    const a = (0.16 + r() * 0.2) * strength
    for (const dx of [-WASH_TILE, 0, WASH_TILE])
      for (const dy of [-WASH_TILE, 0, WASH_TILE]) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad)
        grd.addColorStop(0, `rgba(${col},${a})`)
        grd.addColorStop(0.7, `rgba(${col},${a * 0.6})`)
        grd.addColorStop(1, `rgba(${col},0)`)
        g.fillStyle = grd
        g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2)
      }
  }
  const img = g.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 9
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  return img
}

const PATTERNS: Record<string, () => ImageData> = {
  ...Object.fromEntries(
    Object.entries(WASH).map(([name, w], i) => [`wash-${name}`, () => wash(w.base, 101 + i * 17, name === 'paper' ? 0.3 : 1)]),
  ),
  'stipple-dense': () => stipple(4.2, 0.85, 1.35, 7),
  'stipple-light': () => stipple(9, 0.6, 0.95, 11),
  hatch,
}

/** Generates the hand-drawn fill patterns when the style first asks for them. */
export function registerPatterns(map: MLMap) {
  const add = (id: string) => {
    const make = PATTERNS[id]
    if (make && !map.hasImage(id)) map.addImage(id, make(), { pixelRatio: PX })
  }
  // Background patterns aren't requested through the resolver, so add every
  // pattern as soon as the style exists; the resolver covers any race.
  map.on('style.load', () => Object.keys(PATTERNS).forEach(add))
  map.setMissingStyleImageResolver(add)
}
