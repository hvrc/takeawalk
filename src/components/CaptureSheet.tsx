import { useState } from 'react'
import Polaroid from './Polaroid'
import PolaroidBack from './PolaroidBack'
import { IconClose, IconFlip } from './icons'
import type { Compressed } from '../lib/image'

interface Props {
  photo: Compressed
  memberName: string
  color: string
  lat?: number
  lng?: number
  onRetake: () => void
  onCancel: () => void
  onSave: (caption: string, description: string) => void
}

export default function CaptureSheet({ photo, memberName, color, lat, lng, onRetake, onCancel, onSave }: Props) {
  const [caption, setCaption] = useState('')
  const [description, setDescription] = useState('')
  const [flipped, setFlipped] = useState(false)
  const takenAt = useState(() => Date.now())[0]

  const flipButton = (
    <button className="flip-btn" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Flip to the front' : 'Flip to write on the back'}>
      <IconFlip />
    </button>
  )

  return (
    <div className="sheet">
      <div className="sheet-head">
        <h2>New polaroid</h2>
        <button className="btn-icon" onClick={onCancel} aria-label="Cancel">
          <IconClose />
        </button>
      </div>
      <div className={`flip polaroid-wrap ${flipped ? 'is-flipped' : ''}`}>
        <div className="flip-inner">
          <div className="flip-face flip-front">
            <Polaroid
              imageUrl={photo.previewUrl}
              caption={caption}
              size="full"
              photoOverlay={flipButton}
              captionNode={
                <div className="polaroid-caption">
                  <input
                    value={caption}
                    maxLength={120}
                    placeholder="write a caption"
                    onChange={(e) => setCaption(e.target.value)}
                    enterKeyHint="done"
                  />
                </div>
              }
            />
          </div>
          <div className="flip-face flip-back">
            <PolaroidBack
              memberName={memberName}
              color={color}
              takenAt={takenAt}
              lat={lat}
              lng={lng}
              description={description}
              editable
              onDescription={setDescription}
              flipButton={flipButton}
            />
          </div>
        </div>
      </div>
      <p className="sheet-hint">{flipped ? 'Anything you write here goes on the back.' : 'Flip it over to write on the back.'}</p>
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
