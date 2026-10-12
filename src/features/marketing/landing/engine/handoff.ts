import { clamp, ease } from '../landing-math'
import { RAIL_ORDER, type RailKey } from '../landing-scenes'
import type { LandingEls } from './els'

/** Transform that moves a rail phrase onto its spot in the hero sentence. */
type Dock = { s: number; tx: number; ty: number }
export type HandoffMeasure = { phrases: Partial<Record<RailKey, Dock>>; lockup: Dock }

export const EMPTY_MEASURE: HandoffMeasure = { phrases: {}, lockup: { s: 1, tx: 0, ty: 0 } }

/**
 * Measure where each rail phrase and the logo have to start so they line up
 * with the hero sentence and the big hero logo. Rail phrases are real elements
 * in the rail; at scroll 0 they are scaled and moved on top of the underlined
 * words of the sentence, and as you scroll they settle into the rail.
 */
export function measureHandoff(els: LandingEls): HandoffMeasure {
  const phrases: HandoffMeasure['phrases'] = {}
  for (const k of RAIL_ORDER) {
    const item = els.railItems[k]
    item.style.transform = 'none'
    item.classList.remove('caps')
  }
  for (const k of RAIL_ORDER) {
    const item = els.railItems[k].getBoundingClientRect()
    const label = els.railLabels[k].getBoundingClientRect()
    const word = els.phrases[k].getBoundingClientRect()
    const s = word.width / label.width
    const cx = label.left + label.width / 2 - item.left
    const cy = label.top + label.height / 2 - item.top
    phrases[k] = {
      s,
      tx: word.left + word.width / 2 - item.left - s * cx,
      ty: word.top + word.height / 2 - item.top - s * cy,
    }
  }
  // hero logo -> nav logo (same lockup, so one uniform scale + translate lines them up)
  els.heroLockup.style.transform = 'none'
  const hero = els.heroLockup.getBoundingClientRect()
  const nav = els.navLockup.getBoundingClientRect()
  return { phrases, lockup: { s: nav.width / hero.width, tx: nav.left - hero.left, ty: nav.top - hero.top } }
}

/** Scroll distance (in viewport heights) the hand-off takes. */
export const HANDOFF_SPAN = 0.9

/**
 * Hero → rail hand-off at progress `r` (0..1): the demo fades away, the logo
 * travels into the nav, and the phrases fly into the rail one after another.
 */
export function applyHandoff(els: LandingEls, m: HandoffMeasure, r: number, y: number, pre: number, peek: boolean) {
  const f = clamp(r * 1.8)
  els.demo.style.opacity = String(1 - f)
  els.demo.style.transform = `translateY(${-f * 36}px) scale(${1 - f * 0.05})`

  const le = ease(clamp(r / 0.9))
  const docked = le >= 1
  const { lockup } = m
  els.heroLockup.style.transform = docked ? '' : `translate(${lockup.tx * le}px, ${lockup.ty * le}px) scale(${1 + (lockup.s - 1) * le})`
  els.heroLockup.style.opacity = docked ? '0' : '1'
  els.nav.style.setProperty('--lk', docked ? '1' : '0')

  const wordOpacity = String(1 - clamp(r * 2.2))
  for (const w of els.subWords) w.style.opacity = wordOpacity
  els.hero.style.pointerEvents = r > 0.3 ? 'none' : ''

  // "open source" appears on hover / first scroll; the caret fades once it starts moving
  const show = Math.max(peek ? 1 : 0, clamp(y / (pre * 0.6)))
  els.rail.style.setProperty('--e', String(ease(r)))
  els.railItems.oss.style.setProperty('--rv', String(show))
  els.railItems.oss.classList.toggle('ghost', show < 0.5)
  els.sub.style.setProperty('--caret', String(show * (1 - clamp((r - 0.12) / 0.25))))

  RAIL_ORDER.forEach((k, i) => {
    const e = ease(clamp((r - i * 0.05) / 0.8))
    const dock = m.phrases[k]
    const item = els.railItems[k]
    if (!dock) return
    item.classList.toggle('caps', ease(r) > 0.5)
    item.style.transform = e >= 1 ? '' : `translate(${dock.tx * (1 - e)}px, ${dock.ty * (1 - e)}px) scale(${dock.s + (1 - dock.s) * e})`
  })
  els.rail.classList.toggle('live', r >= 1)

  // chrome + first view fade in at the end of the hand-off
  els.nav.style.setProperty('--nav', String(clamp((r - 0.6) / 0.4)))
  els.nav.classList.toggle('on', r > 0.6)
  const vo = clamp((r - 0.7) / 0.3)
  els.view.style.setProperty('--vo', String(vo))
  els.view.style.setProperty('--vy', `${(1 - vo) * 24}px`)
  els.view.classList.toggle('live', r >= 1)
}
