import { useRef, useState } from 'react'
import { cycleTheme, THEMES, useTheme } from '../lib/theme'

/** Taps through the themes; shows the new one's name for a moment. */
export default function ThemeButton({ className = '' }: { className?: string }) {
  const theme = useTheme()
  const [label, setLabel] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const name = THEMES.find((t) => t.key === theme)!.name
  return (
    <span className={`theme-btn-wrap ${className}`}>
      <button
        className="btn-icon theme-btn"
        onClick={() => {
          setLabel(cycleTheme())
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setLabel(null), 1400)
        }}
        aria-label={`Theme: ${name}. Tap for the next one`}
        title={`Theme: ${name}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a9 9 0 100 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.3-4-7.7-9-7.7z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
          <circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" />
          <circle cx="15.2" cy="7.6" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {label ? <span className="theme-label">{label}</span> : null}
    </span>
  )
}
