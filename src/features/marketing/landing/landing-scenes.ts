/**
 * The landing page is one scroll story made of scenes. A scene is a stretch of
 * scrolling (`len` is in viewport heights) that shows one title, one graphic and
 * one highlighted sidebar item. Scenes are grouped into sections, and the five
 * underlined phrases of the hero sentence are the sections.
 */

export type SectionKey = 'ai' | 'cp' | 'cloud' | 'multi' | 'oss' | 'start'
export type RailKey = Exclude<SectionKey, 'start'>

/** Rail order is the reverse of the sentence: AI employees first. */
export const RAIL_ORDER: RailKey[] = ['ai', 'cp', 'cloud', 'multi', 'oss']

/** Lowercase because the labels start life inside the hero sentence. */
export const RAIL_LABEL: Record<RailKey, string> = {
  ai: 'AI employees',
  cp: 'control plane',
  cloud: 'cloud',
  multi: 'multiplayer',
  oss: 'open source',
}

/** Sidebar items per section. A tuple is [short label, label while active]. */
export type SideItem = string | readonly [short: string, long: string]
export const SIDE: Partial<Record<SectionKey, SideItem[]>> = {
  ai: ['Memory', 'Tools', 'Computer'],
  cp: ['Create', 'Manage', 'Deploy', ['BYOA', 'Bring your own agents']],
}

export type Scene = {
  sec: SectionKey
  /** Fixed start of the title. */
  pre: string
  /** The part of the title that rolls when the scene changes ("" = none). */
  piece: string
  /** Which sidebar item is active; 'all' lights every item. */
  item: number | 'all'
  len: number
}

const AI = 'AI agents with '
const CP = 'One place to get things done'

export const SCENES: Scene[] = [
  { sec: 'ai', pre: AI, piece: 'superpowers', item: -1, len: 0.8 },
  { sec: 'ai', pre: AI, piece: 'memory remember everything', item: 0, len: 0.9 },
  { sec: 'ai', pre: AI, piece: 'tools work where you work', item: 1, len: 0.9 },
  { sec: 'ai', pre: AI, piece: 'a computer can do anything', item: 2, len: 0.9 },
  { sec: 'ai', pre: AI, piece: 'superpowers are AI employees', item: 'all', len: 1.0 },

  { sec: 'cp', pre: CP, piece: '', item: 0, len: 0.9 },
  { sec: 'cp', pre: CP, piece: '', item: 1, len: 0.9 },
  { sec: 'cp', pre: CP, piece: '', item: 2, len: 0.9 },
  { sec: 'cp', pre: CP, piece: '', item: 3, len: 0.9 },

  { sec: 'cloud', pre: 'Accessible from anywhere, literally', piece: '', item: -1, len: 1.3 },
  { sec: 'multi', pre: 'Better, together', piece: '', item: -1, len: 1.3 },
  { sec: 'oss', pre: 'Oh, and we care about your sovereignty', piece: '', item: -1, len: 1.3 },

  { sec: 'start', pre: 'Hire your first AI employee', piece: '', item: -1, len: 0.9 },
]

export const firstSceneOf = (sec: SectionKey): number =>
  SCENES.findIndex((s) => s.sec === sec)

export const sceneOfItem = (sec: SectionKey, item: number): number =>
  SCENES.findIndex((s) => s.sec === sec && s.item === item)

/** Footer deep links (`/home#agents` …) map onto scenes. */
export const HASH_SCENES: Record<string, number> = {
  agents: 0,
  platforms: 5,
  computers: 3,
  automations: 7,
}
