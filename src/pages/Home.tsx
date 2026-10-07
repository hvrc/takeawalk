import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useServices } from '../services'
import { createTrip, subscribeTrips } from '../lib/tripApi'
import { signOut } from '../lib/account'
import { formatDistance, formatWhen } from '../lib/geo'
import type { Trip } from '../lib/types'
import Polaroid from '../components/Polaroid'
import { IconClose, IconPhoto } from '../components/icons'
import Walker, { WalkerParade } from '../components/Walker'
import PlaceMap from '../components/PlaceMap'
import ThemeButton from '../components/ThemeButton'
import Stroller from '../components/Stroller'

export default function Home({ me }: { me: { id: string; name: string; guest?: boolean } }) {
  const services = useServices()
  const { db } = services
  const nav = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [walkName, setWalkName] = useState('')
  const [busy, setBusy] = useState<'create' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => subscribeTrips(db, me.id, setTrips, (e) => setMsg(e.message)), [db, me.id])

  // Creating a walk waits for the server so the walk really exists before you
  // start. If that's slow, a pop-up says so and can be closed (you stay here;
  // if the walk does get created it simply shows up in the list).
  const createRun = useRef(0)
  const [showCreating, setShowCreating] = useState(false)
  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    const run = ++createRun.current
    setBusy('create')
    const slow = setTimeout(() => run === createRun.current && setShowCreating(true), 500)
    try {
      const trip = await createTrip(db, walkName || defaultWalkName(), me)
      if (run === createRun.current) nav(`/t/${trip.id}`)
    } catch (err) {
      if (run === createRun.current) setMsg((err as Error).message)
    } finally {
      clearTimeout(slow)
      if (run === createRun.current) {
        setBusy(null)
        setShowCreating(false)
      }
    }
  }
  const cancelCreate = () => {
    createRun.current++
    setBusy(null)
    setShowCreating(false)
  }

  const accountMenu = () => {
    const q = me.guest
      ? `You're ${me.name}, without an account. If you sign out, this name can't be got back. Sign out anyway?`
      : `Signed in as ${me.name}. Sign out?`
    if (confirm(q)) void signOut(services)
  }

  return (
    <div className="home">
      <PlaceMap />
      <header className="home-banner">
        <div className="home-header">
          <h1 className="wordmark with-walker">
            take a walk
            <Walker variant="dotted" color="var(--leaf)" className="wordmark-walker" />
          </h1>
          <div className="home-header-actions">
            <ThemeButton />
            <button className="name-pill" onClick={accountMenu} aria-label={`Signed in as ${me.name}`}>
              <span className="avatar">{me.name.slice(0, 1).toUpperCase()}</span>
              {me.name}
            </button>
          </div>
        </div>
      </header>

      <section className="card start-card">
        <h2>
          <span>Start a walk</span>
          <Stroller />
        </h2>
        <form className="row" onSubmit={onCreate}>
          <input
            className="field"
            placeholder={defaultWalkName()}
            value={walkName}
            maxLength={80}
            onChange={(e) => setWalkName(e.target.value)}
            enterKeyHint="go"
          />
          <button className={`btn btn-accent ${busy === 'create' ? 'busy' : ''}`} type="submit" disabled={busy !== null}>
            {busy === 'create' ? <span className="spinner sm" aria-label="Starting" /> : 'Start'}
          </button>
        </form>
        {msg ? (
          <div className="tiny" style={{ color: 'var(--brick)' }} onClick={() => setMsg(null)}>
            {msg}
          </div>
        ) : null}
      </section>

      {trips === null ? (
        <>
          <div className="section-title">
            <span>Walks</span>
          </div>
          <div className="empty">Loading walks…</div>
        </>
      ) : (
        <>
          {/* Private walks only appear when you have some. */}
          {trips.some((t) => t.visibility === 'private') ? (
            <>
              <div className="section-title">
                <span>Private walks</span>
              </div>
              <div className="trip-list">
                {trips
                  .filter((t) => t.visibility === 'private')
                  .map((t) => (
                    <TripCard key={t.id} trip={t} meId={me.id} onOpen={() => nav(`/t/${t.id}`)} />
                  ))}
              </div>
            </>
          ) : null}
          <div className="section-title">
            <span>Public walks</span>
          </div>
          {trips.some((t) => t.visibility === 'public') ? (
            <div className="trip-list">
              {trips
                .filter((t) => t.visibility === 'public')
                .map((t) => (
                  <TripCard key={t.id} trip={t} meId={me.id} onOpen={() => nav(`/t/${t.id}`)} />
                ))}
            </div>
          ) : (
            <div className="empty">
              <WalkerParade size={34} />
              <p>No public walks yet.</p>
            </div>
          )}
        </>
      )}
      {showCreating ? (
        <div className="modal-backdrop" onClick={cancelCreate}>
          <div className="modal card" role="dialog" aria-label="Creating your walk" onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon modal-close" onClick={cancelCreate} aria-label="Stop waiting">
              <IconClose />
            </button>
            <Walker variant="stride" color="var(--leaf)" size={56} walking />
            <h2>Creating your walk…</h2>
            <p className="muted">This can take a moment on a slow connection.</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TripCard({ trip, meId, onOpen }: { trip: Trip; meId: string; onOpen: () => void }) {
  const members = Object.entries(trip.members)
  const live = trip.status !== 'published' && members.some(([, m]) => m.tracking && Date.now() - m.lastSeenAt < 10 * 60_000)
  return (
    <button className="card trip-card" onClick={onOpen}>
      {trip.coverUrl ? (
        <div className="cover" style={{ transform: 'rotate(-3deg)' }}>
          <Polaroid imageUrl={trip.coverUrl} caption="" size="thumb" />
        </div>
      ) : (
        <div className="cover-empty">
          <IconPhoto />
        </div>
      )}
      <div>
        <h3>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {trip.name}
          </span>
          <span className={`vis-chip ${trip.visibility}`}>{trip.visibility}</span>
          {live ? <span className="badge live">live</span> : trip.status === 'published' ? <span className="badge">finished</span> : null}
        </h3>
        <div className="meta">
          <span>{formatDistance(trip.distanceM)}</span>
          <span>
            {trip.polaroidCount} polaroid{trip.polaroidCount === 1 ? '' : 's'}
          </span>
          <span>{formatWhen(trip.updatedAt)}</span>
        </div>
        <div className="members">
          {members.map(([id, m]) => (
            <span key={id} className="chip">
              <span className="dot" style={{ background: m.color }} />
              {m.name}
              {id === meId ? ' (you)' : ''}
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}

function defaultWalkName(): string {
  const h = new Date().getHours()
  const part = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night'
  return `${part} walk`
}
