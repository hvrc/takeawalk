import { useSyncExternalStore } from 'react'

/** The app's looks. Each has matching CSS ([data-theme] in styles.css) and a map palette (mapStyle.ts). */
export const THEMES = [
  { key: 'paper', name: 'Paper', bar: '#f1ead8' },
  { key: 'night', name: 'Night', bar: '#1c1a17' },
  { key: 'blueprint', name: 'Blueprint', bar: '#1c4a82' },
  { key: 'riso', name: 'Riso', bar: '#f6f0e6' },
  { key: 'newsprint', name: 'Newsprint', bar: '#ecebe6' },
] as const
export type ThemeKey = (typeof THEMES)[number]['key']

const KEY = 'taw.theme'
const listeners = new Set<() => void>()

function read(): ThemeKey {
  try {
    const t = localStorage.getItem(KEY)
    if (THEMES.some((x) => x.key === t)) return t as ThemeKey
  } catch {
    /* no storage */
  }
  return 'paper'
}

let current: ThemeKey = read()

function apply(t: ThemeKey) {
  document.documentElement.dataset.theme = t
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEMES.find((x) => x.key === t)!.bar)
}
apply(current)

export function getTheme(): ThemeKey {
  return current
}

/** Moves to the next theme (wrapping round) and returns its name. */
export function cycleTheme(): string {
  const i = THEMES.findIndex((x) => x.key === current)
  current = THEMES[(i + 1) % THEMES.length].key
  try {
    localStorage.setItem(KEY, current)
  } catch {
    /* ignore */
  }
  apply(current)
  listeners.forEach((fn) => fn())
  return THEMES.find((x) => x.key === current)!.name
}

export function useTheme(): ThemeKey {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
}
