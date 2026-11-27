import { z } from 'zod/v3'

export const onboardingSteps = ['heard', 'name', 'about', 'team', 'website', 'daily', 'employees', 'connections', 'external', 'memories', 'teammates', 'task', 'complete'] as const
export type OnboardingStep = typeof onboardingSteps[number]
export type OnboardingProfile = { name: string; about: string; daily: string; team?: string; website?: string; heardFrom?: string }
export type OnboardingEmployee = { name: string; role: string }
export type OnboardingReply = {
  message: string
  employees?: OnboardingEmployee[]
  suggestions?: string[]
  mode: 'prepared' | 'live'
}
export const OnboardingWorkspaceContextSchema = z.object({
  workspaceName: z.string().min(1).max(200),
  personal: z.boolean(),
  invited: z.boolean(),
  inviterName: z.string().max(200).nullable(),
  billingContactName: z.string().max(200).nullable(),
}).strict()
export type OnboardingWorkspaceContext = z.infer<typeof OnboardingWorkspaceContextSchema>

export type OnboardingSession = {
  workspaceContext?: OnboardingWorkspaceContext
  version: 1
  /** 4: five questions, an optional subscription, then the first task starts on its own (see ONBOARDING_V4_PLAN). */
  flowVersion?: 2 | 3 | 4
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
  taskDraft?: string
  /** Flow 4: the chief the first task runs with (the personal chief when solo, else Overlay) and its thread. */
  taskAgentId?: string
  taskAgentPrincipalId?: string
  taskConversationId?: string
}
export type OnboardingSessionResponse = {
  completed: boolean
  session: OnboardingSession | null
  /** A new account's first setup on Overlay Desktop (internal/plans/DESKTOP_ONBOARDING_PLAN.md). */
  desktopSetup?: boolean
}
/** Answers Overlay Desktop's setup collected before the conversation starts. */
export const OnboardingPrefillSchema = z.object({
  name: z.string().trim().min(1).max(200),
  about: z.string().trim().min(1).max(500),
  team: z.string().trim().min(1).max(200).optional(),
}).strict()
export type OnboardingPrefill = z.infer<typeof OnboardingPrefillSchema>

const revision = z.number().int().nonnegative()
export const OnboardingRunIdSchema = z.string().uuid()
const ids = z.array(z.string().trim().min(1).max(200)).max(20)
export const OnboardingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), prefill: OnboardingPrefillSchema.optional() }).strict(),
  z.object({ action: z.literal('answer'), runId: OnboardingRunIdSchema, revision, value: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal('back'), runId: OnboardingRunIdSchema, revision }).strict(),
  z.object({ action: z.literal('draft_task'), runId: OnboardingRunIdSchema, revision, value: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal('save_task'), runId: OnboardingRunIdSchema, revision, taskId: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('advance'), runId: OnboardingRunIdSchema, revision, agentIds: ids.optional(), memoryIds: ids.optional(), invitationIds: ids.optional(), connectedTools: z.array(z.enum(['gmail', 'googlecalendar', 'slack', 'notion', 'github'])).max(5).optional() }).strict(),
  z.object({ action: z.literal('finish'), runId: OnboardingRunIdSchema, revision, taskId: z.string().trim().min(1).max(200), start: z.literal(false).optional() }).strict(),
])
export type OnboardingAction = z.infer<typeof OnboardingActionSchema>

export const ONBOARDING_INTRO = "Hi, I'm Overlay, your chief of staff. I'll run your AI employees and keep your work moving."

export const ONBOARDING_INTRO_V4 = "Hi, I'm Overlay, your AI chief of staff. A few quick questions, then I'll get to work on something for you."
export const ONBOARDING_HEARD_FROM = ['X', 'LinkedIn', 'A friend or colleague', 'Search', 'YouTube', 'Somewhere else'] as const
export const ONBOARDING_TEAM_CHOICES = ['Just me', 'With a team'] as const
export const ONBOARDING_SUBSCRIPTION_PROMPT = "Got it. Want me to run on your own AI subscription, like ChatGPT or Claude? It's optional. I can use Overlay models instead."
/** The profile field each flow 4 question fills. */
export function onboardingProfileKey(step: OnboardingStep): keyof OnboardingProfile {
  return step === 'heard' ? 'heardFrom' : step as keyof OnboardingProfile
}

/** Solo people run their first task with their personal chief; teams (and invited members) with Overlay. */
export function onboardingSolo(session: Pick<OnboardingSession, 'member' | 'profile'>): boolean {
  return !session.member && /^(just me|solo|on my own|by myself)[.!]?$/i.test(session.profile.team?.trim() ?? '')
}

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

export function preparedOnboardingReply(step: OnboardingStep, profile: OnboardingProfile, flowVersion?: number): OnboardingReply {
  if (flowVersion === 4) return preparedOnboardingReplyV4(step, profile)
  const messages: Record<OnboardingStep, string> = {
    heard: 'How did you hear about Overlay?',
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
    complete: "Your first task is now in Work. I'll keep you updated there.",
  }
  return {
    message: messages[step], mode: 'prepared',
    ...(step === 'employees' ? { employees: onboardingEmployeesFor(profile) } : {}),
    ...(step === 'task' ? { suggestions: onboardingTasksFor(profile) } : {}),
  }
}

function preparedOnboardingReplyV4(step: OnboardingStep, profile: OnboardingProfile): OnboardingReply {
  const messages: Partial<Record<OnboardingStep, string>> = {
    heard: 'First, how did you hear about Overlay?',
    name: 'Thanks. What should I call you?',
    about: `Nice to meet you, ${profile.name}.\n\nWhat kind of work do you do?`,
    team: 'Will you use Overlay on your own or with a team?',
    task: "What's one task I can take off your plate? Your first task is on us.",
    complete: "I'm on it. I'll work on this in our thread and ask there if I need access to anything.",
  }
  return {
    message: messages[step] ?? preparedOnboardingReply(step, profile).message, mode: 'prepared',
    ...(step === 'task' ? { suggestions: onboardingTasksFor(profile) } : {}),
  }
}

export function onboardingProfileSteps(session: Pick<OnboardingSession, 'flowVersion' | 'member'>): OnboardingStep[] {
  if (session.flowVersion === 4) return session.member ? ['heard', 'name', 'about'] : ['heard', 'name', 'about', 'team']
  if (session.flowVersion === 3) return session.member ? ['name', 'about', 'daily'] : ['name', 'about', 'team', 'daily']
  return session.flowVersion === 2 && !session.member ? ['name', 'about', 'team', 'website', 'daily'] : ['name', 'about', 'daily']
}

export function onboardingChoices(session: Pick<OnboardingSession, 'step' | 'suggestions'> & { flowVersion?: OnboardingSession['flowVersion'] }): { id: string; label: string }[] {
  const choices: Partial<Record<OnboardingStep, readonly string[]>> = {
    heard: ONBOARDING_HEARD_FROM,
    about: ONBOARDING_ROLES,
    team: session.flowVersion === 4 ? ONBOARDING_TEAM_CHOICES : ONBOARDING_TEAMS,
    website: ["I'll add it later", "I don't have one"],
    daily: Object.keys(ONBOARDING_HELP_AREAS),
    task: session.suggestions,
  }
  return (choices[session.step] ?? []).map((label, index) => ({ id: `${session.step}:${index}`, label }))
}
