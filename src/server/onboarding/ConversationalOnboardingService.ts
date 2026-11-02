import 'server-only'

import { randomUUID } from 'node:crypto'
import {
  ONBOARDING_INTRO,
  ONBOARDING_TOOL_LABELS,
  OnboardingRunIdSchema,
  extractOnboardingName,
  onboardingList,
  preparedOnboardingReply,
  onboardingProfileSteps,
  onboardingSteps,
  type OnboardingAction,
  type OnboardingProfile,
  type OnboardingReply,
  type OnboardingSession,
  type OnboardingStep,
} from '@/shared/onboarding/session'
import type { ConversationCollaborationRepository } from '@/server/conversations/ConversationCollaborationRepository'
import type { MemoryService } from '@/server/memory'
import type { WorkspaceAgentService } from '@/server/agents/WorkspaceAgentService'
import type { WorkspaceService } from '@/server/workspaces/WorkspaceService'
import { WorkServiceError, type WorkService } from '@/server/work/WorkService'
import type { OnboardingStateRepository } from './OnboardingStateRepository'

const MAX_STATE_LENGTH = 64_000
type Outbox = { clientNonce: string; content: string; kind: 'user' | 'assistant' }
type StoredState = { version: 1; userId: string; session: OnboardingSession; outbox: Outbox[] }

export type OnboardingReplyContext = Record<string, never>
export type OnboardingReplyFactory = (
  step: OnboardingStep,
  profile: OnboardingProfile,
  aiEnabled: boolean,
  context: OnboardingReplyContext,
) => Promise<OnboardingReply>
export type OnboardingEffects = {
  agents: Pick<WorkspaceAgentService, 'list' | 'resolveMainThread'>
  collaboration: Pick<ConversationCollaborationRepository, 'addMessage' | 'addAgentMessage'>
  memories: Pick<MemoryService, 'get'>
  work: Pick<WorkService, 'get'>
  workspaces: Pick<WorkspaceService, 'listInvitations'>
}
export type OnboardingServiceDependencies = {
  repository: OnboardingStateRepository
  effects: OnboardingEffects
  reply?: OnboardingReplyFactory
  createRunId?: () => string
}
export type OnboardingSessionResponse = { completed: boolean; session: OnboardingSession | null }

export class OnboardingServiceError extends Error {
  constructor(message: string, readonly statusCode: 400 | 403 | 409 | 500, readonly code: string) {
    super(message)
    this.name = 'OnboardingServiceError'
  }
}

export class ConversationalOnboardingService {
  private readonly reply: OnboardingReplyFactory

  constructor(private readonly deps: OnboardingServiceDependencies) {
    this.reply = deps.reply ?? (async (step, profile) => preparedOnboardingReply(step, profile))
  }

  async get(userId: string, workspaceId: string): Promise<OnboardingSessionResponse> {
    const record = await this.deps.repository.get(userId)
    if (!record) return { completed: false, session: null }
    if (record.hasSeenOnboarding) {
      const completed = this.read(record.onboardingSession, userId)
      if (completed?.session.step === 'complete' && completed.session.workspaceId === workspaceId) {
        await this.recover(completed)
        return { completed: true, session: completed.session }
      }
      return { completed: true, session: null }
    }
    const state = this.read(record.onboardingSession, userId)
    if (!state) return { completed: false, session: null }
    this.assertWorkspace(state.session, workspaceId)
    await this.recover(state)
    return { completed: false, session: state.session }
  }

