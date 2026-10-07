import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useServices } from '../services'
import { useTrip } from '../hooks/useTrip'
import { MEMBER_COLORS } from '../lib/identity'
import { joinWalk } from '../lib/account'
import Walker from '../components/Walker'
import { Tracker, type TrackerState } from '../lib/tracker'
import {
  appendPoints,
  endSegment,
  finishTrip,
  newPolaroidId,
  renameTrip,
  deleteWalk,
  setVisibility,
  startSegment,
  updatePolaroidText,
} from '../lib/tripApi'
import { compressImage, type Compressed } from '../lib/image'
import { readPhotoMeta } from '../lib/exif'
import type { PendingUpload } from '../lib/uploadQueue'
import { uploader } from '../lib/uploader'
import { formatDistance, formatDuration, pathDistance } from '../lib/geo'
import type { GeoPoint, Polaroid as PolaroidT } from '../lib/types'
import MapView from '../components/MapView'
import PolaroidViewer from '../components/PolaroidViewer'
import CaptureSheet from '../components/CaptureSheet'
import { IconBack, IconCamera, IconChevronDown, IconChevronUp, IconFlag, IconLocate, IconPause, IconPhoto, IconPin, IconPlay, IconShare } from '../components/icons'

const SESSION_KEY = 'taw.session'
const RESUME_WINDOW_MS = 30 * 60_000

interface PendingLocal {
  item: PendingUpload
  previewUrl: string
  progress: number
  failed?: boolean
}

