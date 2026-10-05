import { IconClose, IconDownload } from './icons'

interface Props {
  src: string
  alt: string
  onClose: () => void
  onSave?: () => void
  saving?: boolean
}

/** The photo at its real proportions, not the polaroid's square crop. */
export default function FullPhoto({ src, alt, onClose, onSave, saving }: Props) {
  return (
    <div
      className="fullview"
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
    >
      <img src={src} alt={alt || 'photo'} />
      <div className="fullview-bar" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <IconClose style={{ width: 16, height: 16 }} /> Close
        </button>
        {onSave ? (
          <button className="btn btn-sm" onClick={onSave} disabled={saving}>
            <IconDownload style={{ width: 16, height: 16 }} /> Save full photo
          </button>
        ) : null}
      </div>
    </div>
  )
}
