import { clamp, segE } from '../landing-math'

/**
 * Applies one progress value (0..1) to every element of a scene graphic.
 * Elements opt in with data attributes (all windows are [from, to] progress):
 *
 *   data-in="a,b" data-mode="up|left|right|scale|none"  fade/slide/scale in
 *   data-line="a,b"                                     draw an SVG path (pathLength=1)
 *   data-on="a"                                         add class `on` once progress >= a
 *   data-active="a,b"                                   class `active` inside the window
 *   data-type="a,b" data-text="..."                     type the text out
 *   data-move="a,b,x1,y1,x2,y2"                         travel between two points
 *   data-bar="a,b,pct"                                  grow a bar to pct %
 *   data-count                                          "N notes" counter (memory scene)
 */

const parsed = new WeakMap<Element, Record<string, number[]>>()

function nums(el: Element, attr: string): number[] {
  let store = parsed.get(el)
  if (!store) {
    store = {}
    parsed.set(el, store)
  }
  if (!store[attr]) store[attr] = (el.getAttribute(attr) ?? '').split(',').map(Number)
  return store[attr]
}

type Styled = HTMLElement | SVGElement

const SLIDES: Record<string, (s: number) => string> = {
  up: (s) => `0 ${(1 - s) * 14}px`,
  left: (s) => `${-(1 - s) * 26}px 0`,
  right: (s) => `${(1 - s) * 26}px 0`,
}

function applyIn(el: Styled, gp: number) {
  const [a, b] = nums(el, 'data-in')
  const s = segE(gp, a, b)
  const mode = el.getAttribute('data-mode') ?? 'up'
  el.style.opacity = String(s)
  el.style.translate = (SLIDES[mode] ?? (() => '0 0'))(s)
  el.style.scale = mode === 'scale' ? String(0.8 + 0.2 * s) : '1'
}

function applyLine(el: Styled, gp: number) {
  const [a, b] = nums(el, 'data-line')
  el.style.strokeDashoffset = String(1 - segE(gp, a, b))
}

function applyType(el: Element, gp: number) {
  const [a, b] = nums(el, 'data-type')
  const text = el.getAttribute('data-text') ?? ''
  el.textContent = text.slice(0, Math.round(text.length * clamp((gp - a) / (b - a))))
}

function applyMove(el: Styled, gp: number) {
  const [a, b, x1, y1, x2, y2] = nums(el, 'data-move')
  const s = segE(gp, a, b)
  el.style.translate = `${x1 + (x2 - x1) * s}px ${y1 + (y2 - y1) * s}px`
  el.style.opacity = gp < a - 0.05 ? '0' : '1'
}

function applyBar(el: Styled, gp: number) {
  const [a, b, pct] = nums(el, 'data-bar')
  el.style.width = `${pct * segE(gp, a, b)}%`
}

export function runGfx(root: Element, gp: number) {
  root.querySelectorAll<Styled>('[data-in]').forEach((el) => applyIn(el, gp))
  root.querySelectorAll<Styled>('[data-line]').forEach((el) => applyLine(el, gp))
  root.querySelectorAll('[data-on]').forEach((el) => el.classList.toggle('on', gp >= nums(el, 'data-on')[0]))
  root.querySelectorAll('[data-active]').forEach((el) => {
    const [a, b] = nums(el, 'data-active')
    el.classList.toggle('active', gp >= a && gp < b)
  })
  root.querySelectorAll('[data-type]').forEach((el) => applyType(el, gp))
  root.querySelectorAll<Styled>('[data-move]').forEach((el) => applyMove(el, gp))
  root.querySelectorAll<Styled>('[data-bar]').forEach((el) => applyBar(el, gp))
  const count = root.querySelector('[data-count]')
  if (count) count.textContent = `${Math.min(4, Math.floor(gp / 0.1 + 0.2))} notes`
}
