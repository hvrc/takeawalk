import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { startAppUpdates } from './lib/appUpdate'

// Android keyboards (Gboard on Pixel) don't close when you press Enter/Done in
// a single-line field unless the field loses focus. Blur it after the press
// (after any form submit has run) so the keyboard goes away. Multi-line
// fields keep Enter for new lines.
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null
  if (e.key !== 'Enter' || e.isComposing || !(t instanceof HTMLInputElement)) return
  setTimeout(() => t.blur(), 0)
})

startAppUpdates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