  async start(userId: string, workspaceId: string, options: { member?: boolean } = {}): Promise<OnboardingSessionResponse> {
    const record = await this.deps.repository.get(userId)
    if (!record) throw new OnboardingServiceError('Onboarding state is unavailable', 500, 'state_unavailable')
    if (record.hasSeenOnboarding) return { completed: true, session: null }
    const existing = this.read(record.onboardingSession, userId)
    if (existing) {
      this.assertWorkspace(existing.session, workspaceId)
      await this.recover(existing)
      return { completed: false, session: existing.session }
    }
    const list = await this.deps.effects.agents.list({ actorUserId: userId, workspaceId })
    const overlay = list.agents.find((agent) => agent.isDefault || agent.name.trim().toLowerCase() === 'overlay')
    if (!overlay) throw new OnboardingServiceError('Overlay agent is unavailable', 409, 'overlay_agent_unavailable')
    const thread = await this.deps.effects.agents.resolveMainThread({ actorUserId: userId, workspaceId, agentId: overlay.id })
    const profile = { name: '', about: '', daily: '' }
    const reply = await this.makeReply('name', profile, false, {})
    const runId = this.deps.createRunId?.() ?? randomUUID()
    if (!OnboardingRunIdSchema.safeParse(runId).success) throw new OnboardingServiceError('Onboarding run is invalid', 500, 'run_invalid')
    const session: OnboardingSession = {
      version: 1, flowVersion: 3, member: options.member ?? false, runId, revision: 1, workspaceId, conversationId: thread.conversationId,
      agentId: overlay.id, agentPrincipalId: overlay.principalId, step: 'name', profile,
      aiEnabled: false, reply, employees: [], suggestions: [], createdAgentIds: [],
    }
    return await this.commit(userId, workspaceId, 0, {
      version: 1, userId, session,
      outbox: [{ clientNonce: this.nonce(userId, runId, 1, 'assistant'), content: `${ONBOARDING_INTRO}\n\n${reply.message}`, kind: 'assistant' }],
    }, false)
  }

  async act(userId: string, workspaceId: string, action: OnboardingAction): Promise<OnboardingSessionResponse> {
    const record = await this.deps.repository.get(userId)
    if (!record) throw new OnboardingServiceError('Onboarding state is unavailable', 500, 'state_unavailable')
    if (record.hasSeenOnboarding) {
      if (action.action === 'finish' && record.onboardingSession) {
        const completedState = this.read(record.onboardingSession, userId)
        if (completedState?.session.step === 'complete' && completedState.session.taskId === action.taskId) {
          this.assertWorkspace(completedState.session, workspaceId)
          await this.recover(completedState)
          return { completed: true, session: completedState.session }
        }
      }
      return { completed: true, session: null }
    }
    const state = this.read(record.onboardingSession, userId)
    if (!state) throw new OnboardingServiceError('Start onboarding before continuing', 409, 'session_not_started')
    this.assertWorkspace(state.session, workspaceId)
    await this.recover(state)
    if (action.action === 'start' || action.runId !== state.session.runId || action.revision !== state.session.revision) {
      return { completed: false, session: state.session }
    }
    const next = await this.reduce(state, userId, action)
    return await this.commit(userId, workspaceId, state.session.revision, next.state, next.completed)
  }

  reset(userId: string) {
    return this.deps.repository.reset(userId)
  }

  private async reduce(state: StoredState, userId: string, action: Exclude<OnboardingAction, { action: 'start' }>) {
    if (action.action === 'answer') return this.reduceAnswer(state, userId, action)
    if (action.action === 'back') return this.reduceBack(state, userId)
    if (action.action === 'advance') return this.reduceAdvance(state, userId, action)
    return this.reduceFinish(state, userId, action)
  }

