import 'server-only'

import { FatalError } from 'workflow'
import { automationService } from '@/server/automations/http'
import {
  ensureAutomationConversation,
  type AutomationAgentTurnInput,
} from '@/server/automations/automation-turn-runner'
import { getOverlayServerContext } from '@/server/bootstrap'
import { agentRunService } from '@/server/conversations/http'
import { isHarnessBackendReady } from '@/server/harness/backend-readiness'
import { assertAutomationAdmissionSource } from '@/server/harness/automation-access'
import { ConvexHarnessRepository } from '@/server/harness/ConvexHarnessRepository'
import type { PersonalHarnessAccess } from '@/server/harness/personal-access'
import { personalHarnessPolicy } from '@/server/harness/personal-admission-policy'
import { harnessToolsRequirePlan } from '@/server/harness/write-tools'

async function ensureConversationStep(input: AutomationAgentTurnInput): Promise<{
  conversationId: string
  workspaceId: string
}> {
  'use step'
  return await ensureAutomationConversation(input)
}

async function settleOwnedAutomationRunStep(input: {
  automationId: string
  conversationId?: string
  error?: string
  runId?: string
  status: 'completed' | 'failed' | 'cancelled' | 'skipped'
  turnId?: string
  userId: string
  workflowRunId: string
}): Promise<boolean> {
  'use step'
  if (!input.runId) return true
  const payload = await getOverlayServerContext().appData.repositories.automations
    .getRunForExecution({ runId: input.runId })
  if (!payload || payload.run.userId !== input.userId
    || payload.run.automationId !== input.automationId
    || payload.run.workflowRunId !== input.workflowRunId
    || (input.turnId && payload.run.turnId !== input.turnId)) return false
  return await automationService.settleRun({
    runId: input.runId,
    userId: input.userId,
    expectedWorkflowRunId: input.workflowRunId,
    expectedStatus: payload.run.status,
    expectedTurnId: payload.run.turnId,
    status: input.status,
    conversationId: input.conversationId,
    error: input.error,
  })
}

async function readAutomationDeliveryStep(input: {
  conversationId: string
  agentRunId: string
  userId: string
}): Promise<string> {
  'use step'
  const conversations = getOverlayServerContext().appData.repositories.conversations
  const [run, messages] = await Promise.all([
    conversations.getLatestAgentRun({
      conversationId: input.conversationId as never, userId: input.userId, agentRunId: input.agentRunId,
    }),
    conversations.getConversationMessages({
      conversationId: input.conversationId as never, userId: input.userId,
    }),
  ])
  if (!run || run.id !== input.agentRunId || run.userId !== input.userId) return ''
  return messages.find(message => message.role === 'assistant' && message.turnId === run.turnId)?.content ?? ''
}

async function reconcileAutomationHarnessTerminalStep(input: {
  access: PersonalHarnessAccess
  automationId: string
  runId?: string
  turnId: string
  userId: string
  workflowRunId: string
}): Promise<'completed' | 'failed' | 'cancelled' | null> {
  'use step'
  const { ConvexHarnessRepository } = await import('@/server/harness/ConvexHarnessRepository')
  const snapshot = await new ConvexHarnessRepository().get(input.access)
  if (!snapshot || snapshot.workflowRunId !== input.workflowRunId
    || !['completed', 'failed', 'cancelled'].includes(snapshot.status)) return null
  if (input.runId) {
    const payload = await getOverlayServerContext().appData.repositories.automations
      .getRunForExecution({ runId: input.runId })
    if (!payload || payload.run.userId !== input.userId || payload.run.automationId !== input.automationId
      || payload.run.workflowRunId !== input.workflowRunId || payload.run.turnId !== input.turnId) return null
    const settled = await automationService.settleRun({
      runId: input.runId,
      userId: input.userId,
      expectedWorkflowRunId: input.workflowRunId,
      expectedStatus: payload.run.status,
      expectedTurnId: input.turnId,
      status: snapshot.status as 'completed' | 'failed' | 'cancelled',
      conversationId: input.access.conversationId,
      error: snapshot.terminalReason,
    })
    if (!settled) return null
  }
  return snapshot.status as 'completed' | 'failed' | 'cancelled'
}

