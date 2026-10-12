'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useRemeasure } from './use-remeasure'

type RollWord = { id: number; text: string; leaving: boolean }
type RollState = { text: string; seq: number; words: RollWord[] }

const IN_MS = 420
const OUT_MS = 380
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * One piece of rolling text. A new word slides in from below; a leaving word
 * slides up and out, then asks to be removed. Driven with the Web Animations
 * API (not CSS) so a reduced-motion stylesheet cannot cancel the exit and leave
 * two words stacked on top of each other. With reduced motion it only fades.
 */
function RollWordEl({ word, enter, onGone }: { word: RollWord; enter: boolean; onGone: (id: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!enter) return
    const calm = prefersReducedMotion()
    const from = calm ? { opacity: 0 } : { opacity: 0, transform: 'translateY(80%)' }
    const anim = ref.current?.animate([from, { opacity: 1, transform: 'none' }], { duration: IN_MS, easing: EASE })
    return () => anim?.cancel()
  }, [enter])

  useLayoutEffect(() => {
    if (!word.leaving) return
    const calm = prefersReducedMotion()
    const to = calm ? { opacity: 0 } : { opacity: 0, transform: 'translateY(-80%)' }
    const anim = ref.current?.animate([{ opacity: 1, transform: 'none' }, to], { duration: OUT_MS, easing: EASE, fill: 'forwards' })
    // the timer is a backstop for browsers that never finish the animation (hidden tab)
    const backstop = window.setTimeout(() => onGone(word.id), OUT_MS + 200)
    if (anim) anim.onfinish = () => onGone(word.id)
    return () => {
      window.clearTimeout(backstop)
      if (anim) anim.onfinish = null
    }
  }, [word.leaving, word.id, onGone])

  return <span ref={ref} className="w">{word.text}</span>
}

/**
 * The part of the title that changes between scenes. The old text slides up and
 * out while the new text slides in from below, and the box animates to the new
 * width so the rest of the line stays centered. At most two words exist at once:
 * if scenes change faster than the exit, the word that was already leaving is
 * dropped instead of piling up.
 */
function Roll({ text }: { text: string }) {
  const [state, setState] = useState<RollState>({ text, seq: 1, words: [{ id: 0, text, leaving: false }] })
  const boxRef = useRef<HTMLSpanElement>(null)

  if (state.text !== text) {
    setState({
      text,
      seq: state.seq + 1,
      words: [
        ...state.words.filter((w) => !w.leaving).map((w) => ({ ...w, leaving: true })),
        { id: state.seq, text, leaving: false },
      ],
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

  const drop = useCallback((id: number) => setState((s) => ({ ...s, words: s.words.filter((w) => w.id !== id) })), [])

  return (
    <span className="roll" ref={boxRef}>
      {state.words.map((w) => (
        <RollWordEl key={w.id} word={w} enter={w.id > 0 && !w.leaving} onGone={drop} />
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
