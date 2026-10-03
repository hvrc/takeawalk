import { useState, type FormEvent } from 'react'

export default function NamePrompt({ onDone, initial = '' }: { onDone: (name: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onDone(value.trim())
  }
  return (
    <div className="splash">
      <h1 className="wordmark">
        take a walk<small>walks, together, with polaroids along the way</small>
      </h1>
      <form onSubmit={submit}>
        <label className="muted tiny center">What should we call you?</label>
        <input
          className="field center"
          autoFocus
          maxLength={24}
          placeholder="your name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          enterKeyHint="go"
        />
        <button className="btn btn-accent" type="submit" disabled={!value.trim()}>
          Let's go
        </button>
      </form>
    </div>
  )
}
