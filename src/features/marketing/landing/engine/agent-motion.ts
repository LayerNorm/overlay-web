import { clamp, ease } from '../landing-math'
import { AGENT_GROUPS, type AgentGroupKey } from '../landing-agents'
import type { SectionKey } from '../landing-scenes'
import type { AgentRef, LandingEls } from './els'
import type { Timeline } from './timeline'

const group = (ref: AgentRef) => AGENT_GROUPS[ref.group as AgentGroupKey]?.[ref.index]

/**
 * Park position = straight out through the nearest edge (left / right / top /
 * bottom), just far enough to be off-screen.
 */
export function sizeAgents(els: LandingEls) {
  const W = window.innerWidth
  const H = window.innerHeight
  const k = clamp(W / 1300, 0.8, 1.1)
  els.agents.style.setProperty('--k', String(k))
  for (const ref of els.agentRefs) {
    const a = group(ref)
    if (!a) continue
    const size = a.s * k
    const d = { l: (a.x / 100) * W, r: ((100 - a.x) / 100) * W, t: (a.y / 100) * H, b: ((100 - a.y) / 100) * H }
    const edge = (Object.keys(d) as Array<keyof typeof d>).reduce((m, e) => (d[e] < d[m] ? e : m), 'l')
    const off = d[edge] + size
    ref.off = edge === 'l' ? [-off, 0] : edge === 'r' ? [off, 0] : edge === 't' ? [0, -off] : [0, off]
    ref.el.style.setProperty('--off', `translate(${ref.off[0]}px, ${ref.off[1]}px)`)
  }
}

/** d: 0 = in place, 1 = parked off-screen. */
function place(ref: AgentRef, d: number) {
  ref.el.style.transform = d <= 0 ? 'none' : `translate(${ref.off[0] * d}px, ${ref.off[1] * d}px)`
  ref.el.classList.toggle('parked', d >= 0.999)
  ref.el.style.pointerEvents = d < 0.2 ? 'auto' : 'none'
}

export type AgentFrame = {
  y: number
  /** Hero hand-off progress. */
  r: number
  /** 1 while the hero agents are still below the screen (page-load entrance). */
  heroIntro: number
  /** Section being force-shown during a jump from the hero, if any. */
  forced: SectionKey | null
  timeline: Timeline
}

/**
 * Every agent is scrubbed by the scroll along the line to its nearest edge.
 * Hero agents leave as the hand-off plays; each later section's pair enters
 * over the last 0.6 screens before that section and leaves over the last 0.6
 * screens of it, so the pairs cross over through their own edges.
 */
export function applyAgents(els: LandingEls, f: AgentFrame) {
  const { V, secRange } = f.timeline
  const W = 0.6 * V
  const Wd = W - 0.08 * V // stagger without overrunning the boundary
  for (const ref of els.agentRefs) {
    const i = ref.index
    if (ref.group === 'hero') {
      place(ref, Math.max(f.heroIntro, ease(clamp((f.r - i * 0.04) / 0.8))))
      continue
    }
    const sec = ref.group as SectionKey
    const range = secRange[sec]
    if (!range) continue
    let d: number
    if (f.forced !== null) {
      // jump from the hero in progress: only the target's pair enters, in step with the hand-off
      d = f.forced === sec ? 1 - ease(clamp((f.r - 0.35 - i * 0.08) / 0.65)) : 1
    } else {
      const lag = i * 0.08 * V
      const enter = ease(clamp((f.y - (range.S - W) - lag) / Wd))
      const exit = range.E === Infinity ? 0 : ease(clamp((f.y - (range.E - W) - lag) / Wd))
      d = Math.max(1 - enter, exit)
    }
    place(ref, d)
  }
}
