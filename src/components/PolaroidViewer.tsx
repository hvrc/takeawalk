import { useEffect, useState } from 'react'
import type { Polaroid as PolaroidT } from '../lib/types'
import Polaroid from './Polaroid'
import PolaroidBack from './PolaroidBack'
import { IconClose, IconDownload, IconExpand, IconFlip, IconPin } from './icons'
import CaptionInput from './CaptionInput'
import FullPhoto from './FullPhoto'
import { googleMapsUrl } from '../lib/geo'
import { renderPolaroid, saveBlob, slugify } from '../lib/image'

interface Props {
  polaroid: PolaroidT
  canEdit: boolean
  onClose: () => void
  onSaveText?: (caption: string, description: string) => Promise<void>
  onToast: (msg: string) => void
}

export default function PolaroidViewer({ polaroid: p, canEdit, onClose, onSaveText, onToast }: Props) {
  const [flipped, setFlipped] = useState(false)
  const [full, setFull] = useState(false)
  const [saving, setSaving] = useState(false)
  const [caption, setCaption] = useState(p.caption)
  const [desc, setDesc] = useState(p.description)
  const editable = canEdit && !!onSaveText

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (full) setFull(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, full])

  // Saves whatever changed when a text field loses focus.
  const commit = async () => {
    if (!onSaveText) return
    const c = caption.trim()
    const d = desc.trim()
    if (c === p.caption && d === p.description) return
    try {
      await onSaveText(c, d)
      onToast('Saved')
    } catch {
      onToast("Couldn't save that. Check your connection and try again.")
    }
  }

  const savePolaroid = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    try {
      const blob = await renderPolaroid({ imageUrl: p.imageUrl, caption: caption.trim(), crossOrigin: !p.imageUrl.startsWith('blob:') })
      const r = await saveBlob(blob, `${slugify(caption || 'polaroid')}.jpg`)
      if (r === 'downloaded') onToast('Saved')
    } catch {
      // Most likely a CORS-tainted canvas: fall back to the raw photo in a new tab.
      window.open(p.imageUrl, '_blank', 'noopener')
      onToast('Opened photo. Long-press to save.')
    } finally {
      setSaving(false)
    }
  }

  // The photo as it was taken (full proportions), not the square polaroid crop.
  const saveOriginal = async () => {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch(p.imageUrl)
      if (!res.ok) throw new Error(String(res.status))
      const r = await saveBlob(await res.blob(), `${slugify(caption || 'photo')}-full.jpg`)
      if (r === 'downloaded') onToast('Saved')
    } catch {
      window.open(p.imageUrl, '_blank', 'noopener')
      onToast('Opened photo. Long-press to save.')
    } finally {
      setSaving(false)
    }
  }

  const openMaps = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.open(googleMapsUrl(p.lat, p.lng), '_blank', 'noopener')
  }

  const flipButton = (
    <button
      className="flip-btn"
      onClick={(e) => {
        e.stopPropagation()
        setFlipped((f) => !f)
      }}
      aria-label={flipped ? 'Flip to the front' : 'Flip it over'}
    >
      <IconFlip />
    </button>
  )

  return (
    <div className="viewer" onClick={onClose}>
      <button className="btn-icon viewer-close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>
      <div className={`flip ${flipped ? 'is-flipped' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="flip-inner">
          <div className="flip-face flip-front">
            <Polaroid
              imageUrl={p.imageUrl}
              caption={caption}
              size="full"
              photoOverlay={
                <>
                  <button
                    className="full-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setFull(true)
                    }}
                    aria-label="See the whole photo"
                  >
                    <IconExpand />
                  </button>
                  {flipButton}
                </>
              }
              captionNode={editable ? <CaptionInput value={caption} onChange={setCaption} onCommit={commit} /> : undefined}
            >
              <div className="polaroid-actions">
                <button onClick={openMaps} aria-label="Open in Google Maps" title="Open in Google Maps">
                  <IconPin />
                </button>
                <button onClick={savePolaroid} aria-label="Save image" title="Save as a polaroid" disabled={saving}>
                  <IconDownload />
                </button>
              </div>
            </Polaroid>
          </div>
          <div className="flip-face flip-back">
            <PolaroidBack
              memberName={p.memberName}
              color={p.color}
              takenAt={p.takenAt}
              lat={p.lat}
              lng={p.lng}
              description={editable ? desc : p.description}
              editable={editable}
              onDescription={setDesc}
              onCommit={commit}
              flipButton={flipButton}
            />
          </div>
        </div>
      </div>
      <div className="viewer-hint">{flipped ? 'tap the arrows to flip back' : 'corners: see it whole · flip it over'}</div>

      {full ? <FullPhoto src={p.imageUrl} alt={caption} onClose={() => setFull(false)} onSave={saveOriginal} saving={saving} /> : null}
    </div>
  )
}
