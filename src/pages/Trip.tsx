import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useServices } from '../services'
import { useTrip } from '../hooks/useTrip'
import { getDeviceId, MEMBER_COLORS } from '../lib/identity'
import { Tracker, type TrackerState } from '../lib/tracker'
import {
  appendPoints,
  endSegment,
  joinTrip,
  newPolaroidId,
  renameTrip,
  setTripStatus,
  startSegment,
  updatePolaroidText,
} from '../lib/tripApi'
import { compressImage, type Compressed } from '../lib/image'
import type { PendingUpload } from '../lib/uploadQueue'
import { uploader } from '../lib/uploader'
import { formatDistance, formatDuration, pathDistance } from '../lib/geo'
import type { GeoPoint, Polaroid as PolaroidT } from '../lib/types'
import MapView from '../components/MapView'
import PolaroidViewer from '../components/PolaroidViewer'
import CaptureSheet from '../components/CaptureSheet'
import { IconBack, IconCamera, IconFlag, IconLocate, IconPause, IconPlay, IconShare } from '../components/icons'

const SESSION_KEY = 'taw.session'
const RESUME_WINDOW_MS = 30 * 60_000

interface PendingLocal {
  item: PendingUpload
  previewUrl: string
  progress: number
  failed?: boolean
}

export default function Trip({ name }: { name: string }) {
  const { tripId = '' } = useParams()
  const nav = useNavigate()
  const { db } = useServices()
  const { trip, segments, polaroids, loading, error } = useTrip(tripId)
  const me = useMemo(() => ({ id: getDeviceId(), name }), [name])
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
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [capture, setCapture] = useState<Compressed | null>(null)
  const captureFix = useRef<GeoPoint | null>(null)
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
  const walkingCount = trip ? Object.values(trip.members).filter((m) => m.tracking && Date.now() - m.lastSeenAt < 10 * 60_000).length : 0
  const viewer = viewerId ? allPolaroids.find((p) => p.id === viewerId) ?? null : null
  const pendingProgress = viewer?.pending ? pending.find((p) => p.item.id === viewer.id) : null

  // ---- actions -------------------------------------------------------------
  const join = async () => {
    try {
      await joinTrip(db, tripId, me)
      showToast(`You're in. Your colour is on the map.`)
    } catch (e) {
      showToast((e as Error).message)
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
    if (!confirm('Finish this walk and publish it? You can always resume it later.')) return
    await trackerRef.current?.stop()
    await setTripStatus(db, tripId, 'published')
    setFollow(false)
    setFitKey((k) => k + 1)
    showToast('Published. Nice walk.')
  }

  const shareCode = async () => {
    if (!trip) return
    const text = `Join my walk "${trip.name}" on take a walk with code ${trip.code}`
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

  const onShutter = () => {
    const t = trackerRef.current
    const fresh = t?.lastFix && Date.now() - t.lastFix.t < 30_000 ? t.lastFix : null
    captureFix.current = fresh ?? myFix ?? member?.lastPos ?? null
    // Open the camera synchronously inside the tap, then refine the fix.
    fileInput.current?.click()
    if (!fresh && t) t.recalibrate().then((f) => (captureFix.current = f)).catch(() => undefined)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const c = await compressImage(file)
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
    const fix = captureFix.current ?? myFix ?? member.lastPos
    if (!fix) {
      showToast('No GPS fix yet. Give it a second and try again.', 4000)
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
      takenAt: Date.now(),
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

  // ---- render --------------------------------------------------------------
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

  return (
    <div className="trip">
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
      />

      <div className="topbar">
        <button className="btn-icon" onClick={() => nav('/')} aria-label="Back">
          <IconBack />
        </button>
        <div className="trip-title" onClick={rename}>
          <h1>{trip?.name ?? 'Loading…'}</h1>
          <div className="sub">
            <span className="code-chip">{trip?.code ?? '····'}</span>
            <span>
              {walkingCount > 0 ? `${walkingCount} walking now` : trip?.status === 'published' ? 'published' : 'not walking'}
              {' · '}
              {allPolaroids.length} polaroid{allPolaroids.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <button className="btn-icon" onClick={shareCode} aria-label="Share invite">
          <IconShare />
        </button>
      </div>

      {trip ? (
        <div className="members-row">
          {Object.entries(trip.members).map(([id, m]) => (
            <span key={id} className={`chip ${id === me.id ? 'me' : ''}`}>
              <span className="dot" style={{ background: m.color }} />
              {id === me.id ? 'you' : m.name}
              {m.tracking && Date.now() - m.lastSeenAt < 10 * 60_000 ? <span className="walking" /> : null}
            </span>
          ))}
        </div>
      ) : null}

      <button
        className="btn-icon recenter"
        aria-label="Recenter"
        onClick={() => {
          // Toggle between "show everything" and "follow me".
          if (follow || !myFix) {
            setFollow(false)
            setFitKey((k) => k + 1)
          } else {
            setFollow(true)
          }
        }}
      >
        <IconLocate />
      </button>

      <div className="bottombar">
        {!trip ? (
          <div className="status-line">Loading walk…</div>
        ) : !isMember ? (
          <div className="join-card">
            <p>
              You're looking at <b>{trip.name}</b>. Join to walk it, draw your own line and pin polaroids.
            </p>
            <button className="btn btn-accent" onClick={join}>
              Join as {me.name}
            </button>
          </div>
        ) : (
          <>
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
            <div className="controls">
              {trackerState === 'idle' ? (
                <button className="btn btn-accent" onClick={start}>
                  <IconPlay style={{ width: 18, height: 18 }} /> {hasMySegments || trip.status === 'published' ? 'Resume' : 'Start'}
                </button>
              ) : trackerState === 'starting' ? (
                <button className="btn" disabled>
                  Locating…
                </button>
              ) : trackerState === 'tracking' ? (
                <button className="btn btn-ghost" onClick={pause}>
                  <IconPause style={{ width: 18, height: 18 }} /> Pause
                </button>
              ) : (
                <button className="btn btn-accent" onClick={resume}>
                  <IconPlay style={{ width: 18, height: 18 }} /> Resume
                </button>
              )}
              <button className="shutter" onClick={onShutter} aria-label="Take a polaroid" title="Take a polaroid">
                <IconCamera />
              </button>
              {trackerState === 'idle' ? (
                <button className="btn btn-ghost" onClick={shareCode}>
                  <IconShare style={{ width: 18, height: 18 }} /> Invite
                </button>
              ) : (
                <button className="btn btn-ghost danger" onClick={finish}>
                  <IconFlag style={{ width: 18, height: 18 }} /> Finish
                </button>
              )}
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
                      : trip.status === 'published'
                        ? 'Published. Resume to add more to this walk; what you already walked stays as is.'
                        : 'Tap Start to begin drawing your line. Photos pin where you are.'}
            </div>
          </>
        )}
      </div>

      <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {toast ? <div className="toast">{toast}</div> : null}

      {capture ? (
        <CaptureSheet
          photo={capture}
          memberName={me.name}
          color={member?.color ?? colorRef.current}
          lat={(captureFix.current ?? myFix ?? member?.lastPos)?.lat}
          lng={(captureFix.current ?? myFix ?? member?.lastPos)?.lng}
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
