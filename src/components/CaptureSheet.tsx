import { useState } from 'react'
import Polaroid from './Polaroid'
import PolaroidBack from './PolaroidBack'
import { IconClose, IconExpand, IconFlip } from './icons'
import CaptionInput from './CaptionInput'
import FullPhoto from './FullPhoto'
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
  /** Still waiting for a location to pin it at. */
  locating?: boolean
  locationNote?: string
  onRetryLocation?: () => void
}

export default function CaptureSheet({ photo, memberName, color, lat, lng, onRetake, onCancel, onSave, locating, locationNote, onRetryLocation }: Props) {
  const [caption, setCaption] = useState('')
  const [description, setDescription] = useState('')
  const [flipped, setFlipped] = useState(false)
  const [full, setFull] = useState(false)
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
              photoOverlay={
                <>
                  <button className="full-btn" onClick={() => setFull(true)} aria-label="See the whole photo">
                    <IconExpand />
                  </button>
                  {flipButton}
                </>
              }
              captionNode={<CaptionInput value={caption} onChange={setCaption} />}
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
      {locationNote ? <p className="sheet-hint location-note">{locationNote}</p> : null}
      <div className="sheet-actions">
        {onRetryLocation ? (
          <button className="btn btn-accent" onClick={onRetryLocation}>
            Try finding my location again
          </button>
        ) : (
          <button className={`btn btn-accent ${locating ? 'busy' : ''}`} onClick={() => onSave(caption.trim(), description.trim())} disabled={locating || lat == null}>
            {locating ? (
              <>
                <span className="spinner sm" aria-hidden="true" /> Finding where you are…
              </>
            ) : (
              'Pin it to the map'
            )}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onRetake}>
          Retake
        </button>
      </div>
      {full ? <FullPhoto src={photo.previewUrl} alt={caption} onClose={() => setFull(false)} /> : null}
    </div>
  )
}