export default function Trip({ me }: { me: { id: string; name: string; guest?: boolean } }) {
  const { tripId = '' } = useParams()
  const nav = useNavigate()
  const services = useServices()
  const { db } = services
  const [retryKey, setRetryKey] = useState(0)
  const { trip, segments, polaroids, loading, error, denied } = useTrip(tripId, retryKey)
  const meRef = useRef(me)
  meRef.current = me
  const member = trip?.members[me.id]
  const isMember = !!member
  const colorRef = useRef(MEMBER_COLORS[0])
  if (member) colorRef.current = member.color

  const trackerRef = useRef<Tracker | null>(null)
  const [trackerState, setTrackerState] = useState<TrackerState>('idle')
  const [myFix, setMyFix] = useState<GeoPoint | null>(null)
  const [follow, setFollow] = useState(false)
  const [fitKey, setFitKey] = useState(0)
  // Photos as small pins (default, keeps the route visible) or as polaroids. Remembered per phone.
  const [showPolaroids, setShowPolaroids] = useState(() => {
    try {
      return localStorage.getItem('taw.mapPolaroids') === '1'
    } catch {
      return false
    }
  })
  // The walk's numbers show in a bubble above the buttons when asked for. Remembered per phone.
  const [details, setDetails] = useState(() => {
    try {
      return localStorage.getItem('taw.details') === '1'
    } catch {
      return false
    }
  })
  const setDetailsPref = (v: boolean) => {
    setDetails(v)
    try {
      localStorage.setItem('taw.details', v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }
  const togglePolaroids = () =>
    setShowPolaroids((v) => {
      try {
        localStorage.setItem('taw.mapPolaroids', v ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !v
    })
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [capture, setCapture] = useState<Compressed | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Photos for this walk that aren't confirmed in the cloud yet (the uploader
  // owns them; this just mirrors its state for display).
  const [uploadTick, setUploadTick] = useState(0)
  useEffect(() => uploader.subscribe(() => setUploadTick((t) => t + 1)), [])
  const previewUrls = useRef(new Map<string, string>())
  const pending: PendingLocal[] = useMemo(() => {
    void uploadTick
    return uploader.pendingFor(tripId).map((st) => {
      let url = previewUrls.current.get(st.item.id)
      if (!url) {
        url = URL.createObjectURL(st.item.blob)
        previewUrls.current.set(st.item.id, url)
      }
      return { item: st.item, previewUrl: url, progress: st.progress, failed: st.failed }
    })
  }, [tripId, uploadTick])
  const [, setTick] = useState(0)

  const showToast = useCallback((msg: string, ms = 2600) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  // ---- tracker lifecycle -------------------------------------------------
  useEffect(() => {
    if (!tripId) return
    const tracker = new Tracker({
      onSegmentStart: () => startSegment(db, tripId, meRef.current, colorRef.current),
      onPoints: (segId, pts, prev) => appendPoints(db, tripId, segId, meRef.current, pts, prev),
      onSegmentEnd: (segId) => endSegment(db, tripId, segId, meRef.current),
      onState: (s) => {
        setTrackerState(s)
        if (s === 'tracking' || s === 'starting' || s === 'autopaused') {
          localStorage.setItem(SESSION_KEY, JSON.stringify({ tripId, at: Date.now() }))
        } else {
          localStorage.removeItem(SESSION_KEY)
        }
      },
      onFix: setMyFix,
      onError: (m) => showToast(m, 5000),
    })
    trackerRef.current = tracker
    return () => {
      // Leaving the page pauses the walk; the session record brings it back.
      const wasLive = tracker.state === 'tracking' || tracker.state === 'starting' || tracker.state === 'autopaused'
      void tracker.stop().then(() => {
        if (wasLive) localStorage.setItem(SESSION_KEY, JSON.stringify({ tripId, at: Date.now() }))
      })
      trackerRef.current = null
    }
  }, [db, tripId, showToast])

  // Keep the session heartbeat fresh while tracking, and tick the clock.
  useEffect(() => {
    if (trackerState !== 'tracking') return
    const i = setInterval(() => {
      setTick((t) => t + 1)
      localStorage.setItem(SESSION_KEY, JSON.stringify({ tripId, at: Date.now() }))
    }, 1000)
    return () => clearInterval(i)
  }, [trackerState, tripId])

  // Auto-resume if we were walking this trip a moment ago (reload, tab killed in background).
  const autoResumed = useRef(false)
  useEffect(() => {
    if (autoResumed.current || !trip || !isMember) return
    autoResumed.current = true
    if (trip.status === 'published') return
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return
      const s = JSON.parse(raw) as { tripId: string; at: number }
      if (s.tripId === tripId && Date.now() - s.at < RESUME_WINDOW_MS) {
        showToast('Picking up where you left off')
        setFollow(true)
        void trackerRef.current?.start()
      } else if (s.tripId !== tripId) {
        // Stale record for some other trip.
      }
    } catch {
      /* ignore */
    }
  }, [trip, isMember, tripId, showToast])

  // ---- derived -------------------------------------------------------------
  const allPolaroids: PolaroidT[] = useMemo(() => {
    const ids = new Set(polaroids.map((p) => p.id))
    const extra = pending
      .filter((p) => !ids.has(p.item.id))
      .map<PolaroidT>((p) => ({
        id: p.item.id,
        memberId: p.item.memberId,
        memberName: p.item.memberName,
        color: p.item.color,
        lat: p.item.lat,
        lng: p.item.lng,
        acc: p.item.acc,
        takenAt: p.item.takenAt,
        caption: p.item.caption,
        description: p.item.description,
        imagePath: '',
        imageUrl: p.previewUrl,
        pending: true,
      }))
    return [...polaroids, ...extra].sort((a, b) => a.takenAt - b.takenAt)
  }, [polaroids, pending])

  const myDistance = useMemo(
    () => segments.filter((s) => s.memberId === me.id).reduce((d, s) => d + pathDistance(s.points), 0),
    [segments, me.id],
  )
  const totalDistance = useMemo(() => segments.reduce((d, s) => d + pathDistance(s.points), 0), [segments])
  const isWalking = (m: { tracking?: boolean; lastSeenAt: number }) =>
    trip?.status !== 'published' && !!m.tracking && Date.now() - m.lastSeenAt < 10 * 60_000
  const walkingCount = trip ? Object.values(trip.members).filter(isWalking).length : 0
  const viewer = viewerId ? allPolaroids.find((p) => p.id === viewerId) ?? null : null
  const pendingProgress = viewer?.pending ? pending.find((p) => p.item.id === viewer.id) : null

  // ---- actions -------------------------------------------------------------
  const [joining, setJoining] = useState(false)
  const join = async () => {
    if (joining) return
    setJoining(true)
    try {
      await joinWalk(services, tripId)
      setRetryKey((k) => k + 1)
      showToast(`You're in. Your colour is on the map.`)
    } catch (e) {
      showToast((e as Error).message)
    } finally {
      setJoining(false)
    }
  }

  const toggleVisibility = async () => {
    if (!trip) return
    const next = trip.visibility === 'public' ? 'private' : 'public'
    const ok = confirm(
      next === 'public'
        ? 'Make this walk public? Anyone using take a walk will be able to see it, its route and its photos.'
        : 'Make this walk private? Only the people on it will be able to see it.',
    )
    if (!ok) return
    try {
      await setVisibility(db, tripId, next)
      showToast(next === 'public' ? 'Public. Anyone can see this walk.' : 'Private. Just the people on it.')
    } catch {
      showToast("Couldn't change that. Check your connection.")
    }
  }

  const removeWalk = async () => {
    if (!confirm('Delete this walk? It disappears for everyone on it. (Nothing is lost: it can be brought back if you change your mind.)')) return
    try {
      await trackerRef.current?.stop()
      await deleteWalk(db, tripId, me.id)
      nav('/')
    } catch {
      showToast("Couldn't delete it. Check your connection.")
    }
  }

  const start = () => {
    setFollow(true)
    void trackerRef.current?.start()
  }
  const pause = () => void trackerRef.current?.pause('manual')
  const resume = () => {
    setFollow(true)
    void trackerRef.current?.resume()
  }
  const finish = async () => {
    if (!confirm('Finish this walk for everyone? Once it is finished nobody can add to it.')) return
    await trackerRef.current?.stop()
    await finishTrip(db, tripId)
    setFollow(false)
    setFitKey((k) => k + 1)
    showToast('Published. Nice walk.')
  }

  const shareCode = async () => {
    if (!trip) return
    const text = `Join my walk "${trip.name}" on take a walk`
    const url = location.href
    try {
      if (navigator.share) await navigator.share({ title: trip.name, text, url })
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`)
        showToast('Copied invite to clipboard')
      }
    } catch {
      /* cancelled */
    }
  }

  const rename = async () => {
    if (!trip || !isMember) return
    const n = prompt('Walk name', trip.name)
    if (n && n.trim() && n.trim() !== trip.name) await renameTrip(db, tripId, n.trim())
  }

  // Where a photo gets pinned is decided when the photo comes back, not when
  // the camera opens: opening the camera backgrounds the app and pauses GPS,
  // so the last known position can be minutes (and a kilometre) old.
  //   1. the GPS position stored in the photo itself, if there is one;
  //   2. otherwise a fresh reading taken now;
  //   3. a reading older than FIX_MAX_AGE is never used without asking.
  const FIX_MAX_AGE = 60_000
  const shutterAt = useRef(0)
  const [where, setWhere] = useState<{ fix: GeoPoint | null; source: 'photo' | 'gps' | 'stale' | 'none' | 'locating'; takenAt: number; note?: string }>({
    fix: null,
    source: 'none',
    takenAt: 0,
  })

  const locate = useCallback(async () => {
    setWhere((w) => ({ ...w, source: 'locating' }))
    try {
      // A short-lived watch rather than getCurrentPosition: the latter can hang
      // while the walk tracker already has a watch running (seen in Chrome and iOS).
      const fix = await new Promise<GeoPoint>((resolve, reject) => {
        const done = (f: (() => void) | null) => {
          navigator.geolocation.clearWatch(id)
          clearTimeout(timer)
          f?.()
        }
        const id = navigator.geolocation.watchPosition(
          (pos) => {
            if (Date.now() - (pos.timestamp || Date.now()) > 30_000) return // a cached old reading: keep waiting
            done(() => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp || Date.now() }))
          },
          (err) => done(() => reject(err)),
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
        )
        const timer = setTimeout(() => done(() => reject(new Error('timed out'))), 15_000)
      })
      setMyFix(fix)
      setWhere((w) => (w.source === 'photo' ? w : { ...w, fix, source: 'gps' }))
    } catch (e) {
      console.warn('location for photo failed', (e as GeolocationPositionError)?.code, (e as Error)?.message)
      // No fresh reading: only fall back to one from the last minute.
      const recent = [trackerRef.current?.lastFix, myFix, member?.lastPos].filter((f): f is GeoPoint => !!f && Date.now() - f.t < FIX_MAX_AGE)
      setWhere((w) => (w.source === 'photo' ? w : recent[0] ? { ...w, fix: recent[0], source: 'stale' } : { ...w, fix: null, source: 'none' }))
    }
  }, [myFix, member])

  const onShutter = () => {
    shutterAt.current = Date.now()
    fileInput.current?.click()
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const [c, meta] = await Promise.all([compressImage(file), readPhotoMeta(file)])
      const takenAt = meta.takenAt ?? shutterAt.current ?? Date.now()
      const old = meta.takenAt && Date.now() - meta.takenAt > 10 * 60_000
      if (meta.lat != null && meta.lng != null) {
        setWhere({ fix: { lat: meta.lat, lng: meta.lng, acc: meta.acc ?? 10, t: takenAt }, source: 'photo', takenAt })
      } else {
        setWhere({
          fix: null,
          source: 'locating',
          takenAt,
          note: old ? `This photo was taken ${formatAgo(meta.takenAt!)} and has no location in it, so it will be pinned where you are now.` : undefined,
        })
        void locate()
      }
      setCapture(c)
    } catch {
      showToast('Could not read that photo')
    }
  }

  const retake = () => {
    if (capture) URL.revokeObjectURL(capture.previewUrl)
    setCapture(null)
    setTimeout(() => fileInput.current?.click(), 50)
  }

  const savePhoto = async (caption: string, description: string) => {
    if (!capture || !member) return
    const fix = where.fix
    if (!fix) {
      showToast("We don't know where you are yet. Give it a second.", 4000)
      return
    }
    const item: PendingUpload = {
      id: newPolaroidId(db, tripId),
      tripId,
      blob: capture.blob,
      memberId: me.id,
      memberName: me.name,
      color: member.color,
      lat: fix.lat,
      lng: fix.lng,
      acc: fix.acc,
      takenAt: where.takenAt || Date.now(),
      caption,
      description,
      createdAt: Date.now(),
    }
    previewUrls.current.set(item.id, capture.previewUrl)
    setCapture(null)
    const persisted = await uploader.enqueue(item)
    if (!persisted) showToast("Couldn't keep a copy on this phone. Keep the app open until the photo uploads.", 7000)
  }

  const saveText = async (caption: string, description: string) => {
    if (!viewer) return
    await updatePolaroidText(db, tripId, viewer.id, caption, description)
  }

  // Finished (maybe by someone else): stop tracking here too.
  const finished = trip?.status === 'published'
  useEffect(() => {
    if (!finished) return
    const t = trackerRef.current
    if (t && t.state !== 'idle') void t.stop()
    localStorage.removeItem(SESSION_KEY)
  }, [finished])

  // Keep the map buttons just above the bottom panel, whatever its height.
  const barRef = useRef<HTMLDivElement>(null)
  const tripRef = useRef<HTMLDivElement>(null)
  // Same for the name tags under the title box.
  const topRef = useRef<HTMLDivElement>(null)
  const detRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const bar = barRef.current
    const top = topRef.current
    const det = detRef.current
    const set = (k: string, v: number) => tripRef.current?.style.setProperty(k, `${v}px`)
    set('--det-h', det ? det.offsetHeight + 12 : 0)
    const ro = new ResizeObserver(() => {
      if (bar) set('--bar-h', bar.offsetHeight)
      if (top) set('--top-h', top.offsetHeight)
      set('--det-h', det ? det.offsetHeight + 12 : 0)
    })
    if (bar) ro.observe(bar)
    if (top) ro.observe(top)
    if (det) ro.observe(det)
    return () => ro.disconnect()
  })

  // ---- render --------------------------------------------------------------
  if (denied) {
    return (
      <div className="splash">
        <div className="card auth-card">
          <h2>This walk is private</h2>
          <p className="muted">Only the people on it can see it. You have the link, so you can join if you're nearby.</p>
          <button className={`btn btn-accent ${joining ? 'busy' : ''}`} onClick={join} disabled={joining}>
            {joining ? <span className="spinner sm" aria-label="Checking where you are" /> : `Join as ${me.name}`}
          </button>
          <button className="btn btn-ghost" onClick={() => nav('/')}>
            Back home
          </button>
        </div>
        {toast ? <div className="toast static">{toast}</div> : null}
      </div>
    )
  }
  if (error) {
    return (
      <div className="splash">
        <div className="error-box">{error}</div>
        <button className="btn" onClick={() => nav('/')}>
          Back home
        </button>
      </div>
    )
  }
  if (trip?.deleted) {
    return (
      <div className="splash">
        <p className="muted">This walk was deleted.</p>
        <button className="btn" onClick={() => nav('/')}>
          Back home
        </button>
      </div>
    )
  }
  if (!loading && trip === null) {
    return (
      <div className="splash">
        <p className="muted">That walk doesn't exist.</p>
        <button className="btn" onClick={() => nav('/')}>
          Back home
        </button>
      </div>
    )
  }

  const tracking = trackerState === 'tracking'
  const live = tracking || trackerState === 'starting' || trackerState === 'autopaused'
  const hasMySegments = segments.some((s) => s.memberId === me.id)
  const elapsed = trackerRef.current?.elapsedMs ?? 0
  const gpsAcc = myFix?.acc ?? member?.lastPos?.acc
  // The round-button dock wherever there are walking controls.
  const dock = !!trip && !finished && isMember

  // Toggle between "show everything" and "follow me".
  const recenter = () => {
    if (follow || !myFix) {
      setFollow(false)
      setFitKey((k) => k + 1)
    } else {
      setFollow(true)
    }
  }

  return (
    <div className="trip" ref={tripRef}>
      <MapView
        segments={segments}
        members={trip?.members ?? {}}
        polaroids={allPolaroids}
        meId={me.id}
        myFix={myFix}
        tracking={tracking}
        follow={follow}
        onUserMove={() => setFollow(false)}
        onPolaroidClick={setViewerId}
        fitKey={fitKey}
        showPolaroids={showPolaroids}
        focus={trip ? (finished ? 'start' : 'current') : null}
      />

      <div className="topbar" ref={topRef}>
        <button className="btn-icon" onClick={() => nav('/')} aria-label="Back">
          <IconBack />
        </button>
        <div className="trip-title" onClick={rename}>
          <h1>{trip?.name ?? 'Loading…'}</h1>
          <div className="sub">
            <span>
              {walkingCount > 0 ? `${walkingCount} walking now` : finished ? 'finished' : 'not walking'}
              {' · '}
              {allPolaroids.length} polaroid{allPolaroids.length === 1 ? '' : 's'}
            </span>
            {trip ? (
              isMember && !me.guest ? (
                <button
                  className={`vis-chip ${trip.visibility}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleVisibility()
                  }}
                  aria-label={trip.visibility === 'public' ? 'Public: tap to make private' : 'Private: tap to make public'}
                >
                  {trip.visibility === 'public' ? 'public' : 'private'}
                </button>
              ) : (
                <span className={`vis-chip ${trip.visibility}`}>{trip.visibility}</span>
              )
            ) : null}
            {/* Name tags sit on the same line and wrap to a second only if they need to. */}
            {trip
              ? Object.entries(trip.members).map(([id, m]) => (
                  <span key={id} className={`chip member-chip ${id === me.id ? 'me' : ''}`}>
                    <span className="dot" style={{ background: m.color }} />
                    {id === me.id ? 'you' : m.name}
                    {isWalking(m) ? <span className="walking" /> : null}
                  </span>
                ))
              : null}
          </div>
        </div>
        <button className="btn-icon" onClick={shareCode} aria-label="Share invite">
          <IconShare />
        </button>
      </div>


      <Walker className="map-walker" variant="dotted" color="var(--ink)" size={46} walking={tracking} looking={!tracking} />

      <button
        className="btn-icon map-toggle"
        onClick={togglePolaroids}
        aria-label={showPolaroids ? 'Show photos as pins' : 'Show photos as polaroids'}
        title={showPolaroids ? 'Show photos as pins' : 'Show photos as polaroids'}
      >
        {showPolaroids ? <IconPin /> : <IconPhoto />}
      </button>

      <button className="btn-icon recenter" aria-label="Recenter" onClick={recenter}>
        <IconLocate />
      </button>

      {trip && !finished && isMember && details ? (
        <div className="details-bubble" ref={detRef}>
          <div className="stats">
            <div className="stat">
              <b>{formatDistance(myDistance)}</b>
              <span>you</span>
            </div>
            <div className="stat">
              <b>{formatDistance(totalDistance)}</b>
              <span>everyone</span>
            </div>
            <div className="stat">
              <b>{live ? formatDuration(elapsed) : '–'}</b>
              <span>this session</span>
            </div>
            <div className="stat right">
              <b>{gpsAcc != null ? `±${Math.round(gpsAcc)}m` : '–'}</b>
              <span>gps</span>
            </div>
          </div>
          <div className={`status-line ${trackerState === 'autopaused' ? 'warn' : ''}`}>
            {trackerState === 'tracking'
              ? 'Walking. Keep this screen open; we pause automatically when you leave and resume when you come back.'
              : trackerState === 'starting'
                ? 'Getting a GPS fix…'
                : trackerState === 'paused'
                  ? 'Paused. Your line picks up fresh when you resume.'
                  : trackerState === 'autopaused'
                    ? 'Paused while the app was in the background.'
                    : 'Tap play to begin drawing your line. Photos pin where you are.'}
          </div>
          <button className="link-btn delete-walk" onClick={removeWalk}>
            Delete this walk
          </button>
        </div>
      ) : null}

      <div className={`bottombar ${dock ? 'compact' : ''}`} ref={barRef}>
        {!trip ? (
          <div className="status-line">Loading walk…</div>
        ) : finished ? (
          <>
            <div className="stats">
              <div className="stat">
                <b>{formatDistance(totalDistance)}</b>
                <span>walked</span>
              </div>
              <div className="stat">
                <b>{allPolaroids.length}</b>
                <span>polaroids</span>
              </div>
              <div className="stat right">
                <b>{Object.keys(trip.members).length}</b>
                <span>walkers</span>
              </div>
            </div>
            <div className="finished-line">This walk is finished. Tap a pin to see its polaroids.</div>
            {isMember ? (
              <button className="link-btn delete-walk" onClick={removeWalk}>
                Delete this walk
              </button>
            ) : null}
          </>
        ) : !isMember ? (
          <div className="join-card">
            <p>
              You're looking at <b>{trip.name}</b>. Join to walk it, draw your own line and pin polaroids.
            </p>
            <button className={`btn btn-accent ${joining ? 'busy' : ''}`} onClick={join} disabled={joining}>
              {joining ? <span className="spinner sm" aria-label="Checking where you are" /> : `Join as ${me.name}`}
            </button>
          </div>
        ) : (
          <div className="dock">
            {trackerState === 'tracking' ? (
              <button className="dock-btn" onClick={pause} aria-label="Pause">
                <IconPause />
              </button>
            ) : trackerState === 'starting' ? (
              <button className="dock-btn" disabled aria-label="Locating">
                <span className="spinner sm" />
              </button>
            ) : (
              <button className="dock-btn accent" onClick={trackerState === 'idle' ? start : resume} aria-label={trackerState === 'idle' && !hasMySegments ? 'Start' : 'Resume'}>
                <IconPlay />
              </button>
            )}
            <button className="dock-btn" onClick={shareCode} aria-label="Invite">
              <IconShare />
            </button>
            <button className="dock-btn" onClick={togglePolaroids} aria-label={showPolaroids ? 'Show photos as pins' : 'Show photos as polaroids'}>
              {showPolaroids ? <IconPin /> : <IconPhoto />}
            </button>
            <button className="dock-btn shutter-sm" onClick={onShutter} aria-label="Take a polaroid">
              <IconCamera />
            </button>
            <button className="dock-btn danger" onClick={finish} aria-label="Finish">
              <IconFlag />
            </button>
            <button className="dock-btn" onClick={recenter} aria-label="Recenter">
              <IconLocate />
            </button>
            <button className="dock-btn" onClick={() => setDetailsPref(!details)} aria-label={details ? 'Hide details' : 'Show details'}>
              {details ? <IconChevronDown /> : <IconChevronUp />}
            </button>
          </div>
        )}
      </div>

      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {toast ? <div className="toast">{toast}</div> : null}

      {capture ? (
        <CaptureSheet
          photo={capture}
          memberName={me.name}
          color={member?.color ?? colorRef.current}
          lat={where.fix?.lat}
          lng={where.fix?.lng}
          locating={where.source === 'locating'}
          locationNote={
            where.source === 'photo'
              ? 'Pinned where the photo was taken (from the photo).'
              : where.source === 'stale'
                ? "Couldn't get a fresh location, so this uses where you were a moment ago."
                : where.source === 'none'
                  ? "We can't tell where you are. Check location is on, then try again."
                  : where.note
          }
          onRetryLocation={where.source === 'none' ? () => void locate() : undefined}
          onRetake={retake}
          onCancel={() => {
            URL.revokeObjectURL(capture.previewUrl)
            setCapture(null)
          }}
          onSave={savePhoto}
        />
      ) : null}

      {viewer ? (
        <PolaroidViewer
          key={viewer.id}
          polaroid={pendingProgress ? { ...viewer } : viewer}
          canEdit={viewer.memberId === me.id && !viewer.pending}
          onClose={() => setViewerId(null)}
          onSaveText={saveText}
          onToast={showToast}
        />
      ) : null}
    </div>
  )
}

function formatAgo(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000)
  if (m < 60) return `${m} minutes ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  return `${Math.round(h / 24)} days ago`
}
