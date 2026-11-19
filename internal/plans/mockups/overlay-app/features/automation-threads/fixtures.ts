import { useSyncExternalStore } from 'react'
import { defineQueries, notifyFixtures, queryResolver } from '../../fixtures/convex'
import { NATIVE_AGENT_ERROR_PART } from '@/shared/agents/native-agent-error'

/**
 * Automations as threads. Each automation owns one personal chat: its first user message is the instructions, and every
 * run posts the instructions again and gets a reply. The chat route reads these conversations through the same Convex
 * queries as any chat; sending, running and editing only change this in-memory store.
 */

export type Frequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type Schedule = { frequency: Frequency; time: string; weekday: number; monthDay: number; timezone: string }
export type RunStatus = 'completed' | 'failed' | 'waiting'
export type Scope = 'personal' | 'workspace'
export type Run = { id: string; at: number; status: RunStatus; text: string; manual?: boolean }
export type FollowUp = { id: string; at: number; user: string; reply: string }

export type Automation = {
  id: string
  conversationId: string
  scope: Scope
  name: string
  instructions: string
  schedule: Schedule
  agentId: string | null
  modelId: string
  enabled: boolean
  createdAt: number
  runs: Run[]
  followUps: FollowUp[]
}

export const TIMEZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo']
export const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5'
export const DEFAULT_SCHEDULE: Schedule = { frequency: 'weekdays', time: '09:00', weekday: 1, monthDay: 1, timezone: TIMEZONES[0]! }

export const FREQUENCIES: Array<[Frequency, string]> = [
  ['hourly', 'Every hour'],
  ['daily', 'Every day'],
  ['weekdays', 'Every weekday'],
  ['weekly', 'Every week'],
  ['monthly', 'Every month'],
]
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const timezoneLabel = (timezone: string) => timezone.replace('_', ' ')

function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13
  return n + (teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th')
}

export function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number)
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h < 12 ? 'AM' : 'PM')
}

export function scheduleLabel(schedule: Schedule) {
  const at = formatTime(schedule.time)
  switch (schedule.frequency) {
    case 'hourly': return 'Every hour'
    case 'daily': return 'Every day · ' + at
    case 'weekdays': return 'Every weekday · ' + at
    case 'weekly': return 'Every ' + WEEKDAYS[schedule.weekday] + ' · ' + at
    case 'monthly': return 'Monthly on the ' + ordinal(schedule.monthDay) + ' · ' + at
  }
}

function scheduleSentence(schedule: Schedule) {
  const at = ' at ' + formatTime(schedule.time)
  switch (schedule.frequency) {
    case 'hourly': return 'every hour'
    case 'daily': return 'every day' + at
    case 'weekdays': return 'every weekday' + at
    case 'weekly': return 'every ' + WEEKDAYS[schedule.weekday] + at
    case 'monthly': return 'on the ' + ordinal(schedule.monthDay) + ' of every month' + at
  }
}

function matches(schedule: Schedule, day: Date) {
  const dow = day.getDay()
  if (schedule.frequency === 'weekdays') return dow > 0 && dow < 6
  if (schedule.frequency === 'weekly') return dow === schedule.weekday
  if (schedule.frequency === 'monthly') return day.getDate() === schedule.monthDay
  return true
}

/** Run times strictly after (step 1) or before (step -1) the given time, nearest first. */
function occurrences(schedule: Schedule, from: number, step: 1 | -1, count: number): number[] {
  const [h, m] = schedule.time.split(':').map(Number)
  const out: number[] = []
  const beyond = (at: number) => (step === 1 ? at > from : at < from)
  if (schedule.frequency === 'hourly') {
    const at = new Date(from)
    at.setMinutes(m, 0, 0)
    while (out.length < count) {
      if (beyond(at.getTime())) out.push(at.getTime())
      at.setHours(at.getHours() + step)
    }
    return out
  }
  const day = new Date(from)
  for (let i = 0; i < 400 && out.length < count; i++) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    if (matches(schedule, at) && beyond(at.getTime())) out.push(at.getTime())
    day.setDate(day.getDate() + step)
  }
  return out
}

