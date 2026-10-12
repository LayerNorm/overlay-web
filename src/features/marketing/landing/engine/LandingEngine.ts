import type { GfxBus } from '../graphics/gfx-bus'
import { clamp } from '../landing-math'
import { HASH_SCENES, RAIL_ORDER, SCENES, firstSceneOf, type SectionKey } from '../landing-scenes'
import { applyAgents, sizeAgents } from './agent-motion'
import { collectEls, type LandingEls } from './els'
import { EMPTY_MEASURE, HANDOFF_SPAN, applyHandoff, measureHandoff, type HandoffMeasure } from './handoff'
import { buildTimeline, sceneAt, type Timeline } from './timeline'

const JUMP_CLASS_MS = 1300
const HERO_INTRO_DELAY_MS = 500
const READY_FALLBACK_MS = 600
const SETTLED_DELAY_MS = 2600
const GFX_NUDGE_PX = 2

export type EngineOptions = {
  /** Called whenever the scene on screen changes (also once for the first scene). */
  onScene: (index: number) => void
}

/**
 * Drives the landing page's scroll story. React renders the markup and the
 * content that changes per scene (title, sidebar, graphic); this class owns
 * everything that moves continuously with the scroll: the hero → rail
 * hand-off, the nav, the agents, and the scene the page is on.
 *
 * The page is a tall track with one sticky stage. Scroll position maps to a
 * scene through `Timeline`; nothing scrolls except that position.
 */
export class LandingEngine {
  private readonly els: LandingEls
  private timeline: Timeline = buildTimeline(1)
  private measure: HandoffMeasure = EMPTY_MEASURE
  private trackTop = 0
  private cur = -1
  private forced: number | null = null
  private heroIntro = 1
  private peek = false
  private frame = 0
  private tween = 0
  private cleanups: Array<() => void> = []
  private timers: number[] = []
  private peekTimer = 0
  private jumpTimer = 0

  /**
   * `bus` is shared with the scene graphic, which draws itself from `bus.p`.
   */
  constructor(root: HTMLElement, private readonly bus: GfxBus, private readonly options: EngineOptions) {
    this.els = collectEls(root)
  }

  /* ---------- lifecycle ---------- */

  start() {
    const { els } = this
    this.listen(window, 'scroll', this.onScroll, { passive: true })
    this.listen(window, 'resize', this.reflow)
    this.listen(window, 'hashchange', this.goToHash)
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) this.listen(window, ev, this.stopTween, { passive: true })
    for (const el of [els.sub, ...Object.values(els.railItems)]) {
      this.listen(el, 'pointerenter', () => this.setPeek(true))
      this.listen(el, 'pointerleave', () => this.setPeek(false))
    }
    for (const k of RAIL_ORDER) this.listen(els.railItems[k], 'click', () => this.go(firstSceneOf(k)))

