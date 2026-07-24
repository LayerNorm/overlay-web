import { useEffect,useLayoutEffect,useRef,useState } from 'react'
import { recordRender } from '../../lib/perf-debug'

export function useSmoothStreamedText(
  targetText: string,
  isStreaming: boolean,
  enabled: boolean,
): string {
  const [display, setDisplay] = useState(() => (isStreaming && enabled ? '' : targetText))
  const targetRef = useRef(targetText)
  const displayRef = useRef(display)

  useLayoutEffect(() => {
    targetRef.current = targetText
    displayRef.current = display
  }, [targetText, display])

  useEffect(() => {
    if (!enabled || !isStreaming) {
      if (displayRef.current !== targetRef.current) {
        displayRef.current = targetRef.current
        setDisplay(targetRef.current)
      }
      return
    }

    let rafId: number | null = null
    let lastTs = 0

    const tick = (now: number) => {
      const target = targetRef.current
      let cur = displayRef.current

      // If upstream rewrote earlier text (rare — e.g., shim behavior), snap forward
      // so we don't get stuck trying to grow a prefix that no longer matches.
      if (!target.startsWith(cur)) {
        cur = target.slice(0, Math.min(cur.length, target.length))
        displayRef.current = cur
        setDisplay(cur)
      }

      if (cur.length < target.length) {
        const dt = lastTs ? now - lastTs : 16
        const backlog = target.length - cur.length
        // Base 80 chars/sec + proportional catch-up so bursts resolve quickly.
        const charsPerSec = Math.min(600, 80 + backlog * 4)
        const charsToAdd = Math.max(1, Math.round((dt / 1000) * charsPerSec))
        const nextLen = Math.min(target.length, cur.length + charsToAdd)
        const next = target.slice(0, nextLen)
        displayRef.current = next
        setDisplay(next)
        recordRender('smoothPacer.setDisplay')
      }

      lastTs = now
      recordRender('smoothPacer.tick')
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [isStreaming, enabled])

  return display
}

// Find the char position of a safe paragraph boundary in `text`.
// We only split at \n\n that is NOT inside a code fence, a table, or a math block.
function findParagraphBoundary(text: string): number | null {
  const lines = text.split('\n')
  let inCodeBlock = false
  let inTable = false
  let inMathBlock = false
  let pos = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock
    }

    if (!inCodeBlock) {
      if (trimmed === '$$') {
        inMathBlock = !inMathBlock
      }

      if (line.trimStart().startsWith('|')) {
        inTable = true
      } else if (inTable && line.trim() === '') {
        inTable = false
      }
    }

    // A blank line outside a code block / table / math block = paragraph boundary
    if (trimmed === '' && !inCodeBlock && !inTable && !inMathBlock && i > 0) {
      return pos // return start of the blank line (content before it is a complete block)
    }

    pos += line.length + 1 // +1 for the \n
  }

  return null
}

export function splitStreamingMarkdown(text: string): { completedBlocks: string[]; streamTail: string } {
  const completedBlocks: string[] = []
  let offset = 0

  while (offset < text.length) {
    const boundary = findParagraphBoundary(text.slice(offset))
    if (boundary === null) break
    if (boundary === 0) {
      offset += 1
      continue
    }

    const blockText = text.slice(offset, offset + boundary)
    if (blockText) completedBlocks.push(blockText)
    offset += boundary
    while (offset < text.length && (text[offset] === '\n' || text[offset] === '\r')) {
      offset += 1
    }
  }

  return { completedBlocks, streamTail: text.slice(offset) }
}
