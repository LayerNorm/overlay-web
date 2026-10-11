import { SCENES, type SectionKey } from '../landing-scenes'

/**
 * The scroll map. Scroll distance is measured from the top of the landing track.
 * First comes the hero (one viewport, plus a short pause before the hand-off
 * starts), then each scene in turn for `len` viewport heights.
 */
export type Timeline = {
  V: number
  /** Pause before the hero → rail hand-off begins. */
  PRE: number
  /** Scroll position where the hand-off is complete and scene 0 starts. */
  INTRO: number
  /** Scroll position where each scene starts. */
  starts: number[]
  /** Track height: every scene plus the viewport the sticky stage occupies. */
  trackHeight: number
  /** Scroll span of each section: first scene start → next section's first scene start. */
  secRange: Partial<Record<SectionKey, { S: number; E: number }>>
}

const PRE_FRACTION = 0.3

export function buildTimeline(V: number): Timeline {
  const PRE = PRE_FRACTION * V
  const INTRO = V + PRE
  let y = INTRO
  const starts = SCENES.map((scene) => {
    const at = y
    y += scene.len * V
    return at
  })
  const secRange: Timeline['secRange'] = {}
  const order: SectionKey[] = []
  SCENES.forEach((scene, i) => {
    if (secRange[scene.sec]) return
    secRange[scene.sec] = { S: starts[i], E: Infinity }
    order.push(scene.sec)
  })
  order.forEach((sec, i) => {
    const next = order[i + 1]
    const range = secRange[sec]
    if (next && range) range.E = secRange[next]?.S ?? Infinity
  })
  return { V, PRE, INTRO, starts, trackHeight: y + V, secRange }
}

export function sceneAt(timeline: Timeline, y: number): number {
  let idx = 0
  for (let i = 0; i < timeline.starts.length; i++) if (y >= timeline.starts[i]) idx = i
  return idx
}
