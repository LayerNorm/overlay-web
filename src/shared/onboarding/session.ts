import { z } from 'zod'

export const onboardingSteps = ['name', 'about', 'team', 'website', 'daily', 'employees', 'connections', 'external', 'memories', 'teammates', 'task', 'complete'] as const
export type OnboardingStep = typeof onboardingSteps[number]
export type OnboardingProfile = { name: string; about: string; daily: string; team?: string; website?: string }
export type OnboardingEmployee = { name: string; role: string }
export type OnboardingReply = {
  message: string
  employees?: OnboardingEmployee[]
  suggestions?: string[]
  mode: 'prepared' | 'live'
}
export type OnboardingSession = {
  version: 1
  flowVersion?: 2 | 3
  member?: boolean
  runId: string
  revision: number
  workspaceId: string
  conversationId: string
  agentId: string
  agentPrincipalId: string
  step: OnboardingStep
  profile: OnboardingProfile
  aiEnabled: boolean
  reply: OnboardingReply
  employees: OnboardingEmployee[]
  suggestions: string[]
  createdAgentIds: string[]
  taskId?: string
}
export type OnboardingSessionResponse = { completed: boolean; session: OnboardingSession | null }

const revision = z.number().int().nonnegative()
export const OnboardingRunIdSchema = z.string().uuid()
const ids = z.array(z.string().trim().min(1).max(200)).max(20)
export const OnboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }).strict(),
  z.object({ action: z.literal('answer'), runId: OnboardingRunIdSchema, revision, value: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal('back'), runId: OnboardingRunIdSchema, revision }).strict(),
  z.object({ action: z.literal('advance'), runId: OnboardingRunIdSchema, revision, agentIds: ids.optional(), memoryIds: ids.optional(), invitationIds: ids.optional(), connectedTools: z.array(z.enum(['gmail', 'googlecalendar', 'slack', 'notion', 'github'])).max(5).optional() }).strict(),
  z.object({ action: z.literal('finish'), runId: OnboardingRunIdSchema, revision, taskId: z.string().trim().min(1).max(200) }).strict(),
])
export type OnboardingAction = z.infer<typeof OnboardingActionSchema>

export const ONBOARDING_INTRO = "Hi, I'm Overlay, your chief of staff. I'll run your AI employees and keep your work moving."

export const ONBOARDING_ROLES = ['Founder or exec', 'Engineering', 'Product', 'Design', 'Marketing & sales', 'Operations'] as const
export const ONBOARDING_TEAMS = ['Just me', 'A small team', 'A larger company'] as const
/** Each help area maps to one suggested employee and one starter task, so the same answers always give the same setup. */
export const ONBOARDING_HELP_AREAS = {
  'Research & summaries': { employee: { name: 'Scout', role: 'Researches questions and turns long reads into short, sourced briefs.' }, task: 'Research my top three competitors and write a one-page brief' },
  'Email & follow-ups': { employee: { name: 'Relay', role: 'Drafts replies for your review and keeps track of follow-ups.' }, task: 'Draft a reusable reply to a question I get every week' },
  'Planning & coordination': { employee: { name: 'Atlas', role: 'Turns goals into weekly plans and keeps projects on schedule.' }, task: 'Make a prioritized plan for my week' },
  'Writing & content': { employee: { name: 'Quill', role: 'Drafts docs, posts, and updates in your voice for review.' }, task: 'Draft an update on what I am working on' },
  'Coding & reviews': { employee: { name: 'Spec', role: 'Writes specs, reviews pull requests, and keeps docs current.' }, task: 'Write a spec for the next feature I am building' },
  'Reporting & analysis': { employee: { name: 'Ledger', role: 'Pulls numbers together into a clear weekly report.' }, task: 'Outline a weekly report for the numbers I track' },
} as const satisfies Record<string, { employee: OnboardingEmployee; task: string }>
type HelpArea = keyof typeof ONBOARDING_HELP_AREAS
const ROLE_HELP_DEFAULTS: Record<string, HelpArea[]> = {
  engineering: ['Coding & reviews', 'Research & summaries'],
  product: ['Planning & coordination', 'Research & summaries'],
  design: ['Research & summaries', 'Writing & content'],
  marketing: ['Writing & content', 'Email & follow-ups'],
  operations: ['Planning & coordination', 'Reporting & analysis'],
}
/** Tools the connections step can report as connected in the transcript. */
export const ONBOARDING_TOOL_LABELS = { gmail: 'Gmail', googlecalendar: 'Google Calendar', slack: 'Slack', notion: 'Notion', github: 'GitHub' } as const