export const nextRun = (schedule: Schedule) => occurrences(schedule, Date.now(), 1, 1)[0]!

/** "Today 9:00 AM", "Tomorrow 9:00 AM", "Mon 9:00 AM" within a week, otherwise "Dec 1, 9:00 AM". */
export function formatWhen(at: number) {
  const date = new Date(at)
  const time = formatTime(date.getHours() + ':' + date.getMinutes())
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOf(date) - startOf(new Date())) / 86_400_000)
  if (days === 0) return 'Today ' + time
  if (days === 1) return 'Tomorrow ' + time
  if (days === -1) return 'Yesterday ' + time
  if (Math.abs(days) < 7) return WEEKDAYS[date.getDay()]!.slice(0, 3) + ' ' + time
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time
}

export const latestRun = (automation: Automation) => automation.runs.at(-1)

export function nextRunLabel(automation: Automation) {
  if (!automation.enabled) return 'Paused'
  if (latestRun(automation)?.status === 'waiting') return 'after you reply'
  return formatWhen(nextRun(automation.schedule))
}

let seq = 0
const uid = (prefix: string) => prefix + ++seq
const conversationIdFor = (slug: string) => ('k17chatauto' + slug).padEnd(32, '0').slice(0, 32)

function seed(slug: string, scope: Scope, schedule: Schedule, agentId: string | null, instructions: string, runs: Array<Omit<Run, 'id' | 'at'>>, options: { enabled?: boolean; modelId?: string } = {}): Automation {
  const times = occurrences(schedule, Date.now(), -1, runs.length + 1).reverse()
  return {
    id: 'auto_' + slug,
    conversationId: conversationIdFor(slug),
    scope,
    name: instructions.split('\n')[0]!.replace(/[.:]$/, ''),
    instructions,
    schedule,
    agentId,
    modelId: options.modelId ?? DEFAULT_MODEL,
    enabled: options.enabled ?? true,
    createdAt: times[0]! - 26 * 60_000,
    runs: runs.map((run, index) => ({ ...run, id: uid('run'), at: times[index + 1]! })),
    followUps: [],
  }
}

const SEED: Automation[] = [
  seed('launch', 'workspace', DEFAULT_SCHEDULE, 'agent_scout',
    "Send me a daily launch brief.\nCheck #launch in Slack, the open homepage-launch tasks in Work and yesterday's signups. Keep it to five lines: what moved, what's blocked and what needs me today.",
    [
      { status: 'completed', text: '**Moved:** Pricing copy is approved and the hero image is final.\n\n**Blocked:** The pricing table still breaks below 380px wide. Atlas is on it.\n\n**Needs you:** Sign off on the launch email before 2 PM.\n\nSignups yesterday: 184, up 12% on the week before.' },
      { status: 'failed', text: "Slack is disconnected (the token was revoked), so I couldn't read #launch. Reconnect Slack in Extensions, then retry." },
      { status: 'completed', text: '**Moved:** The pricing table fix shipped and the launch email is in review.\n\n**Blocked:** Nothing.\n\n**Needs you:** Nothing today.\n\nSignups yesterday: 171.' },
      { status: 'waiting', text: "Priya moved the launch to **December 4** in #launch, but the Work task still says December 2. Should I change the task's date, or keep December 2 and flag the mismatch in the brief?" },
    ]),
  seed('competitors', 'workspace', { ...DEFAULT_SCHEDULE, frequency: 'weekly', weekday: 4, time: '10:00' }, null,
    'Check competitor pricing pages for changes.\nCompare the pricing pages of Acme, Brightline and Corvid with last week and tell me what changed.',
    [
      { status: 'completed', text: 'No price changes this week. Brightline added an FAQ entry about annual billing.' },
      { status: 'failed', text: 'brightline.com/pricing timed out after 3 tries.' },
    ], { modelId: 'openai/gpt-6.1-sol' }),
  seed('pullrequests', 'workspace', { ...DEFAULT_SCHEDULE, time: '17:00' }, 'agent_atlas',
    'Summarize the pull requests merged today.\nGroup them by area and call out anything that touches billing.',
    [
      { status: 'completed', text: 'Four pull requests merged: two in checkout, one in onboarding and a docs fix. Nothing touches billing.' },
      { status: 'completed', text: 'Three pull requests merged, all on the homepage. Nothing touches billing.' },
    ], { modelId: 'anthropic/claude-opus-5.5' }),
  seed('invoices', 'workspace', { ...DEFAULT_SCHEDULE, frequency: 'monthly', monthDay: 1 }, 'agent_ledger',
    "Draft reminders for overdue invoices.\nAnything more than 14 days overdue gets a polite reminder in Gmail drafts. Don't send them.",
    [{ status: 'completed', text: "Drafted 3 reminders in Gmail for Blue Harbor, Acme Logistics and Corvid. They're in your drafts." }], { enabled: false }),
  seed('inbox', 'personal', { ...DEFAULT_SCHEDULE, frequency: 'daily', time: '07:30' }, null,
    'Triage my inbox every morning.\nSort overnight email into reply, delegate and archive, and draft replies for anything that only needs a line.',
    [{ status: 'completed', text: '12 new emails: 3 to reply to (drafts are ready), 2 to delegate to Sam and 7 archived.' }]),
]

