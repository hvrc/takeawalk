const DEVICE_KEY = 'taw.deviceId'
const NAME_KEY = 'taw.name'

export const MEMBER_COLORS = [
  // Print inks: strong enough to read as a line on the watercolour map.
  '#c0432e', // brick
  '#2f6fa3', // slate blue
  '#3a8a3f', // leaf
  '#d9961a', // ochre
  '#7b3f6e', // plum
  '#e06a2c', // marigold
  '#1f7f80', // teal
  '#8a2b2b', // maroon
]

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '')
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = 'd' + uuid().replace(/-/g, '')
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

/**
 * A plain description of this device, e.g. "iPhone · Safari (home screen)".
 * Not a fingerprint: just enough for "are you sure you're X?" to make sense.
 */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? (/Pixel/.test(ua) ? 'Pixel' : 'Android phone')
    : /Macintosh/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows PC'
    : /Linux/.test(ua) ? 'Linux' : 'device'
  const browser = /EdgA?\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome/.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari' : 'browser'
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone
  return `${os} · ${browser}${installed ? ' (home screen)' : ''}`
}

/** Take back an identity this person used before (another browser, or wiped storage). */
export function adoptIdentity(id: string, name: string) {
  localStorage.setItem(DEVICE_KEY, id)
  localStorage.setItem(NAME_KEY, name.trim())
}

/** Ask the browser to keep our storage (identity, queued photos) instead of clearing it. */
export function requestPersistentStorage() {
  void navigator.storage?.persist?.().catch(() => undefined)
}

export function getName(): string {
  return localStorage.getItem(NAME_KEY) ?? ''
}

export function setName(name: string) {
  localStorage.setItem(NAME_KEY, name.trim())
}

export function pickColor(taken: string[]): string {
  const free = MEMBER_COLORS.find((c) => !taken.includes(c))
  return free ?? MEMBER_COLORS[taken.length % MEMBER_COLORS.length]
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/L/O/0/1 lookalikes

export function makeJoinCode(): string {
  let out = ''
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}