export async function settleDeniedAutomationRun(input: {
  automationId: string
  runId: string
  userId: string
  workflowRunId: string
  reason: string
}): Promise<boolean> {
  'use step'
  const payload = await getOverlayServerContext().appData.repositories.automations
    .getRunForExecution({ runId: input.runId })
  if (!payload || payload.run.userId !== input.userId || payload.run.automationId !== input.automationId
    || payload.run.workflowRunId !== input.workflowRunId || payload.run.turnId !== undefined) return false
  return await automationService.settleRun({
    runId: input.runId,
    userId: input.userId,
    expectedWorkflowRunId: input.workflowRunId,
    expectedStatus: payload.run.status,
    expectedTurnId: payload.run.turnId,
    status: 'skipped',
    error: input.reason,
  })
}

async function admitAutomationSourceStep(input: AutomationAgentTurnInput & {
  originWorkflowRunId: string
  actorUserId?: string
  conversationId?: string
}) {
  'use step'
  const server = getOverlayServerContext()
  let settings
  try {
    settings = await server.appData.repositories.conversations.getAppSettings({ userId: input.userId })
  } catch (_error) {
    throw new FatalError('Harness backend is unavailable.')
  }
  if (!isHarnessBackendReady(settings)) throw new FatalError('Harness backend is unavailable.')
  if (!input.automationId) throw new FatalError('Automation identity is required.')
  return await assertAutomationAdmissionSource({
    ...input, automationId: input.automationId, actorUserId: input.actorUserId ?? input.userId,
  })
}

async function startAutomationRunStep(input: {
  automationId: string
  runId?: string
  userId: string
  workflowRunId: string
  conversationId: string
  turnId: string
  workspaceId: string
}) {
  'use step'
  if (input.runId) {
    await automationService.markRunStarted({
      runId: input.runId,
      userId: input.userId,
      conversationId: input.conversationId,
      turnId: input.turnId,
      expectedWorkflowRunId: input.workflowRunId,
    })
  }
  return await assertAutomationAdmissionSource({
    automationId: input.automationId,
    actorUserId: input.userId,
    originWorkflowRunId: input.workflowRunId,
    runId: input.runId,
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    turnId: input.turnId,
  })
}

async function startAutomationAgentRunStep(input: {
  conversationId: string
  modelId: string
  turnId: string
  userId: string
  userMessageId: string
}) {
  'use step'
  const run = await agentRunService.startPersonalWorkflow({
    conversationId: input.conversationId as never,
    modelId: input.modelId,
    turnId: input.turnId,
    userId: input.userId,
    userMessageId: input.userMessageId as never,
  })
  if (!run) throw new FatalError('Automation AgentRun could not be admitted.')
  return run
}

async function admitAutomationHarnessStep(input: {
  runId: string
  goal: string
  actorUserId: string
  workspaceId: string
  modelId: string
  paid: boolean
  createdAt: number
  allowedToolIds: string[]
  conversationId: string
  deliveryAgentRunId: string
}) {
  'use step'
  return await new ConvexHarnessRepository().admit({
    runId: `personal:${input.deliveryAgentRunId}`,
    goal: input.goal.slice(0, 32_000) || 'Respond to the automation instructions.',
    constraints: [],
    policy: personalHarnessPolicy({
      actorUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      allowedToolIds: input.allowedToolIds,
      requiresPlan: harnessToolsRequirePlan(input.allowedToolIds),
      modelId: input.modelId,
      paid: input.paid,
      createdAt: input.createdAt,
    }),
    source: { conversationId: input.conversationId },
    deliveryAgentRunId: input.deliveryAgentRunId,
  })
}

/**
 * Safety-net status check for the scheduling loop — reads the automation row
 * directly instead of the old self-HTTP call.
 */
export async function checkAutomationEnabled(input: {
  automationId: string
  userId: string
}): Promise<{ enabled: boolean; deleted: boolean }> {
  'use step'
  try {
    const automation = await automationService.getAutomationForExecution({
      automationId: input.automationId,
      userId: input.userId,
    })
    if (!automation) return { enabled: false, deleted: true }
    return { enabled: automation.enabled === true, deleted: false }
  } catch (_error) {
    return { enabled: true, deleted: false }
  }
}

export {
  admitAutomationHarnessStep,
  admitAutomationSourceStep,
  ensureConversationStep,
  readAutomationDeliveryStep,
  reconcileAutomationHarnessTerminalStep,
  settleOwnedAutomationRunStep,
  startAutomationAgentRunStep,
  startAutomationRunStep,
}
