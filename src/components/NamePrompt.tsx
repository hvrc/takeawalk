import { useEffect, useState, type FormEvent } from 'react'
import type { KnownWalker } from '../lib/tripApi'
import { deviceLabel } from '../lib/identity'
import { WalkerParade } from './Walker'

interface Props {
  onDone: (name: string) => void
  /** People this phone might have been before; tapping one takes that identity back. */
  loadKnown?: () => Promise<KnownWalker[]>
  /** Resolves with an error message if taking this identity isn't allowed. */
  onAdopt?: (w: KnownWalker) => Promise<string | null>
  initial?: string
}

export default function NamePrompt({ onDone, loadKnown, onAdopt, initial = '' }: Props) {
  const [value, setValue] = useState(initial)
  const [known, setKnown] = useState<KnownWalker[]>([])
  const [confirming, setConfirming] = useState<KnownWalker | null>(null)
  const [adoptMsg, setAdoptMsg] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)
  const here = deviceLabel()

  const confirmAdopt = async () => {
    if (!confirming || !onAdopt) return
    setAdopting(true)
    setAdoptMsg(null)
    const err = await onAdopt(confirming).catch((e: Error) => e.message)
    setAdopting(false)
    if (err) setAdoptMsg(err)
  }
  useEffect(() => {
    loadKnown?.().then(setKnown, () => undefined)
  }, [loadKnown])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onDone(value.trim())
  }
  return (
    <div className="splash">
      <WalkerParade size={40} />
      <h1 className="wordmark">
        take a walk <span className="nowrap">(with a friend)</span>
        <small>and pin some pictures along the way</small>
      </h1>
      {confirming ? null : (
      <form onSubmit={submit}>
        <input
          className="field center"
          maxLength={24}
          placeholder="your name"
          aria-label="Your name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          enterKeyHint="go"
        />
        <button className="btn btn-accent" type="submit" disabled={!value.trim()}>
          Get ready
        </button>
      </form>
      )}
      {confirming ? (
        <div className="confirm-card card">
          <h2>Are you sure you're {confirming.name}?</h2>
          <p className="muted">
            {confirming.device && confirming.device !== here
              ? `${confirming.name} was last on ${withArticle(confirming.device)}. This is ${withArticle(here)}.`
              : `You'll pick up as ${confirming.name}: same colour, same line, and you can edit their photos.`}
          </p>
          {adoptMsg ? <p className="confirm-error">{adoptMsg}</p> : null}
          <button className={`btn btn-accent ${adopting ? 'busy' : ''}`} onClick={confirmAdopt} disabled={adopting}>
            {adopting ? <span className="spinner sm" aria-label="Checking" /> : `Yes, I'm ${confirming.name}`}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setConfirming(null)
              setAdoptMsg(null)
            }}
          >
            No, go back
          </button>
        </div>
      ) : known.length > 0 && onAdopt ? (
        <div className="known">
          <div className="or">been here before? tap your name</div>
          <div className="known-list">
            {known.map((w) => (
              <button key={w.id} className="chip" onClick={() => setConfirming(w)}>
                <span className="dot" style={{ background: w.color }} />
                {w.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function withArticle(device: string): string {
  return /^[aeiouAEIOU]/.test(device) ? `an ${device}` : `a ${device}`
}
