import type { CreatureShape } from '@/components/orb/Creature'
import { AGENT_SEED } from './demo-data-agents'
import { AUTO_REPLIES, AUTO_SEED, CHAT_SEED, EXT_SEED, REPLIES } from './demo-data-chats'
import {
  A,
  type Agent,
  type Auto,
  type Chat,
  type Ext,
  type ExtFilter,
  type Msg,
  type Persona,
  type Scope,
  type View,
} from './demo-types'

/** State for the hero demo: a small working copy of the Overlay app. */

export type DemoState = {
  view: View
  scope: Scope
  agent: string
  thread: 'main' | 'new'
  chat: number
  file: number
  extf: ExtFilter
  auto: number
  ascope: Scope
  model: string
  menu: boolean
  /** Conversation key an agent is currently "typing" in. */
  typing: string | null
  agents: Record<string, Agent>
  personal: string[]
  workspace: string[]
  chats: Chat[]
  autos: Auto[]
  exts: Ext[]
  /** How many things the visitor created, to keep ids and colors unique. */
  created: number
}

export const MODELS = ['GPT 5.6 Luna', 'Claude Fable 5.1', 'Claude Opus 5.5', 'Claude Sonnet 5.5', 'Gemini 3 Pro']

const NEW_AGENT_LOOKS: Array<[CreatureShape, string]> = [
  ['blob', '#db2777'], ['squircle', '#ea580c'], ['droplet', '#2563eb'],
  ['cloud', '#7c3aed'], ['pill', '#f59e0b'], ['hexagon', '#16a34a'],
]

const newThread = (): Msg[] => [A('Now', 'What would you like to work on in this thread?')]

export function createInitialState(): DemoState {
  const agents: Record<string, Agent> = {}
  for (const [key, seed] of Object.entries(AGENT_SEED)) {
    agents[key] = { name: seed.name, shape: seed.shape, color: seed.color, threads: { main: seed.main, new: newThread() } }
  }
  return {
    view: 'agents', scope: 'personal', agent: 'claude', thread: 'main', chat: 0, file: 0, extf: 'all', auto: 0, ascope: 'personal',
    model: MODELS[0], menu: false, typing: null, agents,
    personal: ['claude', 'codex', 'pr', 'product', 'overlay', 'fund'], workspace: ['support', 'sales', 'docs'],
    chats: CHAT_SEED.map((c, i) => ({ ...c, id: `c${i}` })),
    autos: AUTO_SEED.map((a, i) => ({ ...a, id: `u${i}` })),
    exts: EXT_SEED, created: 0,
  }
}

/* ---------- the conversation currently on screen ---------- */

export type Conversation = {
  key: string
  who: Persona
  /** Plain style (no avatar / name), like the app's chats and automations. */
  plain: boolean
  msgs: Msg[]
  placeholder: string
  replies: string[]
}

const OVERLAY: Persona = { name: 'Overlay', shape: 'circle', color: '#64748b' }

export function selectConversation(s: DemoState): Conversation {
  if (s.view === 'chats') {
    const c = s.chats[s.chat]
    return { key: c.id, who: OVERLAY, plain: true, msgs: c.msgs, placeholder: 'Ask Overlay anything…', replies: REPLIES }
  }
  if (s.view === 'automations') {
    const a = s.autos[s.auto]
    return { key: a.id, who: OVERLAY, plain: true, msgs: a.msgs, placeholder: 'Describe an automation, use @ to reference available context…', replies: AUTO_REPLIES }
  }
  const agent = s.agents[s.agent]
  return {
    key: `a:${s.agent}:${s.thread}`, who: agent, plain: false, msgs: agent.threads[s.thread],
    placeholder: `Message ${agent.name}, use @ to notify someone…`, replies: REPLIES,
  }
}

/** Append a message to the conversation with this key, wherever it lives. */
function appendMsg(s: DemoState, key: string, msg: Msg): DemoState {
  if (key.startsWith('a:')) {
    const [, agentKey, thread] = key.split(':')
    const agent = s.agents[agentKey]
    const t = thread as 'main' | 'new'
    const next = { ...agent, threads: { ...agent.threads, [t]: [...agent.threads[t], msg] } }
    return { ...s, agents: { ...s.agents, [agentKey]: next } }
  }
  if (key.startsWith('c')) return { ...s, chats: s.chats.map((c) => (c.id === key ? { ...c, msgs: [...c.msgs, msg] } : c)) }
  return { ...s, autos: s.autos.map((a) => (a.id === key ? { ...a, msgs: [...a.msgs, msg] } : a)) }
}

