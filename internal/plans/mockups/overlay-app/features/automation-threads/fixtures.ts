import { useSyncExternalStore } from 'react'

/**
 * Automations as threads: the instructions are the first message, and each scheduled run is a user message followed
 * by the reply. Everything lives in memory; sending, editing, pausing and running only change this store.
 */

export type Frequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type Schedule = { frequency: Frequency; time: string; weekday: number; monthDay: number; timezone: string }
export type RunStatus = 'ok' | 'failed' | 'waiting'
export type Scope = 'personal' | 'workspace'

export type Entry =
  | { id: string; kind: 'instructions'; text: string }
  | { id: string; kind: 'run'; at: number; manual?: boolean }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'reply'; text: string }
  | { id: string; kind: 'question'; text: string }
  | { id: string; kind: 'failed'; error: string }

export type Automation = {
  id: string
  scope: Scope
  schedule: Schedule
  agentId: string | null
  paused: boolean
  status: RunStatus | null
  entries: Entry[]
}

export const TIMEZONE = 'America/Los_Angeles'
export const DEFAULT_SCHEDULE: Schedule = { frequency: 'weekdays', time: '09:00', weekday: 1, monthDay: 1, timezone: TIMEZONE }

export const FREQUENCIES: Array<[Frequency, string]> = [
  ['hourly', 'Every hour'],
  ['daily', 'Every day'],
  ['weekdays', 'Every weekday'],
  ['weekly', 'Every week'],
  ['monthly', 'Every month'],
]
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

/** The schedule in a sentence, for the confirmation reply. */
export function scheduleSentence(schedule: Schedule) {
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
  const after = (at: number) => (step === 1 ? at > from : at < from)
  if (schedule.frequency === 'hourly') {
    const at = new Date(from)
    at.setMinutes(m, 0, 0)
    while (out.length < count) {
      if (after(at.getTime())) out.push(at.getTime())
      at.setHours(at.getHours() + step)
    }
    return out
  }
  const day = new Date(from)
  for (let i = 0; i < 400 && out.length < count; i++) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m)
    if (matches(schedule, at) && after(at.getTime())) out.push(at.getTime())
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

export function automationName(automation: Automation) {
  const instructions = automation.entries.find((entry) => entry.kind === 'instructions')
  const first = instructions?.kind === 'instructions' ? instructions.text.split('\n')[0]!.trim() : ''
  return first.replace(/[.:]$/, '') || 'Untitled automation'
}

let seq = 0
const uid = () => 'e' + ++seq
const reply = (text: string): Entry => ({ id: uid(), kind: 'reply', text })

function build(id: string, scope: Scope, schedule: Schedule, agentId: string | null, instructions: string, runs: Array<Entry>, options: { paused?: boolean; status?: RunStatus } = {}): Automation {
  const times = occurrences(schedule, Date.now(), -1, runs.length).reverse()
  const entries: Entry[] = [
    { id: uid(), kind: 'instructions', text: instructions },
    reply('Scheduled ' + scheduleSentence(schedule) + ', Pacific time. Each run will show up in this thread.'),
  ]
  runs.forEach((outcome, index) => entries.push({ id: uid(), kind: 'run', at: times[index]! }, outcome))
  return { id, scope, schedule, agentId, paused: Boolean(options.paused), status: options.status ?? (runs.length ? 'ok' : null), entries }
}

const SEED: Automation[] = [
  build('auto_launch_brief', 'workspace', DEFAULT_SCHEDULE, 'agent_scout',
    "Send me a daily launch brief.\nCheck #launch in Slack, the open homepage-launch tasks in Work and yesterday's signups. Keep it to five lines: what moved, what's blocked and what needs me today.",
    [
      reply('**Moved:** Pricing copy is approved and the hero image is final.\n\n**Blocked:** The pricing table still breaks below 380px wide. Atlas is on it.\n\n**Needs you:** Sign off on the launch email before 2 PM.\n\nSignups yesterday: 184, up 12% on the week before.'),
      { id: uid(), kind: 'failed', error: "Slack is disconnected (the token was revoked), so I couldn't read #launch." },
      reply('**Moved:** The pricing table fix shipped and the launch email is in review.\n\n**Blocked:** Nothing.\n\n**Needs you:** Nothing today.\n\nSignups yesterday: 171.'),
      { id: uid(), kind: 'question', text: "Priya moved the launch to **December 4** in #launch, but the Work task still says December 2. Should I change the task's date, or keep December 2 and flag the mismatch in the brief?" },
    ], { status: 'waiting' }),
  build('auto_competitors', 'workspace', { ...DEFAULT_SCHEDULE, frequency: 'weekly', weekday: 4, time: '10:00' }, null,
    'Check competitor pricing pages for changes.\nCompare the pricing pages of Acme, Brightline and Corvid with last week and tell me what changed.',
    [
      reply('No price changes this week. Brightline added an FAQ entry about annual billing.'),
      { id: uid(), kind: 'failed', error: 'brightline.com/pricing timed out after 3 tries.' },
    ], { status: 'failed' }),
  build('auto_pull_requests', 'workspace', { ...DEFAULT_SCHEDULE, time: '17:00' }, 'agent_atlas',
    'Summarize the pull requests merged today.\nGroup them by area and call out anything that touches billing.',
    [
      reply('Four pull requests merged: two in checkout, one in onboarding and a docs fix. Nothing touches billing.'),
      reply('Three pull requests merged, all on the homepage. Nothing touches billing.'),
    ]),
  build('auto_invoices', 'workspace', { ...DEFAULT_SCHEDULE, frequency: 'monthly', monthDay: 1 }, 'agent_ledger',
    "Draft reminders for overdue invoices.\nAnything more than 14 days overdue gets a polite reminder in Gmail drafts. Don't send them.",
    [reply("Drafted 3 reminders in Gmail for Blue Harbor, Acme Logistics and Corvid. They're in your drafts.")], { paused: true }),
  build('auto_inbox', 'personal', { ...DEFAULT_SCHEDULE, frequency: 'daily', time: '07:30' }, null,
    'Triage my inbox every morning.\nSort overnight email into reply, delegate and archive, and draft replies for anything that only needs a line.',
    [reply('12 new emails: 3 to reply to (drafts are ready), 2 to delegate to Sam and 7 archived.')]),
]

/** ?empty=1 opens the page with nothing scheduled, to see the empty state. */
let automations: Automation[] = new URLSearchParams(globalThis.location?.search ?? '').get('empty') === '1' ? [] : SEED
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export const useAutomations = () => useSyncExternalStore(subscribe, () => automations)

export function updateAutomation(id: string, change: (automation: Automation) => Automation) {
  automations = automations.map((automation) => (automation.id === id ? change(automation) : automation))
  listeners.forEach((listener) => listener())
}

export function createAutomation(input: { scope: Scope; schedule: Schedule; agentId: string | null; instructions: string }): string {
  const created = build('auto_new' + Date.now(), input.scope, input.schedule, input.agentId, input.instructions, [])
  created.entries[1] = reply('Scheduled ' + scheduleSentence(input.schedule) + ', Pacific time. First run: ' + formatWhen(nextRun(input.schedule)) + '.')
  automations = [created, ...automations]
  listeners.forEach((listener) => listener())
  return created.id
}

export type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, 'id'> : never) : never

export function appendEntries(id: string, entries: NewEntry[], patch: Partial<Automation> = {}) {
  updateAutomation(id, (automation) => ({ ...automation, ...patch, entries: [...automation.entries, ...entries.map((entry) => ({ ...entry, id: uid() }) as Entry)] }))
}
