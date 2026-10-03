import type { GeoPoint } from './types'

export type TrackerState = 'idle' | 'starting' | 'tracking' | 'paused' | 'autopaused'

export interface TrackerCallbacks {
  /** Create a new segment and return its id. */
  onSegmentStart: () => Promise<string>
  /** Persist points for the current segment. prev is the last point already persisted. */
  onPoints: (segId: string, points: GeoPoint[], prev: GeoPoint | null) => Promise<void>
  onSegmentEnd: (segId: string | null) => Promise<void>
  onState: (state: TrackerState) => void
  /** Every raw fix, filtered or not. Useful for the "you are here" marker. */
  onFix: (fix: GeoPoint) => void
  onError: (message: string) => void
}

const FLUSH_MS = 8000
const FLUSH_AT = 12
/** Reject fixes less accurate than this unless we've been starved. */
const MAX_ACC_M = 50
const RELAXED_ACC_M = 120
const STARVED_MS = 60_000
/** Don't record a point unless we've moved at least this far. */
const MIN_DIST_M = 5
/** Teleport filter: anything faster than this is a GPS jump. */
const MAX_SPEED_MPS = 15
/** Backgrounded longer than this starts a fresh segment on return. */
const GAP_FOR_NEW_SEGMENT_MS = 90_000
/** Roll to a fresh segment before a Firestore doc gets unwieldy. */
const SEGMENT_MAX_POINTS = 1500

