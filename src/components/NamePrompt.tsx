import { useEffect, useState, type FormEvent } from 'react'
import type { KnownWalker } from '../lib/tripApi'

interface Props {
  onDone: (name: string) => void
  /** People this phone might have been before; tapping one takes that identity back. */
  loadKnown?: () => Promise<KnownWalker[]>
  onAdopt?: (w: KnownWalker) => void
  initial?: string
}

export default function NamePrompt({ onDone, loadKnown, onAdopt, initial = '' }: Props) {
  const [value, setValue] = useState(initial)
  const [known, setKnown] = useState<KnownWalker[]>([])
  useEffect(() => {
    loadKnown?.().then(setKnown, () => undefined)
  }, [loadKnown])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onDone(value.trim())
  }
  return (
    <div className="splash">
      <h1 className="wordmark">
        take a walk <span className="nowrap">(with a friend)</span>
        <small>and pin some pictures along the way</small>
      </h1>
      <form onSubmit={submit}>
        <label className="muted tiny center">What should we call you?</label>
        <input
          className="field center"
          maxLength={24}
          placeholder="your name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          enterKeyHint="go"
        />
        <button className="btn btn-accent" type="submit" disabled={!value.trim()}>
          Get ready
        </button>
      </form>
      {known.length > 0 && onAdopt ? (
        <div className="known">
          <div className="or">been here before? tap your name</div>
          <div className="known-list">
            {known.map((w) => (
              <button key={w.id} className="chip" onClick={() => onAdopt(w)}>
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