  private async reduceAnswer(state: StoredState, userId: string, action: Extract<OnboardingAction, { action: 'answer' }>) {
    const current = state.session
    if (!onboardingProfileSteps(current).includes(current.step)) {
      throw new OnboardingServiceError('Answers are not accepted at this step', 409, 'invalid_step')
    }
    const value = action.value.trim()
    if (current.step === 'name' && value.length > 200) {
      throw new OnboardingServiceError('Name is too long', 400, 'invalid_profile')
    }
    // The transcript keeps what the user typed; the profile keeps just the name.
    const stored = current.step === 'name' && current.flowVersion === 3 ? extractOnboardingName(value) : value
    if (!stored) throw new OnboardingServiceError('Tell me what to call you', 400, 'invalid_profile')
    const profile = { ...current.profile, [current.step]: stored } as OnboardingProfile
    if (current.flowVersion === 2 && current.step === 'about') {
      if (!profile.team && /\b(?:just me|work(?:ing)? (?:alone|solo|on my own)|solo founder)\b/i.test(value)) profile.team = 'Just me'
      if (!profile.team && /\b(?:team of \d+|\d+[- ]person (?:team|agency|company))\b/i.test(value)) profile.team = 'A small team'
      const website = value.match(/https?:\/\/[^\s<>]+/i)?.[0]
      if (!profile.website && website) profile.website = website
    }
    const steps = onboardingProfileSteps(current)
    let nextIndex = steps.indexOf(current.step) + 1
    while ((steps[nextIndex] === 'team' && profile.team) || (steps[nextIndex] === 'website' && profile.website)) nextIndex++
    const step: OnboardingStep = steps[nextIndex] ?? (current.member ? 'connections' : 'employees')
    const reply = await this.makeReply(step, profile, current.aiEnabled, {})
    const revision = current.revision + 1
    return {
      completed: false,
      state: { ...state, session: { ...current, revision, step, profile, reply, employees: reply.employees ?? [], suggestions: reply.suggestions ?? [] },
        outbox: [{ clientNonce: this.nonce(userId, current.runId, revision, 'user'), content: value, kind: 'user' as const },
          { clientNonce: this.nonce(userId, current.runId, revision, 'assistant'), content: reply.message, kind: 'assistant' as const }] },
    }
  }

  private async reduceBack(state: StoredState, userId: string) {
    const current = state.session
    const steps = onboardingProfileSteps(current)
    const index = steps.indexOf(current.step)
    if (index < 1 || current.createdAgentIds.length) throw new OnboardingServiceError('Previous answers can no longer be changed here', 409, 'invalid_step')
    const step = steps[index - 1] as OnboardingStep
    const reply = await this.makeReply(step, current.profile, current.aiEnabled, {})
    const revision = current.revision + 1
    return { completed: false, state: { ...state, session: { ...current, step, revision, reply }, outbox: [{ clientNonce: this.nonce(userId, current.runId, revision, 'assistant'), content: reply.message, kind: 'assistant' as const }] } }
  }

  private async reduceAdvance(state: StoredState, userId: string, action: Extract<OnboardingAction, { action: 'advance' }>) {
    const current = state.session
    if (!['employees', 'connections', 'external', 'memories', 'teammates'].includes(current.step)) {
      throw new OnboardingServiceError('This step cannot be advanced', 409, 'invalid_step')
    }
    if (action.connectedTools?.length && current.step !== 'connections') throw new OnboardingServiceError('Tools are not valid at this step', 400, 'invalid_action')
    const agentNames = await this.verifyAgents(current, userId, action.agentIds ?? [])
    await this.verifyMemories(current, userId, action.memoryIds ?? [])
    const invitedEmails = await this.verifyInvitations(current, userId, action.invitationIds ?? [])
    const createdAgentIds = [...new Set([...current.createdAgentIds, ...(action.agentIds ?? [])])]
    const step = this.stepAfter(current)
    const prepared = await this.makeReply(step, current.profile, current.aiEnabled, {})
    const revision = current.revision + 1
    const summary = current.flowVersion === 3
      ? onboardingAdvanceReply(current.step, { agentNames, invitedEmails, tools: (action.connectedTools ?? []).map((tool) => ONBOARDING_TOOL_LABELS[tool]), memories: Boolean(action.memoryIds?.length) })
      : onboardingAdvanceSummary(current.step, action)
    const confirmation = current.flowVersion === 3 ? onboardingConfirmation(current.step, agentNames, invitedEmails) : ''
    const reply = confirmation ? { ...prepared, message: `${confirmation}\n\n${prepared.message}` } : prepared
    return { completed: false, state: { ...state, session: { ...current, revision, step, reply, employees: reply.employees ?? [], suggestions: reply.suggestions ?? [], createdAgentIds },
      outbox: [{ clientNonce: this.nonce(userId, current.runId, revision, 'user'), content: summary, kind: 'user' as const },
        { clientNonce: this.nonce(userId, current.runId, revision, 'assistant'), content: reply.message, kind: 'assistant' as const }] } }
  }