function dist(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

export class Tracker {
  state: TrackerState = 'idle'
  lastFix: GeoPoint | null = null
  /** Last point actually written to the current segment. */
  lastPoint: GeoPoint | null = null
  segId: string | null = null
  segPointCount = 0
  sessionPoints = 0
  sessionDistanceM = 0
  sessionStartedAt: number | null = null
  /** Milliseconds spent tracking, excluding pauses. */
  private activeMs = 0
  private activeSince: number | null = null

  private watchId: number | null = null
  private buffer: GeoPoint[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private wakeLock: WakeLockSentinel | null = null
  private hiddenAt: number | null = null
  private flushing: Promise<void> = Promise.resolve()
  private lastAcceptedAt = 0

  private cb: TrackerCallbacks

  constructor(cb: TrackerCallbacks) {
    this.cb = cb
    this.onVisibility = this.onVisibility.bind(this)
    this.onPageHide = this.onPageHide.bind(this)
  }

  get elapsedMs(): number {
    return this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0)
  }

  private setState(s: TrackerState) {
    this.state = s
    this.cb.onState(s)
  }

  async start() {
    if (this.state !== 'idle') return
    if (!('geolocation' in navigator)) {
      this.cb.onError('This browser has no location support.')
      return
    }
    this.setState('starting')
    this.sessionStartedAt = Date.now()
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('pagehide', this.onPageHide)
    try {
      // Fresh fix first so the walk starts where you actually are.
      await this.recalibrate()
      this.segId = await this.cb.onSegmentStart()
      this.segPointCount = 0
      this.lastPoint = null
    } catch (e) {
      this.cleanupListeners()
      this.setState('idle')
      this.cb.onError(describeGeoError(e))
      return
    }
    this.beginWatch()
    this.activeSince = Date.now()
    this.setState('tracking')
  }

  /** Request a current high-accuracy position; resolves with the raw fix. */
  recalibrate(): Promise<GeoPoint> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix = toPoint(pos)
          this.lastFix = fix
          this.cb.onFix(fix)
          resolve(fix)
        },
        reject,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
      )
    })
  }

  async pause(reason: 'manual' | 'auto' = 'manual') {
    if (this.state !== 'tracking' && this.state !== 'starting') return
    this.stopWatch()
    if (this.activeSince) {
      this.activeMs += Date.now() - this.activeSince
      this.activeSince = null
    }
    await this.flush()
    if (reason === 'manual') {
      await this.cb.onSegmentEnd(this.segId)
      this.segId = null
      this.setState('paused')
    } else {
      this.hiddenAt = Date.now()
      this.setState('autopaused')
    }
  }

  async resume() {
    if (this.state !== 'paused' && this.state !== 'autopaused') return
    const wasAuto = this.state === 'autopaused'
    const gap = this.hiddenAt ? Date.now() - this.hiddenAt : 0
    this.hiddenAt = null
    this.setState('starting')
    try {
      if (!wasAuto || gap > GAP_FOR_NEW_SEGMENT_MS || !this.segId) {
        if (this.segId) await this.cb.onSegmentEnd(this.segId)
        await this.recalibrate()
        this.segId = await this.cb.onSegmentStart()
        this.segPointCount = 0
        this.lastPoint = null
      }
    } catch (e) {
      this.setState('paused')
      this.cb.onError(describeGeoError(e))
      return
    }
    this.beginWatch()
    this.activeSince = Date.now()
    this.setState('tracking')
  }

  /** Finish the walk. Flushes and closes the open segment. */
  async stop() {
    if (this.state === 'idle') return
    this.stopWatch()
    if (this.activeSince) {
      this.activeMs += Date.now() - this.activeSince
      this.activeSince = null
    }
    this.cleanupListeners()
    await this.flush()
    await this.cb.onSegmentEnd(this.segId)
    this.segId = null
    this.setState('idle')
  }

  private beginWatch() {
    this.stopWatch()
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handleFix(toPoint(pos)),
      (err) => {
        // Transient timeouts are normal under tree cover; only surface denials.
        if (err.code === err.PERMISSION_DENIED) this.cb.onError(describeGeoError(err))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_MS)
    void this.acquireWakeLock()
  }

  private stopWatch() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId)
      this.watchId = null
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    void this.releaseWakeLock()
  }

  private handleFix(fix: GeoPoint) {
    this.lastFix = fix
    this.cb.onFix(fix)
    if (this.state !== 'tracking') return

    const starved = Date.now() - this.lastAcceptedAt > STARVED_MS
    const accLimit = starved ? RELAXED_ACC_M : MAX_ACC_M
    if (fix.acc > accLimit) return

    const prev = this.buffer.length ? this.buffer[this.buffer.length - 1] : this.lastPoint
    if (prev) {
      const d = dist(prev, fix)
      const dt = Math.max(0.001, (fix.t - prev.t) / 1000)
      if (d < MIN_DIST_M) return
      if (d / dt > MAX_SPEED_MPS && dt < 60) return
      this.sessionDistanceM += d
    }
    this.buffer.push(fix)
    this.sessionPoints++
    this.lastAcceptedAt = Date.now()
    if (this.buffer.length >= FLUSH_AT) void this.flush()
  }

  /** Serialised: one flush at a time, in order. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.doFlush()).catch(() => undefined)
    return this.flushing
  }

  private async doFlush() {
    if (this.buffer.length === 0 || !this.segId) return
    const points = this.buffer
    this.buffer = []
    const segId = this.segId
    const prev = this.lastPoint
    try {
      await this.cb.onPoints(segId, points, prev)
      this.lastPoint = points[points.length - 1]
      this.segPointCount += points.length
      if (this.segPointCount >= SEGMENT_MAX_POINTS && this.state === 'tracking') {
        await this.cb.onSegmentEnd(segId)
        this.segId = await this.cb.onSegmentStart()
        this.segPointCount = 0
        // Carry the last point so the line stays continuous across the roll.
        if (this.lastPoint) {
          await this.cb.onPoints(this.segId, [this.lastPoint], null)
          this.segPointCount = 1
        }
      }
    } catch (e) {
      // Put them back at the front and try again on the next tick.
      this.buffer = [...points, ...this.buffer]
      throw e
    }
  }

  private onVisibility() {
    if (document.visibilityState === 'hidden') {
      if (this.state === 'tracking' || this.state === 'starting') void this.pause('auto')
    } else {
      if (this.state === 'autopaused') void this.resume()
      else if (this.state === 'tracking') void this.acquireWakeLock()
    }
  }

  private onPageHide() {
    void this.flush()
  }

  private cleanupListeners() {
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('pagehide', this.onPageHide)
  }

  private async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen')
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null
        })
      }
    } catch {
      // Wake lock is best effort (needs HTTPS + visible page).
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLock?.release()
    } catch {
      /* ignore */
    }
    this.wakeLock = null
  }
}

function toPoint(pos: GeolocationPosition): GeoPoint {
  return {
    lat: round6(pos.coords.latitude),
    lng: round6(pos.coords.longitude),
    t: pos.timestamp || Date.now(),
    acc: Math.round(pos.coords.accuracy ?? 999),
  }
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6
}

export function describeGeoError(e: unknown): string {
  const err = e as GeolocationPositionError | Error
  if (err && 'code' in err) {
    if (err.code === 1) return 'Location permission denied. Allow location for this site in your browser settings and try again.'
    if (err.code === 2) return 'Location unavailable right now. Step outside or wait a moment and try again.'
    if (err.code === 3) return 'Timed out waiting for a GPS fix. Try again.'
  }
  return (err as Error)?.message || 'Something went wrong with location.'
}
