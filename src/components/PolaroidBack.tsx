import type { ReactNode } from 'react'
import { formatCoords } from '../lib/geo'

interface Props {
  memberName: string
  color: string
  takenAt: number
  lat?: number
  lng?: number
  description: string
  editable: boolean
  onDescription?: (text: string) => void
  /** Called when the text box loses focus (the viewer saves then). */
  onCommit?: () => void
  flipButton: ReactNode
}

/** The back of a polaroid: the writing, then who / when / where. */
export default function PolaroidBack({ memberName, color, takenAt, lat, lng, description, editable, onDescription, onCommit, flipButton }: Props) {
  const when = new Date(takenAt)
  return (
    <div className="polaroid-back">
      {editable ? (
        <textarea
          value={description}
          maxLength={2000}
          placeholder="write on the back…"
          onChange={(e) => onDescription?.(e.target.value)}
          onBlur={onCommit}
        />
      ) : (
        <div className={`desc ${description ? '' : 'empty'}`}>{description || 'nothing written on the back'}</div>
      )}
      <div className="foot">
        <b>
          <span className="dot" style={{ background: color }} />
          {memberName}
        </b>
        <span>
          {when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
          {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
        <span>{lat != null && lng != null ? formatCoords(lat, lng) : 'pinned where you are when you save'}</span>
      </div>
      <div className="back-flip">{flipButton}</div>
    </div>
  )
}
