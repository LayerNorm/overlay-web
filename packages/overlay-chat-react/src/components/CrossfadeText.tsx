'use client'

import { useEffect, useState } from 'react'

const FADE_MS = 160

/**
 * Swaps text with a fade-out/fade-in instead of a hard cut. Used for the chat
 * title, which starts as "New Chat" and is replaced by a generated one moments
 * later — an instant swap reads as a glitch, a crossfade reads as an update.
 *
 * All state changes happen inside rAF / timeout callbacks so the component
 * never triggers a cascading render from inside an effect.
 */
export function CrossfadeText({ text, className }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text)
  const [faded, setFaded] = useState(false)

  useEffect(() => {
    if (text === shown) return
    const frame = requestAnimationFrame(() => setFaded(true))
    const timer = window.setTimeout(() => {
      setShown(text)
      setFaded(false)
    }, FADE_MS)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [shown, text])

  return (
    <span
      className={`transition-opacity duration-150 ease-[var(--overlay-ease)] motion-reduce:transition-none ${
        faded ? 'opacity-0' : 'opacity-100'
      }${className ? ` ${className}` : ''}`}
    >
      {shown}
    </span>
  )
}
