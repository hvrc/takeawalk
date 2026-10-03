import { useEffect, useState } from 'react'
import type { Polaroid as PolaroidT } from '../lib/types'
import Polaroid from './Polaroid'
import { IconClose, IconDownload, IconPin, IconEdit } from './icons'
import { formatCoords, googleMapsUrl } from '../lib/geo'
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
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(p.description)
  const [caption, setCaption] = useState(p.caption)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (saving) return
    setSaving(true)
    try {
      const blob = await renderPolaroid({ imageUrl: p.imageUrl, caption: p.caption, crossOrigin: !p.imageUrl.startsWith('blob:') })
      const r = await saveBlob(blob, `${slugify(p.caption || 'polaroid')}.jpg`)
      if (r === 'downloaded') onToast('Saved')
    } catch {
      // Most likely a CORS-tainted canvas: fall back to the raw photo in a new tab.
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

  const commitEdit = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onSaveText) return
    await onSaveText(caption.trim(), desc.trim())
    setEditing(false)
    onToast('Updated')
  }

  const when = new Date(p.takenAt)
  return (
    <div className="viewer" onClick={onClose}>
      <button className="btn-icon viewer-close" onClick={onClose} aria-label="Close">
        <IconClose />
      </button>
      <div className={`flip ${flipped ? 'is-flipped' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="flip-inner">
          <div className="flip-face flip-front" onClick={() => !editing && setFlipped(true)}>
            <Polaroid
              imageUrl={p.imageUrl}
              caption={editing ? caption : p.caption}
              size="full"
              captionNode={
                editing ? (
                  <div className="polaroid-caption" onClick={(e) => e.stopPropagation()}>
                    <input value={caption} maxLength={120} onChange={(e) => setCaption(e.target.value)} placeholder="caption" />
                  </div>
                ) : undefined
              }
            >
              <div className="polaroid-actions">
                <button className="left" onClick={openMaps} aria-label="Open in Google Maps" title="Open in Google Maps">
                  <IconPin />
                </button>
                <button className="right" onClick={save} aria-label="Save image" title="Save image" disabled={saving}>
                  <IconDownload />
                </button>
              </div>
            </Polaroid>
          </div>
          <div className="flip-face flip-back" onClick={() => !editing && setFlipped(false)}>
            <div className="polaroid-back">
              {editing ? (
                <textarea
                  value={desc}
                  maxLength={2000}
                  placeholder="what was happening here?"
                  onChange={(e) => setDesc(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className={`desc ${p.description ? '' : 'empty'}`}>{p.description || 'nothing written on the back'}</div>
              )}
              <div className="foot">
                <b>
                  <span className="dot" style={{ background: p.color }} />
                  {p.memberName}
                </b>
                <span>
                  {when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                  {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span>{formatCoords(p.lat, p.lng)}</span>
                {canEdit && onSaveText ? (
                  <div className="row" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                    {editing ? (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setEditing(false); setDesc(p.description); setCaption(p.caption) }}>
                          Cancel
                        </button>
                        <button className="btn btn-sm" onClick={commitEdit}>
                          Save
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>
                        <IconEdit style={{ width: 16, height: 16 }} /> Edit
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="viewer-hint">{flipped ? 'tap to flip back' : 'tap the photo to flip it over'}</div>
    </div>
  )
}