let automations: Automation[] = SEED
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function emit() {
  listeners.forEach((listener) => listener())
  notifyFixtures()
}

export const useAutomations = () => useSyncExternalStore(subscribe, () => automations)
export const automationForConversation = (conversationId: string | null | undefined) => automations.find((automation) => automation.conversationId === conversationId)

export function updateAutomation(id: string, change: (automation: Automation) => Automation) {
  automations = automations.map((automation) => (automation.id === id ? change(automation) : automation))
  emit()
}

export function deleteAutomation(id: string) {
  automations = automations.filter((automation) => automation.id !== id)
  emit()
}

export function createAutomation(input: { scope: Scope; schedule: Schedule; agentId: string | null; modelId: string; instructions: string }): Automation {
  const slug = 'new' + Date.now().toString(36)
  const created: Automation = {
    id: 'auto_' + slug, conversationId: conversationIdFor(slug), scope: input.scope,
    name: input.instructions.split('\n')[0]!.trim().replace(/[.:]$/, '').slice(0, 80), instructions: input.instructions,
    schedule: input.schedule, agentId: input.agentId, modelId: input.modelId, enabled: true, createdAt: Date.now(), runs: [], followUps: [],
  }
  automations = [created, ...automations]
  emit()
  return created
}

export function runNow(id: string) {
  updateAutomation(id, (automation) => ({ ...automation, runs: [...automation.runs, { id: uid('run'), at: Date.now(), status: 'completed', manual: true, text: 'Ran now. Same picture as the last run; nothing new needs you.' }] }))
}

export function retryRun(id: string, runId: string) {
  updateAutomation(id, (automation) => ({
    ...automation,
    runs: automation.runs.map((run) => (run.id === runId ? { ...run, status: 'completed', text: 'Retried and finished. Everything loaded this time; the summary is the same as the run before.' } : run)),
  }))
}

/** A follow-up in the thread. Answering a waiting run finishes it and lets the schedule continue. */
export function sendFollowUp(id: string, text: string) {
  updateAutomation(id, (automation) => {
    const waiting = latestRun(automation)?.status === 'waiting'
    const reply = waiting
      ? 'Changed the launch task to **December 4** and finished the brief.\n\n**Moved:** The launch email is approved.\n\n**Blocked:** Nothing.\n\n**Needs you:** Nothing today.'
      : "Noted. I'll follow that from the next run on."
    return {
      ...automation,
      runs: waiting ? automation.runs.map((run, index) => (index === automation.runs.length - 1 ? { ...run, status: 'completed' } : run)) : automation.runs,
      followUps: [...automation.followUps, { id: uid('follow'), at: Date.now(), user: text, reply }],
    }
  })
}

