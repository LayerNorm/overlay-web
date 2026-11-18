import { useEffect, useRef, useState } from 'react'

/** A backlog is revealed over about this long, so bursts from the server read as one steady flow. */
const DRAIN_MS = 280
/** Small backlogs still move at a readable pace instead of crawling toward the end. */
const MIN_CHARS_PER_SECOND = 90
/** Re-render the markdown at most this often while revealing (about 30fps). */
const COMMIT_INTERVAL_MS = 32

/**
 * How much of `text` to show after `elapsedMs`, given `shown` characters are visible. Always ends on a word
 * boundary so the transcript gains whole words, never half-typed ones.
 */
export function nextRevealLength(text: string, shown: number, elapsedMs: number): number {
  const backlog = text.length - shown
  if (backlog <= 0) return text.length
  const step = Math.max(
    (MIN_CHARS_PER_SECOND * elapsedMs) / 1000,
    backlog * Math.min(1, elapsedMs / DRAIN_MS),
  )
  let next = Math.min(text.length, shown + Math.max(1, Math.ceil(step)))
  while (next < text.length && !/\s/.test(text[next]!)) next += 1
  return next
}

/**
 * Paces streamed text. Server updates arrive in bursts (one every few hundred milliseconds); this reveals each
 * burst word by word so a reply flows instead of jumping. Text present at mount, and text that never streamed,
 * shows at once. When the stream ends, the complete final text shows immediately.
 */
export function useSmoothStreamText(text: string, isStreaming: boolean): { text: string; revealing: boolean } {
  const [reveal, setReveal] = useState(() => ({ length: text.length, streamed: isStreaming && typeof requestAnimationFrame === 'function' }))
  if (isStreaming && !reveal.streamed && typeof requestAnimationFrame === 'function') setReveal({ ...reveal, streamed: true })
  if (!isStreaming && reveal.streamed && reveal.length !== text.length) setReveal({ ...reveal, length: text.length })
  const length = isStreaming && reveal.streamed && reveal.length <= text.length ? reveal.length : text.length
  const behind = isStreaming && length < text.length
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])

  useEffect(() => {
    if (!behind) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const elapsed = now - last
      if (elapsed >= COMMIT_INTERVAL_MS) {
        last = now
        setReveal((current) => {
          const target = textRef.current
          return { ...current, length: nextRevealLength(target, Math.min(current.length, target.length), elapsed) }
        })
      }
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [behind])

  return { text: behind ? text.slice(0, length) : text, revealing: behind }
}