    try {
      history.scrollRestoration = 'manual'
    } catch {
      /* storage-restricted contexts */
    }
    this.reflow()
    els.root.classList.add('started')
    void document.fonts?.ready.then(() => {
      this.reflow()
      els.root.classList.add('ready')
    })
    this.later(() => els.root.classList.add('ready'), READY_FALLBACK_MS)
    // page-load entrance: hero agents slide in from their edges, then follow the scroll 1:1
    this.later(() => {
      this.heroIntro = 0
      this.update()
    }, HERO_INTRO_DELAY_MS)
    this.later(() => els.root.classList.add('settled'), SETTLED_DELAY_MS)
    this.later(this.goToHash, 0)
  }

  destroy() {
    this.cleanups.forEach((fn) => fn())
    this.cleanups = []
    this.timers.forEach((t) => window.clearTimeout(t))
    this.timers = []
    window.clearTimeout(this.peekTimer)
    window.clearTimeout(this.jumpTimer)
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.tween)
    this.frame = 0
    this.tween = 0
    this.els.root.classList.remove('started', 'ready', 'settled', 'jumping')
  }

  private listen<K extends string>(target: EventTarget, type: K, fn: EventListener | ((e: Event) => void), opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn as EventListener, opts)
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts))
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms))
  }

  /* ---------- layout ---------- */

  private reflow = () => {
    sizeAgents(this.els)
    this.fitHero()
    this.layout()
    this.measureHandoff()
    this.update()
  }

  private layout() {
    this.timeline = buildTimeline(window.innerHeight)
    this.els.track.style.height = `${this.timeline.trackHeight}px`
    this.trackTop = this.els.track.getBoundingClientRect().top + window.scrollY
  }

  private measureHandoff() {
    this.measure = measureHandoff(this.els)
    this.placeBox()
  }

  /**
   * Size the demo so its bottom edge is cropped by only ~4px: the composer stays
   * fully visible. The subtitle is sized from the demo width and the demo's top
   * depends on the subtitle, so settle it in a few passes.
   */
  private fitHero() {
    const { hero, demo } = this.els
    const W = window.innerWidth
    const H = window.innerHeight
    const maxW = Math.min(0.86 * W, 1400)
    let w = maxW
    for (let i = 0; i < 6; i++) {
      hero.style.setProperty('--demo-w', `${w}px`)
      const want = clamp(((H - demo.offsetTop + 4) * 16) / 9, 420, maxW)
      if (Math.abs(want - w) < 1) break
      w = want
    }
  }

  private placeBox() {
    const sec = SCENES[Math.max(0, this.cur)].sec
    const item = sec === 'start' ? null : this.els.railItems[sec]
    if (!item) return
    const box = this.els.railBox.style
    box.left = `${item.offsetLeft}px`
    box.top = `${item.offsetTop}px`
    box.width = `${item.offsetWidth}px`
    box.height = `${item.offsetHeight}px`
  }

  /* ---------- scroll ---------- */

  private scrollPos() {
    return -this.els.track.getBoundingClientRect().top
  }

  private onScroll = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.update()
    })
  }

  private update() {
    const { els, timeline: tl } = this
    const y = this.scrollPos()
    const r = clamp((y - tl.PRE) / (tl.V * HANDOFF_SPAN))
    applyHandoff(els, this.measure, r, y, tl.PRE, this.peek)

    let idx = sceneAt(tl, y)
    if (this.forced !== null) idx = this.forced
    if (idx !== this.cur) this.applyScene(idx)

    const forcedSec: SectionKey | null = this.forced === null ? null : SCENES[this.forced].sec
    applyAgents(els, { y, r, heroIntro: this.heroIntro, forced: forcedSec, timeline: tl })

    const scene = SCENES[idx]
    this.bus.p = clamp((y - tl.starts[idx]) / (scene.len * tl.V))
    this.bus.frame?.()
  }

  private applyScene(i: number) {
    const sec = SCENES[i].sec
    for (const k of RAIL_ORDER) this.els.railItems[k].classList.toggle('on', k === sec)
    this.cur = i
    this.placeBox()
    // a graphic mounted by a jump plays itself; one reached by scrolling follows the scroll
    this.bus.auto = this.els.root.classList.contains('jumping')
    this.bus.t0 = performance.now()
    this.options.onScene(i)
  }

  /* ---------- jumping ---------- */

  /** Instant scroll jump; agents get a short animated cross-over instead of a snap. */
  private jump(top: number) {
    const { root } = this.els
    root.classList.add('jumping')
    this.bus.auto = true
    this.bus.t0 = performance.now()
    this.bus.kick?.()
    window.clearTimeout(this.jumpTimer)
    this.jumpTimer = window.setTimeout(() => root.classList.remove('jumping'), JUMP_CLASS_MS)
    window.scrollTo({ top: this.trackTop + top, behavior: 'instant' })
  }

  private stopTween = () => {
    if (this.tween) {
      cancelAnimationFrame(this.tween)
      this.tween = 0
    }
    this.forced = null
    window.clearTimeout(this.jumpTimer)
    this.els.root.classList.remove('jumping')
  }

  /**
   * Jump straight to a scene. The stage is fixed, so an instant scroll jump just
   * plays the scene's own fade-in. From the hero we first play the hand-off
   * (phrases dock into the rail), then land on the scene.
   */
  go(i: number) {
    if (i < 0 || i >= SCENES.length) return
    this.stopTween()
    const { INTRO, starts, V } = this.timeline
    const target = starts[i] + GFX_NUDGE_PX
    const from = this.scrollPos()
    if (from >= INTRO - 2) {
      this.jump(target)
      return
    }
    this.forced = i
    this.applyScene(i) // content is ready under the still-hidden view
    const dur = 350 + 650 * ((INTRO - from) / V)
    const t0 = performance.now()
    const step = (now: number) => {
      const t = clamp((now - t0) / dur)
      window.scrollTo({ top: this.trackTop + from + (INTRO - from) * (1 - Math.pow(1 - t, 3)), behavior: 'instant' })
      if (t < 1) {
        this.tween = requestAnimationFrame(step)
        return
      }
      this.tween = 0
      this.forced = null
      this.jump(target)
      this.update()
    }
    this.tween = requestAnimationFrame(step)
  }

  /** Footer deep links (`/home#agents` …) arrive as hashes. */
  private goToHash = () => {
    const scene = HASH_SCENES[window.location.hash.replace(/^#/, '')]
    if (scene !== undefined) this.go(scene)
  }

  /** Hovering the subtitle (or any phrase on it) peeks the "open source" insertion. */
  private setPeek(on: boolean) {
    window.clearTimeout(this.peekTimer)
    if (on) {
      if (!this.peek) {
        this.peek = true
        this.update()
      }
      return
    }
    this.peekTimer = window.setTimeout(() => {
      this.peek = false
      this.update()
    }, 140)
  }
}