/* ---------- actions ---------- */

export type DemoAction =
  | { type: 'nav'; view: View }
  | { type: 'scope'; scope: Scope }
  | { type: 'agent'; key: string }
  | { type: 'thread'; thread: 'main' | 'new' }
  | { type: 'newagent' }
  | { type: 'chat'; i: number }
  | { type: 'newchat' }
  | { type: 'file'; i: number }
  | { type: 'extf'; f: ExtFilter }
  | { type: 'ext'; i: number }
  | { type: 'auto'; i: number }
  | { type: 'ascope'; scope: Scope }
  | { type: 'newauto' }
  | { type: 'menu' }
  | { type: 'model'; name: string }
  | { type: 'send'; key: string; text: string; time: string }
  | { type: 'reply'; key: string; text: string; time: string }

type Handlers = { [K in DemoAction['type']]: (s: DemoState, a: Extract<DemoAction, { type: K }>) => DemoState }

const HANDLERS: Handlers = {
  nav: (s, a) => ({ ...s, view: a.view }),
  scope: (s, a) => ({ ...s, scope: a.scope, agent: (a.scope === 'personal' ? s.personal : s.workspace)[0], thread: 'main' }),
  agent: (s, a) => ({ ...s, agent: a.key, thread: 'main' }),
  thread: (s, a) => ({ ...s, thread: a.thread }),
  newagent: (s) => {
    const [shape, color] = NEW_AGENT_LOOKS[s.created % NEW_AGENT_LOOKS.length]
    const key = `new${s.created}`
    const hello = [A('Now', 'I am ready to work. Give me a name and a first task, for example: triage new support tickets every morning.')]
    const agent: Agent = { name: 'New agent', shape, color, threads: { main: hello, new: newThread() } }
    return { ...s, agents: { ...s.agents, [key]: agent }, personal: [key, ...s.personal], scope: 'personal', agent: key, thread: 'main', created: s.created + 1 }
  },
  chat: (s, a) => ({ ...s, chat: a.i }),
  newchat: (s) => ({
    ...s, chats: [{ id: `cn${s.created}`, title: 'New chat', msgs: [A('', 'What would you like to work on?')] }, ...s.chats], chat: 0, created: s.created + 1,
  }),
  file: (s, a) => ({ ...s, file: a.i }),
  extf: (s, a) => ({ ...s, extf: a.f }),
  ext: (s, a) => ({ ...s, exts: s.exts.map((e, i) => (i === a.i ? { ...e, on: !e.on } : e)) }),
  auto: (s, a) => ({ ...s, auto: a.i }),
  ascope: (s, a) => ({ ...s, ascope: a.scope, auto: Math.max(0, s.autos.findIndex((x) => x.scope === a.scope)) }),
  newauto: (s) => {
    const hello = 'Describe what you want to automate and when. For example: “Every Monday at 9, summarize last week’s merged PRs and post them to #eng.”'
    const auto: Auto = { id: `un${s.created}`, n: 'New automation', title: 'New Automation', scope: s.ascope, msgs: [A('', hello)] }
    return { ...s, autos: [auto, ...s.autos], auto: 0, created: s.created + 1 }
  },
  menu: (s) => ({ ...s, menu: !s.menu }),
  model: (s, a) => ({ ...s, model: a.name, menu: false }),
  send: (s, a) => ({ ...appendMsg(s, a.key, { who: 'you', t: a.time, text: a.text }), typing: a.key }),
  reply: (s, a) => {
    const next = appendMsg(s, a.key, A(a.time, a.text))
    return { ...next, typing: s.typing === a.key ? null : s.typing }
  },
}

/** Anything that is not the model menu closes it. */
const KEEPS_MENU: ReadonlySet<DemoAction['type']> = new Set(['menu', 'send', 'reply'])

export function demoReducer(s: DemoState, a: DemoAction): DemoState {
  const handler = HANDLERS[a.type] as (s: DemoState, a: DemoAction) => DemoState
  const next = handler(s, a)
  return KEEPS_MENU.has(a.type) || !next.menu ? next : { ...next, menu: false }
}