  /** Returns the names of the agents, which must be the user's own. */
  private async verifyAgents(current: OnboardingSession, userId: string, agentIds: string[]): Promise<string[]> {
    if (!agentIds.length) return []
    const agentStep = current.step === 'employees' || current.step === 'external' || (current.flowVersion === 3 && current.step === 'connections')
    if (!agentStep) throw new OnboardingServiceError('Agent ids are not valid at this step', 400, 'invalid_action')
    const list = await this.deps.effects.agents.list({ actorUserId: userId, workspaceId: current.workspaceId })
    const visible = new Map(list.agents.map((agent) => [agent.id, agent]))
    return agentIds.map((id) => {
      const agent = visible.get(id)
      if (!agent || agent.createdByPrincipalId !== list.viewerPrincipalId) {
        throw new OnboardingServiceError('One or more agents are not available to you', 403, 'agent_forbidden')
      }
      return agent.name
    })
  }

  private async verifyMemories(current: OnboardingSession, userId: string, memoryIds: string[]) {
    if (!memoryIds.length) return
    if (current.step !== 'memories') throw new OnboardingServiceError('Memory ids are not valid at this step', 400, 'invalid_action')
    await Promise.all(memoryIds.map(async (memoryId) => {
      const memory = await this.deps.effects.memories.get({ memoryId, userId, workspaceId: current.workspaceId })
      if (!memory || memory.userId !== userId || memory.visibility === 'workspace') {
        throw new OnboardingServiceError('One or more memories are not personal memories', 403, 'memory_forbidden')
      }
    }))
  }

  /** Returns the invited addresses, which must be pending invitations in this workspace. */
  private async verifyInvitations(current: OnboardingSession, userId: string, invitationIds: string[]): Promise<string[]> {
    if (!invitationIds.length) return []
    if (current.step !== 'teammates') throw new OnboardingServiceError('Invitation ids are not valid at this step', 400, 'invalid_action')
    const invitations = await this.deps.effects.workspaces.listInvitations({ actorUserId: userId, workspaceId: current.workspaceId })
    const pending = new Map(invitations.filter((invitation) => invitation.status === 'pending').map((invitation) => [invitation.id, invitation.email]))
    return invitationIds.map((id) => {
      const email = pending.get(id)
      if (!email) throw new OnboardingServiceError('One or more invitations are unavailable', 403, 'invitation_forbidden')
      return email
    })
  }

  private stepAfter(current: OnboardingSession): OnboardingStep {
    const solo = /^(just me|solo|on my own|by myself)[.!]?$/i.test(current.profile.team?.trim() ?? '')
    if (current.step === 'employees') return 'connections'
    if (current.step === 'connections') return current.flowVersion === 2 ? 'external' : 'memories'
    if (current.step === 'external') return 'memories'
    return current.step === 'memories' && !current.member && !solo ? 'teammates' : 'task'
  }

