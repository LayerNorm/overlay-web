'use client'

import { useEffect, useState } from 'react'

const FADE_MS = 160

/**
 * Swaps text with a fade-out/fade-in instead of a hard cut. Used for the chat
 * title, which starts as "New Chat" and is replaced by a generated one moments
 * later — an instant swap reads as a glitch, a crossfade reads as an update.
 *
 * The faded state is derived from `text !== shown` rather than stored, so it can
 * never be left stuck at zero opacity: the only timer swaps the text in, and if
 * it never fires the component simply keeps showing the previous title.
 */
export function CrossfadeText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text)
  const fading = text !== shown

  useEffect(() => {
    if (text === shown) return
    const timer = window.setTimeout(() => setShown(text), FADE_MS)
    return () => window.clearTimeout(timer)
  }, [shown, text])

  return (
    <span
      className={`transition-opacity duration-150 ease-[var(--overlay-ease)] motion-reduce:transition-none ${
        fading ? 'opacity-0' : 'opacity-100'
      }${className ? ` ${className}` : ''}`}
    >
      {shown}
    </span>
  )
}
