import 'server-only'

import { FatalError } from 'workflow'
import { resumeHook } from 'workflow/api'
import type { HarnessWait, HarnessWaitRequest } from '@overlay/agent-runtime/harness-store'
import { getOverlayServerContext } from '@/server/bootstrap'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { isTerminalAgentRunStatus } from '@/shared/agents/agent-run'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { PersonalHarnessAccess } from './personal-access'
import type { HarnessExecutionReference } from './state-steps'
import { harnessWakeToken } from './wait-token'
export { harnessWakeToken }

type PersonalDeliveryRepository = ReturnType<typeof getOverlayServerContext>['appData']['repositories']['conversations']
type PersonalDeliveryRun = NonNullable<Awaited<ReturnType<PersonalDeliveryRepository['getLatestAgentRun']>>>

function assertPersonalWaitDeliveryOwnership(
  run: PersonalDeliveryRun | null,
  access: PersonalHarnessAccess,
  rootRunId: string,
): asserts run is PersonalDeliveryRun {
  if (!run || run.userId !== access.actorUserId || run.conversationId !== access.conversationId
    || run.harnessRunId !== rootRunId || run.runner !== 'workflow' || run.executionEngine !== 'overlay_harness' || run.mode === 'room'
    || run.workflowRunId !== access.workflowRunId) {
    throw new FatalError('Conversation wait ownership changed.')
  }
}

export async function publishHarnessWait(reference: HarnessExecutionReference, request: HarnessWaitRequest) {
  'use step'
  return new ConvexHarnessRepository().publishWait({ ...reference, request })
}

export async function resolveHarnessWait(reference: HarnessExecutionReference, token: string) {
  'use step'
  await new ConvexHarnessRepository().resolveWait({ ...reference, token })
}

export async function listHarnessWaits(reference: HarnessExecutionReference) {
  'use step'
  return new ConvexHarnessRepository().listPendingWaits(reference)
}

export async function readHarnessChild(reference: HarnessExecutionReference, childRunId: string) {
  'use step'
  const repository = new ConvexHarnessRepository()
  const parent = await repository.get(reference)
  if (!parent || parent.workflowRunId !== reference.workflowRunId
    || !parent.children.some(child => child.id === childRunId)) throw new FatalError('Invalid child authority.')
  const child = await repository.get({ actorUserId: reference.actorUserId, runId: childRunId })
  if (!child || child.parentRunId !== parent.runId || child.rootRunId !== parent.rootRunId) {
    throw new FatalError('Invalid child lineage.')
  }
  return child
}

// Persist the changed state before notifying. Duplicate notifications only wake
// a reader; they never authorize execution or settle a child themselves.
export async function notifyHarnessAncestors(reference: HarnessExecutionReference) {
  'use step'
  const repository = new ConvexHarnessRepository()
  let state = await repository.get(reference)
  if (!state || state.workflowRunId !== reference.workflowRunId) throw new FatalError('Invalid wake authority.')
  const rootRunId = state.rootRunId
  const seen = new Set([state.runId])
  while (state.parentRunId) {
    if (seen.has(state.parentRunId) || seen.size > 32) throw new FatalError('Invalid wake lineage.')
    seen.add(state.parentRunId)
    state = await repository.get({ actorUserId: reference.actorUserId, runId: state.parentRunId })
    if (!state || state.rootRunId !== rootRunId || !state.workflowRunId) throw new FatalError('Missing wake parent.')
    if (['completed', 'cancelled', 'failed'].includes(state.status)) continue
    try {
      await resumeHook(harnessWakeToken(state.workflowRunId), { childRunId: reference.runId })
    } catch (error) {
      const latest = await repository.get({ actorUserId: reference.actorUserId, runId: state.runId })
      if (!latest || !['completed', 'cancelled', 'failed'].includes(latest.status)) throw error
    }
  }
}

// Only the root projects human attention onto the conversation. A child asking
// for approval must not pause a parent that is still doing independent work.
export async function projectPersonalHarnessWait(
  access: PersonalHarnessAccess,
  projection: { wait: HarnessWait } | { status: 'running' | 'waiting_for_children' },
): Promise<'projected' | 'stale' | 'inactive'> {
  'use step'
  const repository = new ConvexHarnessRepository()
  const state = await repository.get(access)
  if (!state || state.parentRunId || state.workflowRunId !== access.workflowRunId) {
    throw new FatalError('Only the owning root may project conversation waits.')
  }
  if (['completed', 'cancelled', 'failed'].includes(state.status)) return 'inactive'
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const run = await conversations.getLatestAgentRun({
    conversationId: asConversationId(access.conversationId), userId: access.actorUserId, agentRunId: access.agentRunId,
  })
  assertPersonalWaitDeliveryOwnership(run, access, state.runId)
  if (isTerminalAgentRunStatus(run.status)) return 'inactive'
  const wait = 'wait' in projection
    ? (await repository.listPendingWaits(access)).find(candidate => candidate.token === projection.wait.token)
    : undefined
  if ('wait' in projection && !wait) return 'stale'
  const status = wait ? (wait.kind === 'input' ? 'waiting_for_input' : 'waiting_for_approval')
    : (projection as { status: 'running' | 'waiting_for_children' }).status
  if (run.status === status && (!wait || (wait.kind === 'input'
    ? run.inputRequest?.token === wait.token : run.approval?.token === wait.token))) return 'projected'
  const identity = { runId: access.agentRunId, userId: access.actorUserId, expectedWorkflowRunId: access.workflowRunId }
  if (run.status !== 'running') await conversations.transitionAgentRun({ ...identity, status: 'running' })
  if (status !== 'running') await conversations.transitionAgentRun({
    ...identity, status,
    ...(wait?.kind === 'input' ? { inputRequest: { token: wait.token, question: wait.question, requestedAt: wait.createdAt } } : {}),
    ...(wait?.kind === 'approval' ? { approval: { token: wait.token, title: wait.question, requestedAt: wait.createdAt, requests: wait.requests } } : {}),
  })
  return 'projected'
}
