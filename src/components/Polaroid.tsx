import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { fitText } from '../lib/fitText'

interface Props {
  imageUrl: string
  caption: string
  size?: 'thumb' | 'full'
  /** 0..1 upload progress; shows a bar when < 1 */
  progress?: number | null
  children?: ReactNode
  captionNode?: ReactNode
  /** Rendered inside the photo area, e.g. the flip button in its corner. */
  photoOverlay?: ReactNode
  onPhotoClick?: () => void
  onClick?: () => void
  className?: string
}

/** The classic frame: square photo, fat bottom border carrying the caption. */
export default function Polaroid({ imageUrl, caption, size = 'full', progress, children, captionNode, photoOverlay, onPhotoClick, onClick, className = '' }: Props) {
  const capRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => fitText(capRef.current), [caption, captionNode])
  return (
    <div className={`polaroid ${size} ${className}`} onClick={onClick}>
      <div className={`polaroid-photo ${onPhotoClick ? 'tappable' : ''}`} onClick={onPhotoClick}>
        {imageUrl ? <img src={imageUrl} alt={caption || 'polaroid'} loading="lazy" draggable={false} /> : null}
        {progress != null && progress < 1 ? (
          <div className="uploading">
            <i style={{ ['--p' as string]: `${Math.max(6, Math.round(progress * 100))}%` }} />
          </div>
        ) : null}
        {photoOverlay}
      </div>
      {captionNode ?? (
        <div className="polaroid-caption">
          <div ref={capRef} className={`caption-text ${caption ? '' : 'placeholder'}`}>
            {caption}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
