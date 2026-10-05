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
  // Mid-stride, upright like a crossing signal: arms swung well clear of the
  // body, the back arm clearly behind. The head sits right on the torso.
  a: {
    head: [12, 4],
    torso: 'M12 7 L12 17.4',
    lines: [
      'M12 17.4 L15.2 22.4 L16.4 28.6', // front leg
      'M12 17.4 L9.2 22.6 L5.8 27.6', // back leg
      'M12 9.6 L15.6 13 L17.6 16.6', // front arm, swung forward
      'M12 9.6 L8 12.2 L4.4 13.8', // back arm, swung well back
    ],
  },
  // Passing step: limbs closer in.
  b: {
    head: [12, 4],
    torso: 'M12 7 L12 17.6',
    lines: ['M12 17.6 L13.2 22.6 L13 28.6', 'M12 17.6 L10.8 22.6 L9.8 28.4', 'M12 9.8 L13.8 13.8 L14.4 17.2', 'M12 9.8 L9.8 13.4 L8.2 16.4'],
  },
  // Standing still, arms at the sides.
  stand: {
    head: [12, 4],
    torso: 'M12 7 L12 17.6',
    lines: ['M12 17.6 L12.9 23 L13.2 28.6', 'M12 17.6 L11.1 23 L10.8 28.6', 'M12 9.8 L14.3 13.6 L14.8 17.4', 'M12 9.8 L9.7 13.6 L9.2 17.4'],
  },
  stride: {
    head: [12.2, 4],
    torso: 'M12.2 7 L12 17.2',
    lines: ['M12 17.2 L16.4 21.6 L18.8 27.8', 'M12 17.2 L8.2 22.4 L3.8 26.4', 'M12.1 9.6 L16.2 12.2 L19.2 15', 'M12.1 9.6 L7.6 11.6 L3.8 12.8'],
  },
}

interface Props {
  variant?: WalkerVariant
  color?: string
  size?: number
  /** Swap between two poses, as if walking. */
  walking?: boolean
  /** Stand still and look one way, then the other. */
  looking?: boolean
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
      {variant === 'skirt' ? <path d="M12 11.4 L7.6 21 L16.4 21 Z" fill="currentColor" strokeWidth={1.2} /> : null}
    </g>
  )
}

export default function Walker({ variant = 'solid', color, size = 24, walking = false, looking = false, className = '', style, title }: Props) {
  return (
    <svg
      className={`walker ${walking ? 'walking' : ''} ${looking && !walking ? 'looking' : ''} ${className}`}
      viewBox="0 0 24 32"
      width={size * 0.75}
      height={size}
      style={{ color, ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {looking && !walking ? (
        <Figure variant={variant} pose="stand" />
      ) : (
        <>
          <Figure variant={variant} pose="a" />
          {walking ? <Figure variant={variant} pose="b" /> : null}
        </>
      )}
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
