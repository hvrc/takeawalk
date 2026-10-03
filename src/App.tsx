import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { getServices, type Services } from './firebase'
import { ServicesContext } from './services'
import { getName, setName as persistName } from './lib/identity'
import NamePrompt from './components/NamePrompt'
import Home from './pages/Home'
import Trip from './pages/Trip'

export default function App() {
  const [services, setServices] = useState<Services | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setNameState] = useState<string>(() => getName())

  useEffect(() => {
    getServices().then(setServices, (e: Error) => setError(e.message))
  }, [])

  const saveName = (n: string) => {
    persistName(n)
    setNameState(n.trim())
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
  if (!name) return <NamePrompt onDone={saveName} />

  return (
    <ServicesContext.Provider value={services}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home name={name} onRename={saveName} />} />
          <Route path="/t/:tripId" element={<Trip name={name} />} />
          <Route path="*" element={<Home name={name} onRename={saveName} />} />
        </Routes>
      </BrowserRouter>
    </ServicesContext.Provider>
  )
}