// The automation's chat, in the shape the personal chat queries return.

const USER = 'user_mercedes'

function message(conversationId: string, turnId: string, role: 'user' | 'assistant', content: string, at: number, modelId: string, extra: Record<string, unknown> = {}) {
  return {
    _id: conversationId + '_' + role + '_' + turnId, _creationTime: at, conversationId, userId: USER, turnId, role, mode: 'ask', content,
    contentType: 'text', createdAt: at, updatedAt: at, status: 'completed',
    ...(role === 'assistant' ? { modelId, variantIndex: 0, parts: [{ type: 'text', text: content }] } : {}),
    ...extra,
  }
}

function transcript(automation: Automation) {
  const { conversationId: id, modelId } = automation
  const rows = [
    message(id, 'created', 'user', automation.instructions, automation.createdAt, modelId),
    message(id, 'created', 'assistant', 'Scheduled ' + scheduleSentence(automation.schedule) + ', ' + timezoneLabel(automation.schedule.timezone).split('/').pop() + ' time. Each run will show up in this chat.', automation.createdAt + 4000, modelId),
  ]
  const turns = [
    ...automation.runs.map((run) => ({ at: run.at, user: automation.instructions, run })),
    ...automation.followUps.map((followUp) => ({ at: followUp.at, user: followUp.user, followUp })),
  ].sort((a, b) => a.at - b.at)
  for (const turn of turns) {
    const turnId = 'run' in turn ? turn.run!.id : turn.followUp!.id
    rows.push(message(id, turnId, 'user', turn.user, turn.at, modelId))
    if ('run' in turn && turn.run!.status === 'failed') {
      rows.push(message(id, turnId, 'assistant', '', turn.at + 20_000, modelId, {
        status: 'error',
        parts: [{ type: NATIVE_AGENT_ERROR_PART, data: { runId: turnId, code: 'tool_failed', message: turn.run!.text, retryable: true, failedAt: turn.at + 20_000 } }],
      }))
    } else {
      rows.push(message(id, turnId, 'assistant', 'run' in turn ? turn.run!.text : turn.followUp!.reply, turn.at + 20_000, modelId))
    }
  }
  return rows
}

function summary(automation: Automation, workspaceId: string) {
  const last = Math.max(automation.createdAt, ...automation.runs.map((run) => run.at), ...automation.followUps.map((followUp) => followUp.at))
  return {
    _id: automation.conversationId, workspaceId, title: automation.name, lastModified: last, createdAt: automation.createdAt,
    askModelIds: [automation.modelId], actModelId: automation.modelId, lastMode: 'ask', conversationType: 'personal',
    scope: automation.scope, kind: automation.scope, lastMessageAt: last, unread: false,
  }
}

/** Answers the personal chat queries for automation chats and leaves every other chat to the shared fixtures. */
export function installAutomationFixtures() {
  const getSummary = queryResolver('chat/personal:getSummary')
  const getMessages = queryResolver('chat/personal:getMessages')
  const getExecution = queryResolver('chat/personal:getExecution')
  defineQueries({
    'chat/personal:getSummary': (args: Record<string, unknown>) => {
      const automation = automationForConversation(String(args.conversationId))
      return automation ? summary(automation, String(args.workspaceId)) : getSummary?.(args)
    },
    'chat/personal:getMessages': (args: Record<string, unknown>) => {
      const automation = automationForConversation(String(args.conversationId))
      if (!automation) return getMessages?.(args)
      return { page: transcript(automation).reverse().map((row) => ({ message: row, contextUser: null, outputs: [] })), isDone: true, continueCursor: '' }
    },
    'chat/personal:getExecution': (args: Record<string, unknown>) => getExecution?.(args),
  })
}
