import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatWhen } from '../lib/geo'

interface AdminWalk {
  id: string
  name: string
  status: 'active' | 'published'
  hidden: boolean
  updatedAt: number
  polaroidCount: number
  members: Array<{ name: string; color: string }>
}

const TOKEN_KEY = 'taw.adminToken'

async function api<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status })
  return data as T
}

/** /admin: sign in, then hide/show or delete walks. The server checks the password and does the work. */
export default function Admin() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState('harshu')
  const [password, setPassword] = useState('')
  const [walks, setWalks] = useState<AdminWalk[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminWalk | null>(null)

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setWalks(null)
  }

  const load = useCallback(async () => {
    if (!token) return
    try {
      setWalks((await api<{ walks: AdminWalk[] }>('/api/admin/walks', token)).walks)
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOut()
      setMsg((e as Error).message)
    }
  }, [token])
  useEffect(() => void load(), [load])

  const login = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('login')
    setMsg(null)
    try {
      const { token } = await api<{ token: string }>('/api/admin/login', null, { method: 'POST', body: JSON.stringify({ user, password }) })
      sessionStorage.setItem(TOKEN_KEY, token)
      setToken(token)
      setPassword('')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const toggleHidden = async (w: AdminWalk) => {
    setBusy(w.id)
    try {
      await api(`/api/admin/walks/${w.id}/hidden`, token, { method: 'POST', body: JSON.stringify({ hidden: !w.hidden }) })
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const doDelete = async (w: AdminWalk) => {
    setBusy(w.id)
    setConfirmDelete(null)
    try {
      await api(`/api/admin/walks/${w.id}`, token, { method: 'DELETE' })
      setMsg(`Deleted “${w.name}”.`)
      await load()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!token) {
    return (
      <div className="splash">
        <h1 className="wordmark">
          take a walk<small>admin</small>
        </h1>
        <form onSubmit={login}>
          <input className="field center" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" aria-label="Name" />
          <input
            className="field center"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Password"
          />
          <button className={`btn btn-accent ${busy ? 'busy' : ''}`} type="submit" disabled={!password || !!busy}>
            {busy ? <span className="spinner sm" aria-label="Signing in" /> : 'Sign in'}
          </button>
          {msg ? <p className="confirm-error">{msg}</p> : null}
        </form>
      </div>
    )
  }

  return (
    <div className="home admin">
      <header className="home-header">
        <h1 className="wordmark">admin</h1>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          Sign out
        </button>
      </header>
      {msg ? (
        <p className="admin-msg" onClick={() => setMsg(null)}>
          {msg}
        </p>
      ) : null}
      {walks === null ? (
        <div className="empty">Loading walks…</div>
      ) : walks.length === 0 ? (
        <div className="empty">No walks.</div>
      ) : (
        <div className="trip-list">
          {walks.map((w) => (
            <div key={w.id} className={`card admin-walk ${w.hidden ? 'is-hidden' : ''}`}>
              <div className="admin-walk-head">
                <h3>
                  <a href={`/t/${w.id}`}>{w.name}</a>
                </h3>
                {w.hidden ? <span className="badge">hidden</span> : null}
                {w.status === 'published' ? <span className="badge">finished</span> : null}
              </div>
              <div className="meta">
                <span>{w.polaroidCount} polaroids</span>
                <span>{formatWhen(w.updatedAt)}</span>
                <span>{w.members.map((m) => m.name).join(', ') || 'nobody'}</span>
              </div>
              {confirmDelete?.id === w.id ? (
                <div className="admin-confirm">
                  <p>
                    Delete <b>{w.name}</b>, its route and all {w.polaroidCount} photos?
                  </p>
                  <div className="row">
                    <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </button>
                    <button className="btn btn-accent btn-sm" onClick={() => doDelete(w)}>
                      Delete it
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row admin-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => toggleHidden(w)} disabled={busy === w.id}>
                    {w.hidden ? 'Show' : 'Hide'}
                  </button>
                  <button className="btn btn-ghost btn-sm danger" onClick={() => setConfirmDelete(w)} disabled={busy === w.id}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
