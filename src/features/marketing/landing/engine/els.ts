import { RAIL_ORDER, type RailKey } from '../landing-scenes'

/** Every element the scroll engine writes to, looked up once from the rendered markup. */
export type AgentRef = {
  el: HTMLElement
  group: string
  index: number
  /** Where the agent sits when parked just past the nearest screen edge. */
  off: [number, number]
}

export type LandingEls = {
  root: HTMLElement
  track: HTMLElement
  nav: HTMLElement
  navLockup: HTMLElement
  hero: HTMLElement
  heroLockup: HTMLElement
  sub: HTMLElement
  subWords: HTMLElement[]
  demo: HTMLElement
  rail: HTMLElement
  railBox: HTMLElement
  view: HTMLElement
  agents: HTMLElement
  agentRefs: AgentRef[]
  railItems: Record<RailKey, HTMLElement>
  railLabels: Record<RailKey, HTMLElement>
  phrases: Record<RailKey, HTMLElement>
}

function need<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`Landing markup is missing ${selector}`)
  return el
}

const byLp = (root: ParentNode, name: string) => need<HTMLElement>(root, `[data-lp="${name}"]`)

function perRail(root: ParentNode, selector: (k: RailKey) => string): Record<RailKey, HTMLElement> {
  const out = {} as Record<RailKey, HTMLElement>
  for (const k of RAIL_ORDER) out[k] = need<HTMLElement>(root, selector(k))
  return out
}

export function collectEls(root: HTMLElement): LandingEls {
  const sub = byLp(root, 'sub')
  const railItems = perRail(root, (k) => `[data-lp="rail-item"][data-k="${k}"]`)
  return {
    root,
    track: byLp(root, 'track'),
    nav: byLp(root, 'nav'),
    navLockup: byLp(root, 'nav-lockup'),
    hero: byLp(root, 'hero'),
    heroLockup: byLp(root, 'hero-lockup'),
    sub,
    subWords: Array.from(sub.querySelectorAll<HTMLElement>('.w')),
    demo: byLp(root, 'demo'),
    rail: byLp(root, 'rail'),
    railBox: byLp(root, 'rail-box'),
    view: byLp(root, 'view'),
    agents: byLp(root, 'agents'),
    agentRefs: Array.from(root.querySelectorAll<HTMLElement>('[data-lp="agent"]')).map((el) => ({
      el,
      group: el.dataset.g ?? '',
      index: Number(el.dataset.i ?? 0),
      off: [0, 0] as [number, number],
    })),
    railItems,
    railLabels: perRail(root, (k) => `[data-lp="rail-item"][data-k="${k}"] .t`),
    phrases: perRail(root, (k) => `[data-lp="sub"] [data-k="${k}"]`),
  }
}
