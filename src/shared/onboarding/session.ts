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
  flowVersion?: 2
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
  z.object({ action: z.literal('consent'), runId: OnboardingRunIdSchema, revision, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('answer'), runId: OnboardingRunIdSchema, revision, value: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ action: z.literal('back'), runId: OnboardingRunIdSchema, revision }).strict(),
  z.object({ action: z.literal('advance'), runId: OnboardingRunIdSchema, revision, agentIds: ids.optional(), memoryIds: ids.optional(), invitationIds: ids.optional() }).strict(),
  z.object({ action: z.literal('finish'), runId: OnboardingRunIdSchema, revision, taskId: z.string().trim().min(1).max(200) }).strict(),
])
export type OnboardingAction = z.infer<typeof OnboardingActionSchema>

export const ONBOARDING_INTRO = "I'm Overlay, your new chief of staff. I'm responsible for getting your work done and managing your fleet of AI employees to help you achieve your goals."

export function preparedOnboardingReply(step: OnboardingStep, profile: OnboardingProfile): OnboardingReply {
  const technical = /code|software|engineer|develop|build/i.test(profile.about + ' ' + profile.daily)
  const employees = technical
    ? [{ name: 'Spec', role: 'Turn product ideas into clear specs, review changes, and keep documentation up to date.' }, { name: 'Scout', role: 'Research decisions, prepare briefs, and organize follow-ups.' }]
    : [{ name: 'Scout', role: 'Research decisions and prepare concise briefs grounded in your work.' }, { name: 'Flow', role: 'Draft replies, organize recurring work, and prepare follow-ups for review.' }]
  const suggestions = technical
    ? ['Draft a clear specification for my next product improvement.', 'Prepare a prioritized plan for my recurring work this week.']
    : ['Draft a reusable reply for a question I answer every day.', 'Prepare a prioritized plan for my recurring work this week.']
  const messages: Record<OnboardingStep, string> = {
    name: 'What shall I call you?',
    about: `Nice to meet you, ${profile.name}. Tell me a bit about yourself. What do you do, and what are you working on?`,
    team: 'Who are you working with?',
    website: 'Is there a website I should know about? Optional context only. I will not fetch it during setup.',
    daily: "What tasks take up your time each day that you'd like AI employees to help with?",
    employees: "Based on what you've told me, I'd suggest starting with these two AI employees.",
    connections: 'Your AI employees are most useful with the right context. Which tools would you like to connect?',
    external: 'Bring an agent you already use? Native Overlay employees do not need an external connection.',
    memories: 'How about some more context? You can bring over what another AI assistant already knows about your work.',
    teammates: 'Would you like anyone else to work with you and your AI employees here? They can bring their own agents, too.',
    task: "What's one task we can get started with that would move your work forward?",
    complete: 'Your first task is ready in Work. Happy working.',
  }
  return { message: messages[step], mode: 'prepared', ...(step === 'employees' ? { employees } : {}), ...(step === 'task' ? { suggestions } : {}) }
}

export function onboardingProfileSteps(session: Pick<OnboardingSession, 'flowVersion' | 'member'>): OnboardingStep[] {
  return session.flowVersion === 2 && !session.member ? ['name', 'about', 'team', 'website', 'daily'] : ['name', 'about', 'daily']
}

export function onboardingChoices(session: OnboardingSession, initialName: string): { id: string; label: string }[] {
  const choices: Partial<Record<OnboardingStep, readonly string[]>> = {
    name: initialName.trim() ? [initialName.trim()] : [],
    about: ['Leadership', 'Engineering', 'Product', 'Design', 'Marketing', 'Operations'],
    team: ['Just me', 'A small team', 'Several teams'],
    website: ["I'll add it later", "I don't have one"],
    daily: ['Research & summaries', 'Email & follow-ups', 'Planning & coordination', 'Writing & content', 'Coding & reviews', 'Reporting & analysis'],
    task: session.suggestions,
  }
  return (choices[session.step] ?? []).map((label, index) => ({ id: `${session.step}:${index}`, label }))
}