  private async reduceFinish(state: StoredState, userId: string, action: Extract<OnboardingAction, { action: 'finish' }>) {
    const current = state.session
    if (current.step !== 'task') throw new OnboardingServiceError('Finish is only available from the task step', 409, 'invalid_step')
    let task: Awaited<ReturnType<WorkService['get']>>
    try {
      task = await this.deps.effects.work.get({ id: action.taskId, userId, workspaceId: current.workspaceId })
    } catch (error) {
      if (error instanceof WorkServiceError) {
        const statusCode = error.statusCode === 404 ? 403 : error.statusCode === 403 ? 403 : 500
        throw new OnboardingServiceError('Task is not available in this workspace', statusCode, 'task_unavailable')
      }
      throw error
    }
    if (task.workspaceId !== current.workspaceId || task.createdBy !== userId) throw new OnboardingServiceError('Task is not available in this workspace', 403, 'task_forbidden')
    const reply = await this.makeReply('complete', current.profile, current.aiEnabled, {})
    const revision = current.revision + 1
    return {
      completed: true,
      state: {
        ...state,
        session: { ...current, revision, step: 'complete' as const, reply, taskId: task.id },
        outbox: [
          { clientNonce: this.nonce(userId, current.runId, revision, 'user'), content: task.title.trim(), kind: 'user' as const },
          { clientNonce: this.nonce(userId, current.runId, revision, 'assistant'), content: reply.message, kind: 'assistant' as const },
        ],
      },
    }
  }

  private async commit(userId: string, workspaceId: string, expectedRevision: number, state: StoredState, completed: boolean) {
    const result = await this.deps.repository.compareAndSet({
      userId,
      expectedRevision,
      expectedRunId: expectedRevision === 0 ? undefined : state.session.runId,
      onboardingSession: this.serialize(state),
      hasSeenOnboarding: completed,
    })
    if (!result.ok) {
      const current = await this.deps.repository.get(userId)
      if (!current?.onboardingSession) return { completed: Boolean(current?.hasSeenOnboarding), session: null }
      const recovered = this.read(current.onboardingSession, userId)
      if (!recovered) throw new OnboardingServiceError('Onboarding state is invalid', 500, 'state_invalid')
      this.assertWorkspace(recovered.session, workspaceId)
      await this.recover(recovered)
      if (current.hasSeenOnboarding) {
        return state.session.step === 'complete' && recovered.session.step === 'complete'
          ? { completed: true, session: recovered.session }
          : { completed: true, session: null }
      }
      return { completed: false, session: recovered.session }
    }
    await this.recover(state)
    return completed ? { completed: true, session: state.session } : { completed: false, session: state.session }
  }

  private async recover(state: StoredState) {
    for (const message of state.outbox) {
      const base = { actorUserId: state.userId, clientNonce: message.clientNonce, content: message.content, conversationId: state.session.conversationId, turnId: `onboarding:${state.userId}:${state.session.runId}:${state.session.revision}`, workspaceId: state.session.workspaceId }
      if (message.kind === 'user') await this.deps.effects.collaboration.addMessage(base)
      else await this.deps.effects.collaboration.addAgentMessage({ ...base, messagePurpose: 'prepared_onboarding', authorPrincipalId: state.session.agentPrincipalId, modelId: 'onboarding:prepared' })
    }
    if (!state.outbox.length) return
    if (!await this.deps.repository.clearOutbox({
      userId: state.userId,
      expectedRunId: state.session.runId,
      expectedRevision: state.session.revision,
      onboardingSession: this.serialize({ ...state, outbox: [] }),
    })) {
      throw new OnboardingServiceError('Onboarding transcript is busy; retry shortly', 409, 'transcript_busy')
    }
    state.outbox.length = 0
  }

  private async makeReply(step: OnboardingStep, profile: OnboardingProfile, aiEnabled: boolean, context: OnboardingReplyContext) {
    const reply = await this.reply(step, profile, aiEnabled, context)
    if (!isValidReply(reply) || !reply.message.trim()) throw new OnboardingServiceError('Onboarding reply is invalid', 500, 'reply_invalid')
    return reply
  }
  private read(value: string | undefined, userId: string): StoredState | null {
    if (!value || new TextEncoder().encode(value).length > MAX_STATE_LENGTH) return null
    try {
      const parsed: unknown = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      const state = parsed as StoredState
      return isValidState(state, userId) ? state : null
    } catch (_error) { return null }
  }
  private serialize(state: StoredState) {
    const value = JSON.stringify(state)
    if (new TextEncoder().encode(value).length > MAX_STATE_LENGTH) throw new OnboardingServiceError('Onboarding state is too large', 400, 'state_too_large')
    return value
  }
  private assertWorkspace(session: OnboardingSession, workspaceId: string) {
    if (session.workspaceId !== workspaceId) throw new OnboardingServiceError('Onboarding is already in progress in another workspace', 409, 'workspace_mismatch')
  }
  private nonce(userId: string, runId: string, revision: number, kind: string) { return `onboarding:${userId}:${runId}:${revision}:${kind}` }
}