function onboardingHelpAreas(profile: OnboardingProfile): HelpArea[] {
  const daily = profile.daily.toLowerCase()
  const picked = (Object.keys(ONBOARDING_HELP_AREAS) as HelpArea[]).filter((area) => daily.includes(area.toLowerCase()))
  const role = Object.entries(ROLE_HELP_DEFAULTS).find(([key]) => profile.about.toLowerCase().includes(key))?.[1] ?? []
  return [...new Set([...picked, ...role, 'Research & summaries', 'Planning & coordination'] as HelpArea[])]
}

export function onboardingEmployeesFor(profile: OnboardingProfile): OnboardingEmployee[] {
  return onboardingHelpAreas(profile).slice(0, 2).map((area) => ({ ...ONBOARDING_HELP_AREAS[area].employee }))
}

export function onboardingTasksFor(profile: OnboardingProfile): string[] {
  return [...new Set(onboardingHelpAreas(profile).map((area) => ONBOARDING_HELP_AREAS[area].task))].slice(0, 3)
}

/** Joins names the way a person would: "A", "A and B", "A, B and C". */
export function onboardingList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

const NAME_LEAD = /^(?:you\s+can\s+call\s+me|you\s+may\s+call\s+me|just\s+call\s+me|please\s+call\s+me|call\s+me|i\s*'?\s*m|i\s+am|im|my\s+name\s+is|my\s+name'?s|name'?s|it'?s|this\s+is|i\s+go\s+by)\s+/i

/** Turns a conversational answer into a name: "You can call me Divyansh." becomes "Divyansh". */
export function extractOnboardingName(raw: string): string {
  let value = raw.trim().replace(/\s+/g, ' ')
  value = value.replace(/^(?:hi|hey|hello|yo)\b[\s,!.]*(?:there\b[\s,!.]*)?/i, '')
  value = value.replace(NAME_LEAD, '')
  value = value.replace(/\s*(?:,|\bbut\b|\band\b|\bthough\b).*$/i, '')
  value = value.replace(/\s+(?:please|thanks|thank\s+you)$/i, '').replace(/[.!?;:"'`]+$/g, '').replace(/^["'`]+/, '')
  const words = value.split(' ').filter(Boolean).slice(0, 3)
  return words.map((word) => (word === word.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word)).join(' ').slice(0, 60)
}

export function preparedOnboardingReply(step: OnboardingStep, profile: OnboardingProfile): OnboardingReply {
  const messages: Record<OnboardingStep, string> = {
    name: 'What should I call you?',
    about: `Nice to meet you, ${profile.name}.\n\nWhat kind of work do you do?`,
    team: 'Who do you work with?',
    website: 'Is there a website I should know about? Optional context only. I will not fetch it during setup.',
    daily: 'What would you like help with? Pick as many as you like.',
    employees: "Based on that, I'd start you with two AI employees. You can change them anytime.",
    connections: 'Want to connect the tools you already use? Your employees work better with context.',
    external: 'Bring an agent you already use? Native Overlay employees do not need an external connection.',
    memories: 'Do you use another AI assistant? I can pick up what it already knows about your work.',
    teammates: "Want to bring in anyone you work with? They'll join this workspace and can bring their own agents.",
    task: "Last thing. What's one task we can start on?",
    complete: "You're all set. Your first task is waiting in Work.\n\nHappy working.",
  }
  return {
    message: messages[step], mode: 'prepared',
    ...(step === 'employees' ? { employees: onboardingEmployeesFor(profile) } : {}),
    ...(step === 'task' ? { suggestions: onboardingTasksFor(profile) } : {}),
  }
}

export function onboardingProfileSteps(session: Pick<OnboardingSession, 'flowVersion' | 'member'>): OnboardingStep[] {
  if (session.flowVersion === 3) return session.member ? ['name', 'about', 'daily'] : ['name', 'about', 'team', 'daily']
  return session.flowVersion === 2 && !session.member ? ['name', 'about', 'team', 'website', 'daily'] : ['name', 'about', 'daily']
}

export function onboardingChoices(session: Pick<OnboardingSession, 'step' | 'suggestions'>): { id: string; label: string }[] {
  const choices: Partial<Record<OnboardingStep, readonly string[]>> = {
    about: ONBOARDING_ROLES,
    team: ONBOARDING_TEAMS,
    website: ["I'll add it later", "I don't have one"],
    daily: Object.keys(ONBOARDING_HELP_AREAS),
    task: session.suggestions,
  }
  return (choices[session.step] ?? []).map((label, index) => ({ id: `${session.step}:${index}`, label }))
}
