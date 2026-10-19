import 'server-only'

import {
  ONBOARDING_INTRO,
  preparedOnboardingReply,
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
    if (!record || record.hasSeenOnboarding) return { completed: Boolean(record?.hasSeenOnboarding), session: null }
    const state = this.read(record.onboardingSession, userId)
    if (!state) return { completed: false, session: null }
    this.assertWorkspace(state.session, workspaceId)
    await this.recover(state)
    return { completed: false, session: state.session }
  }

  async start(userId: string, workspaceId: string): Promise<OnboardingSessionResponse> {
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
    const session: OnboardingSession = {
      version: 1, revision: 1, workspaceId, conversationId: thread.conversationId,
      agentId: overlay.id, agentPrincipalId: overlay.principalId, step: 'name', profile,
      aiEnabled: false, reply, employees: [], suggestions: [], createdAgentIds: [],
    }
    return await this.commit(userId, workspaceId, 0, {
      version: 1, userId, session,
      outbox: [{ clientNonce: this.nonce(userId, 1, 'assistant'), content: `${ONBOARDING_INTRO}\n\n${reply.message}`, kind: 'assistant' }],
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
    if (action.action === 'start' || action.revision !== state.session.revision) {
      return { completed: false, session: state.session }
    }
    const next = await this.reduce(state, userId, action)
    return await this.commit(userId, workspaceId, state.session.revision, next.state, next.completed)
  }

  reset(userId: string) {
    return this.deps.repository.reset(userId)
  }

  private async reduce(state: StoredState, userId: string, action: Exclude<OnboardingAction, { action: 'start' }>) {
    const current = state.session
    if (action.action === 'consent') {
      return { completed: false, state: { ...state, session: { ...current, revision: current.revision + 1, aiEnabled: action.enabled } } }
    }
    if (action.action === 'answer') {
      if (!['name', 'about', 'daily'].includes(current.step)) {
        throw new OnboardingServiceError('Answers are not accepted at this step', 409, 'invalid_step')
      }
      const value = action.value.trim()
      if (current.step === 'name' && value.length > 200) {
        throw new OnboardingServiceError('Name is too long', 400, 'invalid_profile')
      }
      const profile = { ...current.profile, [current.step]: value } as OnboardingProfile
      const step: OnboardingStep = current.step === 'name' ? 'about' : current.step === 'about' ? 'daily' : 'employees'
      const reply = await this.makeReply(step, profile, current.aiEnabled, {})
      const revision = current.revision + 1
      return {
        completed: false,
        state: { ...state, session: { ...current, revision, step, profile, reply, employees: reply.employees ?? [], suggestions: reply.suggestions ?? [] },
          outbox: [{ clientNonce: this.nonce(userId, revision, 'user'), content: value, kind: 'user' },
            { clientNonce: this.nonce(userId, revision, 'assistant'), content: reply.message, kind: 'assistant' }] },
      }
    }
    if (action.action === 'advance') {
      if (!['employees', 'connections', 'memories', 'teammates'].includes(current.step)) {
        throw new OnboardingServiceError('This step cannot be advanced', 409, 'invalid_step')
      }
      let createdAgentIds = current.createdAgentIds
      if (action.agentIds?.length) {
        if (current.step !== 'employees') throw new OnboardingServiceError('Agent ids are not valid at this step', 400, 'invalid_action')
        const list = await this.deps.effects.agents.list({ actorUserId: userId, workspaceId: current.workspaceId })
        const visible = new Map(list.agents.map((agent) => [agent.id, agent]))
        for (const id of action.agentIds) {
          const agent = visible.get(id)
          if (!agent || agent.createdByPrincipalId !== list.viewerPrincipalId) {
            throw new OnboardingServiceError('One or more agents are not available to you', 403, 'agent_forbidden')
          }
        }
        createdAgentIds = [...new Set([...createdAgentIds, ...action.agentIds])]
      }
      if (action.memoryIds?.length) {
        if (current.step !== 'memories') throw new OnboardingServiceError('Memory ids are not valid at this step', 400, 'invalid_action')
        await Promise.all(action.memoryIds.map(async (memoryId) => {
          const memory = await this.deps.effects.memories.get({ memoryId, userId, workspaceId: current.workspaceId })
          if (!memory || memory.userId !== userId || memory.visibility === 'workspace') {
            throw new OnboardingServiceError('One or more memories are not personal memories', 403, 'memory_forbidden')
          }
        }))
      }
      if (action.invitationIds?.length) {
        if (current.step !== 'teammates') throw new OnboardingServiceError('Invitation ids are not valid at this step', 400, 'invalid_action')
        const invitations = await this.deps.effects.workspaces.listInvitations({ actorUserId: userId, workspaceId: current.workspaceId })
        const ids = new Set(invitations.filter((invitation) => invitation.status === 'pending').map((invitation) => invitation.id))
        if (action.invitationIds.some((id) => !ids.has(id))) {
          throw new OnboardingServiceError('One or more invitations are unavailable', 403, 'invitation_forbidden')
        }
      }
      const step: OnboardingStep = current.step === 'employees' ? 'connections' : current.step === 'connections' ? 'memories' : current.step === 'memories' ? 'teammates' : 'task'
      const reply = await this.makeReply(step, current.profile, current.aiEnabled, {})
      const revision = current.revision + 1
      return { completed: false, state: { ...state, session: { ...current, revision, step, reply, employees: reply.employees ?? [], suggestions: reply.suggestions ?? [], createdAgentIds },
        outbox: [{ clientNonce: this.nonce(userId, revision, 'assistant'), content: reply.message, kind: 'assistant' }] } }
    }
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
    return { completed: true, state: { ...state, session: { ...current, revision, step: 'complete', reply, taskId: task.id }, outbox: [{ clientNonce: this.nonce(userId, revision, 'assistant'), content: reply.message, kind: 'assistant' }] } }
  }

  private async commit(userId: string, workspaceId: string, expectedRevision: number, state: StoredState, completed: boolean) {
    const result = await this.deps.repository.compareAndSet({ userId, expectedRevision, onboardingSession: this.serialize(state), hasSeenOnboarding: completed })
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
      const base = { actorUserId: state.userId, clientNonce: message.clientNonce, content: message.content, conversationId: state.session.conversationId, turnId: `onboarding:${state.userId}:${state.session.revision}`, workspaceId: state.session.workspaceId }
      if (message.kind === 'user') await this.deps.effects.collaboration.addMessage(base)
      else await this.deps.effects.collaboration.addAgentMessage({ ...base, authorPrincipalId: state.session.agentPrincipalId, modelId: 'onboarding:prepared' })
    }
    if (!state.outbox.length) return
    if (!await this.deps.repository.clearOutbox({ userId: state.userId, expectedRevision: state.session.revision, onboardingSession: this.serialize({ ...state, outbox: [] }) })) {
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
  private nonce(userId: string, revision: number, kind: string) { return `onboarding:${userId}:${revision}:${kind}` }
}

function isValidState(value: unknown, userId: string): value is StoredState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Record<string, unknown>
  if (state.version !== 1 || state.userId !== userId || !Array.isArray(state.outbox) || state.outbox.length > 2 || !isExactKeys(state, ['version', 'userId', 'session', 'outbox'])) return false
  if (!state.session || typeof state.session !== 'object' || Array.isArray(state.session)) return false
  const session = state.session as Record<string, unknown>
  const sessionKeys = ['version', 'revision', 'workspaceId', 'conversationId', 'agentId', 'agentPrincipalId', 'step', 'profile', 'aiEnabled', 'reply', 'employees', 'suggestions', 'createdAgentIds', 'taskId']
  if (!isExactKeys(session, session.taskId === undefined ? sessionKeys.slice(0, -1) : sessionKeys)
    || session.version !== 1
    || !Number.isInteger(session.revision)
    || (session.revision as number) < 1
    || !['name', 'about', 'daily', 'employees', 'connections', 'memories', 'teammates', 'task', 'complete'].includes(String(session.step))
    || !boundedString(session.workspaceId, 1, 200)
    || !boundedString(session.conversationId, 1, 200)
    || !boundedString(session.agentId, 1, 200)
    || !boundedString(session.agentPrincipalId, 1, 200)
    || typeof session.aiEnabled !== 'boolean'
    || !Array.isArray(session.employees)
    || !Array.isArray(session.suggestions)
    || !Array.isArray(session.createdAgentIds)) return false
  if (!session.profile || typeof session.profile !== 'object' || Array.isArray(session.profile)
    || !isExactKeys(session.profile, ['name', 'about', 'daily'])) return false
  const profile = session.profile as Record<string, unknown>
  if (!boundedString(profile.name, 0, 200) || !boundedString(profile.about, 0, 3000) || !boundedString(profile.daily, 0, 3000)) return false
  if (!session.reply || typeof session.reply !== 'object' || Array.isArray(session.reply)) return false
  const reply = session.reply as Record<string, unknown>
  if (!isValidReply(reply)) return false
  const replyKeys = ['message', 'mode', ...(Object.hasOwn(reply, 'employees') ? ['employees'] : []), ...(Object.hasOwn(reply, 'suggestions') ? ['suggestions'] : [])]
  if (!isExactKeys(reply, replyKeys)) return false
  if (session.employees.some((employee) => !isValidEmployee(employee))
    || session.suggestions.some((suggestion) => !boundedString(suggestion, 1, 3000))
    || session.createdAgentIds.some((id) => !boundedString(id, 1, 200))
    || (session.step === 'complete' ? !boundedString(session.taskId, 1, 200) : session.taskId !== undefined)) return false
  if (state.outbox.some((message) => !message || typeof message !== 'object' || Array.isArray(message)
    || !isExactKeys(message, ['clientNonce', 'content', 'kind'])
    || !boundedString((message as Record<string, unknown>).clientNonce, 1, 500)
    || !boundedString((message as Record<string, unknown>).content, 1, 8000)
    || !['user', 'assistant'].includes(String((message as Record<string, unknown>).kind)))) return false
  return true
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
