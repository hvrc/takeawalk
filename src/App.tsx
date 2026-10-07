import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { getServices, type Services } from './firebase'
import { ServicesContext } from './services'
import { requestPersistentStorage } from './lib/identity'
import { signOut, useAccount } from './lib/account'
import AuthScreen, { ChooseUsername } from './components/AuthScreen'
import Home from './pages/Home'
import Trip from './pages/Trip'
import Admin from './pages/Admin'
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

  useEffect(() => {
    getServices().then((s) => {
      // Start uploading any photos still queued on this phone, from any walk.
      uploader.start(s)
      setServices(s)
    }, (e: Error) => setError(e.message))
  }, [])

  // Admin has its own sign-in; it doesn't need an account or Firebase.
  if (location.pathname.replace(/\/$/, '') === '/admin') return <Admin />

  if (error) {
    return (
      <div className="splash">
        <h1 className="wordmark">take a walk</h1>
        <div className="error-box">{error}</div>
      </div>
    )
  }
  if (!services) return <Warming />
  return <Signed services={services} />
}

function Warming() {
  return (
    <div className="splash">
      <h1 className="wordmark">
        take a walk<small>warming up…</small>
      </h1>
    </div>
  )
}

function Signed({ services }: { services: Services }) {
  const account = useAccount(services)
  useEffect(() => {
    if (account.status === 'ready') {
      uploader.setUser(account.uid)
      requestPersistentStorage()
    }
  }, [account])

  if (account.status === 'loading') return <Warming />
  if (account.status === 'signed-out') return <AuthScreen services={services} />
  if (account.status === 'needs-username')
    return <ChooseUsername services={services} suggestion={account.suggestion} guest={account.guest} onSignOut={() => void signOut(services)} />

  const me = { id: account.uid, name: account.username, guest: account.guest }
  return (
    <ServicesContext.Provider value={services}>
      <BrowserRouter>
        <RememberPath />
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/t/:tripId" element={<Trip me={me} />} />
          <Route path="*" element={<Home me={me} />} />
        </Routes>
      </BrowserRouter>
    </ServicesContext.Provider>
  )
}
