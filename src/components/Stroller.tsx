import { useEffect, useRef } from 'react'
import Walker, { type WalkerVariant } from './Walker'

/**
 * A walker that strolls to the end of its track and back. The track is
 * whatever space its parent gives it (it fills the rest of the row).
 */
export default function Stroller({ variant = 'solid', color = 'var(--ink)', size = 26 }: { variant?: WalkerVariant; color?: string; size?: number }) {
  const track = useRef<HTMLDivElement>(null)
  const who = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = track.current
    const w = who.current
    if (!t || !w) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Matched to the leg cycle (two steps per 0.9s) so his feet don't slide.
    const SPEED = 16 // px per second
    let x = 0
    let dir = 1
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const max = Math.max(0, t.clientWidth - w.offsetWidth)
      x += dir * SPEED * dt
      if (x >= max) [x, dir] = [max, -1]
      if (x <= 0) [x, dir] = [0, 1]
      w.style.transform = `translateX(${x}px) scaleX(${dir})`
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
