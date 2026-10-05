import { useLayoutEffect, useRef } from 'react'
import { fitText } from '../lib/fitText'

interface Props {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
}

/** The caption you type on a polaroid: wraps to two lines and shrinks to fit. Enter finishes. */
export default function CaptionInput({ value, onChange, onCommit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // One line if it fits, two if it doesn't, then shrink. The caption strip centres it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.fontSize = ''
    el.rows = 1
    if (el.scrollHeight > el.clientHeight + 1) el.rows = 2
    fitText(el)
  }, [value])
  return (
    <div className="polaroid-caption">
      <textarea
        ref={ref}
        className="caption-edit"
        rows={1}
        value={value}
        maxLength={120}
        placeholder="write a caption"
        aria-label="Caption"
        enterKeyHint="done"
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur() // closes the keyboard on Android too
          }
        }}
        onBlur={onCommit}
      />
    </div>
  )
}
