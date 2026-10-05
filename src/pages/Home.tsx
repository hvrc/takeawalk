import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useServices } from '../services'
import { createTrip, subscribeTrips } from '../lib/tripApi'
import { getDeviceId } from '../lib/identity'
import { formatDistance, formatWhen } from '../lib/geo'
import type { Trip } from '../lib/types'
import Polaroid from '../components/Polaroid'
import { IconPhoto } from '../components/icons'

export default function Home({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const { db } = useServices()
  const nav = useNavigate()
  const [trips, setTrips] = useState<Trip[] | null>(null)
  const [walkName, setWalkName] = useState('')
  const [busy, setBusy] = useState<'create' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const me = { id: getDeviceId(), name }

  useEffect(() => subscribeTrips(db, setTrips, (e) => setMsg(e.message)), [db])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('create')
    try {
      const trip = await createTrip(db, walkName || defaultWalkName(), me)
      nav(`/t/${trip.id}`)
    } catch (err) {
      setMsg((err as Error).message)
      setBusy(null)
    }
  }

  const rename = () => {
    const n = prompt('Your name', name)
    if (n && n.trim()) onRename(n.trim())
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="wordmark">take a walk</h1>
        <button className="name-pill" onClick={rename} aria-label="Change your name">
          <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
          {name}
        </button>
      </header>

      <section className="card start-card">
        <h2>Start a walk</h2>
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

      <div className="section-title">All walks</div>
      {trips === null ? (
        <div className="empty">Loading walks…</div>
      ) : trips.length === 0 ? (
        <div className="empty">No walks yet. Yours could be the first.</div>
      ) : (
        <div className="trip-list">
          {trips.map((t) => (
            <TripCard key={t.id} trip={t} meId={me.id} onOpen={() => nav(`/t/${t.id}`)} />
          ))}
        </div>
      )}
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
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trip.name}</span>
          {live ? <span className="badge live">live</span> : trip.status === 'published' ? <span className="badge">finished</span> : null}
        </h3>
        <div className="meta">
          <span>{formatDistance(trip.distanceM)}</span>
          <span>{trip.polaroidCount} polaroid{trip.polaroidCount === 1 ? '' : 's'}</span>
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
