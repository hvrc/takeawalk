import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { getServices, type Services } from './firebase'
import { ServicesContext } from './services'
import { adoptIdentity, getName, requestPersistentStorage, setName as persistName } from './lib/identity'
import { checkJoinDistance, getTrip, listKnownWalkers, type KnownWalker } from './lib/tripApi'
import NamePrompt from './components/NamePrompt'
import Home from './pages/Home'
import Trip from './pages/Trip'
import { uploader } from './lib/uploader'

// iOS restarts a home-screen app on its start page after killing it in the
// background. If you were on a walk you were walking a moment ago, go straight
// back to it. Only when that walk was the screen you were on, so leaving a walk
// for the home page on purpose sticks.
const RESUME_WINDOW_MS = 30 * 60_000
const LAST_PATH_KEY = 'taw.lastPath'
try {
  const raw = localStorage.getItem('taw.session')
  const s = raw ? (JSON.parse(raw) as { tripId: string; at: number }) : null
  const was = `/t/${s?.tripId}`
  if (location.pathname === '/' && s?.tripId && Date.now() - s.at < RESUME_WINDOW_MS && localStorage.getItem(LAST_PATH_KEY) === was) {
    history.replaceState(null, '', was)
  }
} catch {
  /* ignore */
}

function RememberPath() {
  const { pathname } = useLocation()
  useEffect(() => {
    try {
      localStorage.setItem(LAST_PATH_KEY, pathname)
    } catch {
      /* ignore */
    }
  }, [pathname])
  return null
}

export default function App() {
  const [services, setServices] = useState<Services | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setNameState] = useState<string>(() => getName())

  useEffect(() => {
    getServices().then((s) => {
      // Start uploading any photos still queued on this phone, from any walk.
      uploader.start(s)
      setServices(s)
    }, (e: Error) => setError(e.message))
  }, [])

  const saveName = (n: string) => {
    persistName(n)
    requestPersistentStorage()
    setNameState(n.trim())
  }

  // On a walk link, offer that walk's people; otherwise people from recent walks.
  const loadKnown = useCallback(() => {
    if (!services) return Promise.resolve([] as KnownWalker[])
    const m = location.pathname.match(/^\/t\/([^/]+)/)
    return listKnownWalkers(services.db, m?.[1])
  }, [services])

  // Taking an identity back on a walk link: only when you're near that walk.
  const adopt = async (w: KnownWalker): Promise<string | null> => {
    const m = location.pathname.match(/^\/t\/([^/]+)/)
    if (m && services) {
      const trip = await getTrip(services.db, m[1])
      if (trip && trip.status !== 'published') {
        const tooFar = await checkJoinDistance(trip)
        if (tooFar) return tooFar
      }
    }
    adoptIdentity(w.id, w.name)
    requestPersistentStorage()
    setNameState(w.name)
    return null
  }

  if (error) {
    return (
      <div className="splash">
        <h1 className="wordmark">take a walk</h1>
        <div className="error-box">{error}</div>
      </div>
    )
  }
  if (!services) {
    return (
      <div className="splash">
        <h1 className="wordmark">
          take a walk<small>warming up…</small>
        </h1>
      </div>
    )
  }
  if (!name) return <NamePrompt onDone={saveName} loadKnown={loadKnown} onAdopt={adopt} />

  return (
    <ServicesContext.Provider value={services}>
      <BrowserRouter>
        <RememberPath />
        <Routes>
          <Route path="/" element={<Home name={name} onRename={saveName} />} />
          <Route path="/t/:tripId" element={<Trip name={name} />} />
          <Route path="*" element={<Home name={name} onRename={saveName} />} />
        </Routes>
      </BrowserRouter>
    </ServicesContext.Provider>
  )
}
