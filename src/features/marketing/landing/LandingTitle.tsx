'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useRemeasure } from './use-remeasure'

type RollWord = { id: number; text: string; leaving: boolean }
type RollState = { text: string; seq: number; words: RollWord[] }

const LEAVE_MS = 450

/**
 * The part of the title that changes between scenes. The old text slides up and
 * out while the new text slides in from below, and the box animates to the new
 * width so the rest of the line stays centered.
 */
function Roll({ text }: { text: string }) {
  const [state, setState] = useState<RollState>({ text, seq: 1, words: [{ id: 0, text, leaving: false }] })
  const boxRef = useRef<HTMLSpanElement>(null)

  if (state.text !== text) {
    setState({
      text,
      seq: state.seq + 1,
      words: [...state.words.map((w) => ({ ...w, leaving: true })), { id: state.seq, text, leaving: false }],
    })
  }

  const fit = useCallback((animate = true) => {
    const box = boxRef.current
    const word = box?.lastElementChild as HTMLElement | null
    if (!box || !word) return
    if (!animate) box.style.transition = 'none'
    box.style.width = `${word.offsetWidth}px`
    if (!animate) {
      void box.offsetWidth
      box.style.transition = ''
    }
  }, [])

  useLayoutEffect(() => {
    fit(state.words.length === 1)
  }, [state.words, fit])

  useRemeasure(useCallback(() => fit(false), [fit]))

  const leaving = state.words.some((w) => w.leaving)
  useLayoutEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(() => setState((s) => ({ ...s, words: s.words.filter((w) => !w.leaving) })), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [leaving, state.seq])

  return (
    <span className="roll" ref={boxRef}>
      {state.words.map((w) => (
        <span key={w.id} className={`w${w.leaving ? ' out' : w.id > 0 ? ' in' : ''}`}>{w.text}</span>
      ))}
    </span>
  )
}

/**
 * Section title: a fixed start plus one changing piece, all on one line, e.g.
 * "AI agents with" [memory remember everything]. Changing the start re-mounts
 * the title so it fades in.
 */
export function LandingTitle({ pre, piece, animate }: { pre: string; piece: string; animate: boolean }) {
  return (
    <h2 className={animate ? 'title anim' : 'title'} key={pre}>
      {pre}
      {piece ? <Roll text={piece} /> : null}
    </h2>
  )
}
