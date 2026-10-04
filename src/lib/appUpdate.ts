import { registerSW } from 'virtual:pwa-register'

/**
 * Keeps the installed app current. iOS resumes a home-screen app from the
 * background without reloading it, so on its own it can run an old version for
 * days. We check for a new version on open, whenever the app comes back to the
 * screen, and every few minutes; a new version is switched in when the app goes
 * to the background or while you're on the home page, never mid-photo (an
 * unsent polaroid lives only in memory until you pin it).
 */
const CHECK_EVERY_MS = 5 * 60_000

export function startAppUpdates() {
  if (!('serviceWorker' in navigator)) return
  let ready = false
  const apply = () => void updateSW(true) // activates the new version and reloads

  const maybeApply = () => {
    if (!ready) return
    const busy = document.querySelector('.sheet, .viewer') // capturing or viewing a photo
    if (document.visibilityState === 'hidden' || (location.pathname === '/' && !busy)) apply()
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true
      maybeApply()
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => void reg.update().catch(() => undefined)
      setInterval(check, CHECK_EVERY_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })

  document.addEventListener('visibilitychange', maybeApply)
  window.addEventListener('popstate', maybeApply)
  setInterval(maybeApply, 30_000)
}
