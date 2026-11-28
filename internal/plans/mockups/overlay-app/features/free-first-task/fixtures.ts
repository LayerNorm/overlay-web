import {
  ONBOARDING_INTRO,
  extractOnboardingName,
  onboardingTasksFor,
  preparedOnboardingReply,
  type OnboardingAction,
  type OnboardingSession,
} from '@/shared/onboarding/session'
import { defineQueries, notifyFixtures, resolveMutation, resolveQuery } from '../../fixtures/convex'
import { route } from '../../fixtures/fetch'
import { AGENTS, VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { NOW, ROOMS, agentRoom, message, text, tool, type Room } from '../../fixtures/rooms'

export const ONBOARDING_ROOM = 'k17convwelcome000000000000000000'
const AGENT = 'p_overlay'

export type FollowUpStage = 'running' | 'offer' | 'subscribed' | 'declined' | 'done'
export const followUp: { stage: FollowUpStage | null } = { stage: null }

let session: OnboardingSession | null = null
let completed = false
const createdTaskIds: string[] = []

const room = () => ROOMS.find((entry) => entry.id === ONBOARDING_ROOM) as Room
const now = () => NOW - Date.now()

function post(author: string, content: string, parts?: Parameters<typeof message>[4], extra?: Parameters<typeof message>[5]) {
  const entry = message(ONBOARDING_ROOM, author, now(), content, parts, extra)
  room().messages.push(entry)
  room().lastModified = entry.createdAt
  return entry
}

export function overlaySays(content: string) {
  post(AGENT, content)
  notifyFixtures()
}

export function personSays(content: string) {
  post(VIEWER_PRINCIPAL, content)
  notifyFixtures()
}

const RESULTS: Record<string, { tools: ReturnType<typeof tool>[]; reply: string }> = {
  'Research my top three competitors and write a one-page brief': {
    tools: [
      tool('r1', 'web_search', { query: 'Northwind competitors workspace software 2026' }, { results: [] }),
      tool('r2', 'web_search', { query: 'Linear Notion Asana pricing and positioning' }, { results: [] }),
      tool('r3', 'computer_write_file', { path: 'briefs/competitors.md', contents: '# Competitors' }, { success: true, created: true, linesAdded: 64, linesRemoved: 0 }),
    ],
    reply: `Here's your one-page brief. The full version, with sources, is in Files as **Competitor brief**.

| | Asana | Notion | Linear |
| --- | --- | --- | --- |
| Best at | Cross-team projects | Docs and wikis | Fast issue tracking |
| Price (per seat) | $13.49 | $12 | $10 |
| Weak spot | Heavy setup | Weak task tracking | Engineering only |

**Where Northwind wins:** one place for docs *and* work, with AI employees that act instead of only suggesting. **Where you're exposed:** Notion's AI ships fast and is bundled into the plan people already pay for.

**Next step I'd take:** a pricing page section that compares cost per finished task, not per seat.`,
  },
  'Make a prioritized plan for my week': {
    tools: [tool('w1', 'list_work', { scope: 'personal' }, { items: 0 })],
    reply: `Here's a plan for your week, most important first.

1. **Monday:** decide the one outcome that makes this week a success, and block two hours for it.
2. **Tuesday–Wednesday:** do that work first thing each day; batch email and messages after lunch.
3. **Thursday:** follow-ups and anything waiting on other people.
4. **Friday:** review what moved, and write down next week's outcome.

Tell me what's on your plate and I'll fill this in with real tasks and dates.`,
  },
}

function resultFor(title: string) {
  return RESULTS[title] ?? {
    tools: [tool('g1', 'web_search', { query: title }, { results: [] })],
    reply: `Here's a first pass at **${title.replace(/[.!]$/, '')}**.

1. **What I found:** the three points that matter most, each with a source.
2. **What I'd do next:** one concrete step you can take today.
3. **Open questions:** what I need from you to finish it properly.

Reply here with changes and I'll revise it.`,
  }
}

function runFirstTask(title: string) {
  followUp.stage = 'running'
  const { tools, reply } = resultFor(title)
  window.setTimeout(() => {
    room().activity = 'working'
    const working = post(AGENT, '', [tools[0]!], { status: 'generating' })
    notifyFixtures()
    tools.slice(1).forEach((part, index) => window.setTimeout(() => {
      working.parts = [...(working.parts ?? []), part]
      notifyFixtures()
    }, 1400 * (index + 1)))
    window.setTimeout(() => {
      Object.assign(working, { content: reply, parts: [...tools, text(reply)], status: 'complete', updatedAt: Date.now() })
      room().activity = 'ready'
      notifyFixtures()
      window.setTimeout(() => {
        followUp.stage = 'offer'
        overlaySays("That one was on us. To keep me working, subscribe to Overlay. Your task and this chat stay saved either way.")
      }, 900)
    }, 1400 * tools.length + 1200)
  }, 700)
}

/** The nonce the conversation shows optimistically, so the posted answer replaces it. */
const said = (current: OnboardingSession, value: string) => post(VIEWER_PRINCIPAL, value, undefined, { clientNonce: `onboarding:user_mercedes:${current.runId}:${current.revision + 1}:user` } as Parameters<typeof message>[5])

function respond(next: OnboardingSession | null, done = false) {
  if (next) session = next
  completed = done
  return { completed, session }
}

function act(action: OnboardingAction) {
  if (action.action === 'start') {
    if (session) return respond(session)
    const reply = preparedOnboardingReply('name', { name: '', about: '', daily: '' })
    post(AGENT, `${ONBOARDING_INTRO}\n\n${reply.message}`)
    notifyFixtures()
    return respond({
      version: 1, flowVersion: 3, member: false, runId: '00000000-0000-4000-8000-000000000001', revision: 1,
      workspaceId: 'ws_northwind', conversationId: ONBOARDING_ROOM, agentId: 'agent_overlay', agentPrincipalId: AGENT,
      step: 'name', profile: { name: '', about: '', daily: '' }, aiEnabled: false, reply, employees: [], suggestions: [], createdAgentIds: [],
    })
  }
  const current = session!
  const revision = current.revision + 1
  if (action.action === 'answer' && current.step === 'name') {
    const profile = { ...current.profile, name: extractOnboardingName(action.value) }
    const reply = { message: `Nice to meet you, ${profile.name.split(' ')[0]}.\n\nWhat would you like help with? Pick as many as you like.`, mode: 'prepared' as const }
    said(current, action.value)
    post(AGENT, reply.message)
    notifyFixtures()
    return respond({ ...current, revision, step: 'daily', profile, reply })
  }
  if (action.action === 'answer' && current.step === 'daily') {
    const profile = { ...current.profile, daily: action.value }
    const suggestions = onboardingTasksFor(profile)
    const reply = { message: "Let's try one now. Pick a task or describe your own, and I'll start on it. Your first task is free.", mode: 'prepared' as const, suggestions }
    said(current, action.value)
    post(AGENT, reply.message)
    notifyFixtures()
    return respond({ ...current, revision, step: 'task', profile, reply, suggestions })
  }
  if (action.action === 'draft_task') {
    const reply = { ...current.reply, message: "Here's your first task. It's on us, so you don't need a card to start." }
    said(current, action.value)
    post(AGENT, reply.message)
    notifyFixtures()
    return respond({ ...current, revision, taskDraft: action.value, reply })
  }
  if (action.action === 'save_task') return respond({ ...current, revision, taskId: action.taskId })
  if (action.action === 'finish') {
    const reply = { ...current.reply, message: 'Starting now. The result will appear right here, and the task is in Work too.' }
    post(AGENT, reply.message)
    notifyFixtures()
    runFirstTask(current.taskDraft ?? 'Your first task')
    return respond({ ...current, revision, step: 'complete', reply, taskId: action.taskId }, true)
  }
  return respond(current)
}

/** `?at=result` opens straight after the first result, at the subscription question. */
function prefillResult() {
  const title = 'Research my top three competitors and write a one-page brief'
  const { tools, reply } = resultFor(title)
  post(AGENT, `${ONBOARDING_INTRO}\n\nWhat should I call you?`)
  post(VIEWER_PRINCIPAL, 'Mercedes')
  post(AGENT, 'Nice to meet you, Mercedes.\n\nWhat would you like help with? Pick as many as you like.')
  post(VIEWER_PRINCIPAL, 'Research & summaries, Planning & coordination')
  post(AGENT, "Let's try one now. Pick a task or describe your own, and I'll start on it. Your first task is free.")
  post(VIEWER_PRINCIPAL, title)
  post(AGENT, "Here's your first task. It's on us, so you don't need a card to start.")
  post(AGENT, 'Starting now. The result will appear right here, and the task is in Work too.')
  post(AGENT, reply, [...tools, text(reply)])
  post(AGENT, "That one was on us. To keep me working, subscribe to Overlay. Your task and this chat stay saved either way.")
  followUp.stage = 'offer'
  completed = true
  void resolveMutation('work/browse:create', { title, description: title, scope: 'workspace', status: 'done', assigneePrincipalId: AGENT })
    .then((item) => { createdTaskIds.push((item as { id: string }).id); notifyFixtures() })
}

/** A new workspace: only the Overlay chiefs, no threads or tasks yet, and the onboarding API faked in the page. */
export function installFreeFirstTaskFixtures() {
  AGENTS.splice(2)
  ROOMS.splice(0)
  ROOMS.push(agentRoom(ONBOARDING_ROOM, 'agent_overlay', 'Getting started', 0, 'idle', () => []))
  const list = (view?: string) => createdTaskIds
    .map((id) => resolveQuery('work/browse:get', { id }) as Record<string, unknown> | null)
    .filter((item): item is Record<string, unknown> => Boolean(item) && (!view || item!.scope === view))
  defineQueries({ 'work/browse:list': ({ view }: { view?: string }) => (view === 'archived' ? [] : list(view)) })
  if (new URLSearchParams(globalThis.location.search).get('at') === 'result') prefillResult()

  route('GET', /^\/api\/v1\/onboarding\/session$/, () => ({ completed, session }))
  route('POST', /^\/api\/v1\/onboarding\/session$/, ({ body }) => act(body as OnboardingAction))
  route('POST', /^\/api\/v1\/onboarding\/complete$/, () => { completed = true; return {} })
  route('POST', /^\/api\/v1\/work$/, async ({ body }) => {
    const item = await resolveMutation('work/browse:create', { ...(body as Record<string, unknown>), scope: 'workspace' }) as { id: string }
    createdTaskIds.push(item.id)
    return { item }
  })
  route('PATCH', /^\/api\/v1\/work\/[^/]+$/, async ({ path, body }) => {
    const id = decodeURIComponent(path.split('/').pop()!)
    const patch = body as Record<string, unknown>
    const item = await resolveMutation('work/browse:update', { id, ...patch, ...(patch.assigneePrincipalId ? { status: 'progress' } : {}) })
    return { item }
  })
}
