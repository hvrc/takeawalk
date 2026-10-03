const DEVICE_KEY = 'taw.deviceId'
const NAME_KEY = 'taw.name'

export const MEMBER_COLORS = [
  '#ff5a5f', // coral
  '#3a86ff', // blue
  '#06d6a0', // mint
  '#ffbe0b', // yellow
  '#8338ec', // purple
  '#fb5607', // orange
  '#ff006e', // pink
  '#118ab2', // teal
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
