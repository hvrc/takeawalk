import type { ReactNode } from 'react'

interface Props {
  imageUrl: string
  caption: string
  size?: 'thumb' | 'full'
  /** 0..1 upload progress; shows a bar when < 1 */
  progress?: number | null
  children?: ReactNode
  captionNode?: ReactNode
  onClick?: () => void
  className?: string
}

/** The classic frame: square photo, fat bottom border carrying the caption. */
export default function Polaroid({ imageUrl, caption, size = 'full', progress, children, captionNode, onClick, className = '' }: Props) {
  return (
    <div className={`polaroid ${size} ${className}`} onClick={onClick}>
      <div className="polaroid-photo">
        {imageUrl ? <img src={imageUrl} alt={caption || 'polaroid'} loading="lazy" draggable={false} /> : null}
        {progress != null && progress < 1 ? (
          <div className="uploading">
            <i style={{ ['--p' as string]: `${Math.max(6, Math.round(progress * 100))}%` }} />
          </div>
        ) : null}
      </div>
      {captionNode ?? (
        <div className={`polaroid-caption ${caption ? '' : 'placeholder'}`}>{caption || (size === 'full' ? '' : '')}</div>
      )}
      {children}
    </div>
  )
}
