
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

/** Ask the browser to keep our storage (identity, queued photos) instead of clearing it. */
export function requestPersistentStorage() {
  void navigator.storage?.persist?.().catch(() => undefined)
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
