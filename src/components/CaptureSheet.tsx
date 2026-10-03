import { useState } from 'react'
import Polaroid from './Polaroid'
import { IconClose } from './icons'
import type { Compressed } from '../lib/image'

interface Props {
  photo: Compressed
  onRetake: () => void
  onCancel: () => void
  onSave: (caption: string, description: string) => void
}

export default function CaptureSheet({ photo, onRetake, onCancel, onSave }: Props) {
  const [caption, setCaption] = useState('')
  const [description, setDescription] = useState('')

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>New polaroid</h2>
        <button className="btn-icon" onClick={onCancel} aria-label="Cancel">
          <IconClose />
        </button>
      </div>
      <div className="polaroid-wrap">
        <Polaroid
          imageUrl={photo.previewUrl}
          caption={caption}
          size="full"
          captionNode={
            <div className="polaroid-caption">
              <input
                value={caption}
                maxLength={120}
                placeholder="write a caption"
                onChange={(e) => setCaption(e.target.value)}
                autoFocus
                enterKeyHint="done"
              />
            </div>
          }
        />
      </div>
      <textarea
        className="field"
        rows={3}
        maxLength={2000}
        placeholder="Description for the back (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="sheet-actions">
        <button className="btn btn-ghost" onClick={onRetake}>
          Retake
        </button>
        <button className="btn btn-accent" onClick={() => onSave(caption.trim(), description.trim())}>
          Pin it to the map
        </button>
      </div>
    </div>
  )
}