function isValidState(value: unknown, userId: string): value is StoredState {
  if (!isExactKeys(value, ['version', 'userId', 'session', 'outbox'])) return false
  const state = value as Record<string, unknown>
  return state.version === 1 &&
    state.userId === userId &&
    isValidOnboardingSession(state.session) &&
    isValidOutbox(state.outbox)
}

function isValidOnboardingSession(value: unknown): value is OnboardingSession {
  if (!isObjectRecord(value)) return false
  const session = value as Record<string, unknown>
  const sessionKeys = ['version', 'runId', 'revision', 'workspaceId', 'conversationId', 'agentId', 'agentPrincipalId', 'step', 'profile', 'aiEnabled', 'reply', 'employees', 'suggestions', 'createdAgentIds', 'taskId']
  const optionalKeys = ['flowVersion', 'member'].filter((key) => Object.hasOwn(session, key))
  if (!isExactKeys(value, [...(session.taskId === undefined ? sessionKeys.slice(0, -1) : sessionKeys), ...optionalKeys])) return false
  if (session.flowVersion !== undefined && ![2, 3].includes(session.flowVersion as number)) return false
  if (session.member !== undefined && typeof session.member !== 'boolean') return false
  if (session.version !== 1
    || !OnboardingRunIdSchema.safeParse(session.runId).success
    || !Number.isInteger(session.revision)
    || (session.revision as number) < 1
    || !onboardingSteps.some((step) => step === session.step)
    || !boundedString(session.workspaceId, 1, 200)
    || !boundedString(session.conversationId, 1, 200)
    || !boundedString(session.agentId, 1, 200)
    || !boundedString(session.agentPrincipalId, 1, 200)
    || typeof session.aiEnabled !== 'boolean'
    || !Array.isArray(session.employees)
    || !Array.isArray(session.suggestions)
    || !Array.isArray(session.createdAgentIds)) return false
  return isValidProfile(session.profile) &&
    isValidStoredReply(session.reply) &&
    isValidSessionCollections(session) &&
    (session.step === 'complete' ? boundedString(session.taskId, 1, 200) : session.taskId === undefined)
}

function isValidProfile(value: unknown): value is OnboardingProfile {
  if (!isObjectRecord(value) || !isExactKeys(value, ['name', 'about', 'daily', ...['team', 'website'].filter((key) => Object.hasOwn(value, key))])) return false
  const profile = value as Record<string, unknown>
  return boundedString(profile.name, 0, 200) &&
    boundedString(profile.about, 0, 3000) &&
    boundedString(profile.daily, 0, 3000) &&
    (profile.team === undefined || boundedString(profile.team, 0, 3000)) &&
    (profile.website === undefined || boundedString(profile.website, 0, 3000))
}

function isValidStoredReply(value: unknown): value is OnboardingReply {
  if (!isValidReply(value)) return false
  const reply = value as Record<string, unknown>
  const replyKeys = ['message', 'mode', ...(Object.hasOwn(reply, 'employees') ? ['employees'] : []), ...(Object.hasOwn(reply, 'suggestions') ? ['suggestions'] : [])]
  return isExactKeys(reply, replyKeys)
}

function isValidSessionCollections(session: Record<string, unknown>): boolean {
  return Array.isArray(session.employees) &&
    Array.isArray(session.suggestions) &&
    Array.isArray(session.createdAgentIds) &&
    !session.employees.some((employee) => !isValidEmployee(employee)) &&
    !session.suggestions.some((suggestion) => !boundedString(suggestion, 1, 3000)) &&
    !session.createdAgentIds.some((id) => !boundedString(id, 1, 200))
}

