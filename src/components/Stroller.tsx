import { useEffect, useRef } from 'react'
import Walker, { type WalkerVariant } from './Walker'

/**
 * A walker that strolls to the end of its track and back, kicking up little
 * puffs of dust that fade behind him. The track is whatever space its parent
 * gives it (it fills the rest of the row).
 */
export default function Stroller({ variant = 'solid', color = 'var(--ink)', size = 26 }: { variant?: WalkerVariant; color?: string; size?: number }) {
  const track = useRef<HTMLDivElement>(null)
  const who = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = track.current
    const w = who.current
    if (!t || !w) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const SPEED = 34 // px per second
    let x = 0
    let dir = 1
    let last = performance.now()
    let sinceDust = 0
    let raf = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const max = Math.max(0, t.clientWidth - w.offsetWidth)
      x += dir * SPEED * dt
      if (x >= max) [x, dir] = [max, -1]
      if (x <= 0) [x, dir] = [0, 1]
      w.style.transform = `translateX(${x}px) scaleX(${dir})`
      sinceDust += dt
      if (sinceDust > 0.16) {
        sinceDust = 0
        const puff = document.createElement('span')
        puff.className = 'dust'
        // Behind the heels: the trailing side depends on which way he's going.
        const heel = x + (dir > 0 ? 2 : w.offsetWidth - 2)
        puff.style.left = `${heel + (Math.random() - 0.5) * 4}px`
        puff.style.setProperty('--dx', `${-dir * (4 + Math.random() * 6)}px`)
        puff.style.setProperty('--s', String(0.6 + Math.random() * 0.7))
        t.appendChild(puff)
        setTimeout(() => puff.remove(), 900)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="stroll-track" ref={track} aria-hidden="true">
      <div className="stroller" ref={who}>
        <Walker variant={variant} color={color} size={size} walking />
      </div>
    </div>
  )
}
