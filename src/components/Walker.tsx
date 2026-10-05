import type { CSSProperties } from 'react'

/**
 * Little walking people, after pedestrian crossing signs from around the
 * world: solid (Blois), dotted LED (Calcutta), the man in the hat (Cannes),
 * long stride (Chicago), and a skirt. Each is drawn as thick round-capped
 * limbs, so the dotted one is the same figure with a dashed stroke.
 */
export type WalkerVariant = 'solid' | 'dotted' | 'hat' | 'stride' | 'skirt'

// Limb polylines in a 24x32 box, in two poses for the walking animation.
const POSES = {
  // Mid-stride, like a crossing signal: arms swung well clear of the body.
  a: {
    head: [13.2, 4],
    torso: 'M12.6 9 L11.4 17.4',
    lines: [
      'M11.4 17.4 L15.4 22.2 L17 28.6', // front leg
      'M11.4 17.4 L8.6 22.8 L4.6 27.4', // back leg
      'M12.5 10.2 L16.6 13.2 L19.4 16.6', // front arm, swung forward
      'M12.4 10.2 L8.4 13.4 L5.4 16.2', // back arm, swung back
    ],
  },
  // Passing step: limbs closer in.
  b: {
    head: [12.8, 4.2],
    torso: 'M12.4 9.2 L11.6 17.6',
    lines: ['M11.6 17.6 L13.2 22.6 L13 28.6', 'M11.6 17.6 L10 22.6 L8.6 28.4', 'M12.3 10.4 L14.8 13.8 L15.8 17.2', 'M12.3 10.4 L9.8 13.8 L8.8 17.2'],
  },
  stride: {
    head: [13.6, 4],
    torso: 'M13 9 L11.4 17.2',
    lines: ['M11.4 17.2 L16.2 21.6 L19 27.8', 'M11.4 17.2 L7.8 22.4 L3.4 26.4', 'M12.8 10.2 L17.4 12.4 L20.6 15.4', 'M12.7 10.2 L8 12.6 L4.8 15.2'],
  },
}

interface Props {
  variant?: WalkerVariant
  color?: string
  size?: number
  /** Swap between two poses, as if walking. */
  walking?: boolean
  className?: string
  style?: CSSProperties
  title?: string
}

function Figure({ variant, pose }: { variant: WalkerVariant; pose: keyof typeof POSES }) {
  const p = variant === 'stride' && pose === 'a' ? POSES.stride : POSES[pose]
  const dotted = variant === 'dotted'
  const stroke = dotted ? { strokeWidth: 1.5, strokeDasharray: '0 2.1' } : { strokeWidth: 3 }
  const [hx, hy] = p.head
  return (
    <g className={`pose pose-${pose}`} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...stroke}>
      <path d={p.torso} strokeWidth={dotted ? 1.5 : 5.2} />
      {p.lines.map((d) => (
        <path key={d} d={d} />
      ))}
      {dotted ? (
        <circle cx={hx} cy={hy} r={2.6} />
      ) : (
        <circle cx={hx} cy={hy} r={3} fill="currentColor" stroke="none" />
      )}
      {variant === 'hat' ? (
        <path d={`M${hx - 3.4} ${hy - 1.6} L${hx + 3.6} ${hy - 1.9} M${hx - 1.8} ${hy - 1.9} L${hx - 1.4} ${hy - 4.4} L${hx + 2} ${hy - 4.5} L${hx + 2} ${hy - 1.9}`} strokeWidth={1.6} fill="currentColor" />
      ) : null}
      {variant === 'skirt' ? <path d="M12.4 11.6 L7.4 21 L16.4 21 Z" fill="currentColor" strokeWidth={1.2} /> : null}
    </g>
  )
}

export default function Walker({ variant = 'solid', color, size = 24, walking = false, className = '', style, title }: Props) {
  return (
    <svg
      className={`walker ${walking ? 'walking' : ''} ${className}`}
      viewBox="0 0 24 32"
      width={size * 0.75}
      height={size}
      style={{ color, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <Figure variant={variant} pose="a" />
      {walking ? <Figure variant={variant} pose="b" /> : null}
    </svg>
  )
}

const PARADE: Array<{ variant: WalkerVariant; color: string }> = [
  { variant: 'solid', color: 'var(--leaf)' },
  { variant: 'dotted', color: 'var(--slate)' },
  { variant: 'hat', color: 'var(--ochre)' },
  { variant: 'stride', color: 'var(--ink)' },
  { variant: 'skirt', color: 'var(--brick)' },
  { variant: 'dotted', color: 'var(--leaf)' },
]

/** A little crowd of different walkers crossing. */
export function WalkerParade({ size = 30, count = 6 }: { size?: number; count?: number }) {
  return (
    <div className="walker-parade" aria-hidden="true">
      {PARADE.slice(0, count).map((w, i) => (
        <Walker key={i} variant={w.variant} color={w.color} size={size} walking style={{ animationDelay: `${-i * 0.17}s` }} />
      ))}
    </div>
  )
}

/** A stable pick for something with an id (e.g. a walk card without a photo). */
export function walkerFor(id: string): { variant: WalkerVariant; color: string } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PARADE[h % PARADE.length]
}