function isValidOutbox(value: unknown): value is Outbox[] {
  if (!Array.isArray(value) || value.length > 2) return false
  return value.every((message) => {
    if (!isExactKeys(message, ['clientNonce', 'content', 'kind'])) return false
    const record = message as Record<string, unknown>
    return boundedString(record.clientNonce, 1, 500) &&
      boundedString(record.content, 1, 8000) &&
      ['user', 'assistant'].includes(String(record.kind))
  })
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function onboardingAdvanceSummary(
  step: OnboardingStep,
  action: Extract<OnboardingAction, { action: 'advance' }>,
): string {
  if (step === 'employees') return action.agentIds?.length ? `Selected ${action.agentIds.length} AI employee${action.agentIds.length === 1 ? '' : 's'}.` : 'Skipped selecting AI employees.'
  if (step === 'external') return action.agentIds?.length ? 'Saved external agent connections.' : 'Skipped external agent connections.'
  if (step === 'memories') return action.memoryIds?.length ? `Imported ${action.memoryIds.length} Personal context item${action.memoryIds.length === 1 ? '' : 's'}.` : 'Skipped importing Personal context.'
  if (step === 'teammates') return action.invitationIds?.length ? `Invited ${action.invitationIds.length} teammate${action.invitationIds.length === 1 ? '' : 's'}.` : 'Skipped inviting teammates.'
  return 'Finished reviewing optional tool connections.'
}

/** The user's side of the transcript for a v3 step, phrased the way they would say it. */
function onboardingAdvanceReply(
  step: OnboardingStep,
  done: { agentNames: string[]; invitedEmails: string[]; tools: string[]; memories: boolean },
): string {
  if (step === 'employees') return done.agentNames.length ? `Add ${onboardingList(done.agentNames)}.` : "I'll set up employees later."
  if (step === 'connections') {
    const connected = [...done.tools, ...done.agentNames]
    return connected.length ? `Connected ${onboardingList(connected)}.` : "I'll connect tools later."
  }
  if (step === 'memories') return done.memories ? 'Here is some context from my other assistant.' : 'Not right now.'
  if (step === 'teammates') return done.invitedEmails.length ? `Invite ${onboardingList(done.invitedEmails)}.` : 'Not right now.'
  return 'Not right now.'
}

/** Overlay's acknowledgement before its next question, when the step created something. */
function onboardingConfirmation(step: OnboardingStep, agentNames: string[], invitedEmails: string[]): string {
  if (step === 'employees' && agentNames.length) return `${onboardingList(agentNames)} ${agentNames.length === 1 ? 'is' : 'are'} on your team.`
  if (step === 'teammates' && invitedEmails.length) return "Invites sent. They'll get an email to join."
  return ''
}

function isValidReply(value: unknown): value is OnboardingReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const reply = value as Record<string, unknown>
  if (!['prepared', 'live'].includes(String(reply.mode)) || !boundedString(reply.message, 1, 8000) || !reply.message.trim()) return false
  if (Object.keys(reply).some((key) => !['message', 'mode', 'employees', 'suggestions'].includes(key))) return false
  if (reply.employees !== undefined && (!Array.isArray(reply.employees) || reply.employees.length > 20 || reply.employees.some((employee) => !isValidEmployee(employee)))) return false
  if (reply.suggestions !== undefined && (!Array.isArray(reply.suggestions) || reply.suggestions.length > 20 || reply.suggestions.some((suggestion) => !boundedString(suggestion, 1, 3000)))) return false
  return true
}

function isValidEmployee(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isExactKeys(value, ['name', 'role'])) return false
  const employee = value as Record<string, unknown>
  return boundedString(employee.name, 1, 200) && boundedString(employee.role, 1, 1000)
}

function boundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
}

function isExactKeys(value: unknown, allowed: string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key))
}
