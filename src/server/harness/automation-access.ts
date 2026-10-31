import 'server-only'

import { FatalError, RetryableError } from 'workflow'
import { resolveAgentGrant } from '@/server/agents/agent-tooling'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import type { PersonalHarnessAccess } from './personal-access'

type ServerContext = ReturnType<typeof getOverlayServerContext>
type AutomationRecord = Awaited<ReturnType<ServerContext['appData']['repositories']['automations']['getAutomation']>> extends infer T
  ? NonNullable<T> & { workspaceId?: string }
  : never

type Source = {
  automation: AutomationRecord
  run?: NonNullable<Awaited<ReturnType<ServerContext['appData']['repositories']['automations']['getRunForExecution']>>>['run']
}

export type AutomationSourceGrant = {
  approvalMode: 'ask' | 'auto'
  allowedToolIds: string[]
  allowedConnectorIds: string[]
}

function isDeleted(automation: AutomationRecord): boolean {
  return Boolean(automation.deletedAt || automation.archivedAt)
}

async function readSource(
  access: PersonalHarnessAccess,
  options: { allowQueued?: boolean } = {},
): Promise<Source> {
  const authority = access.authentication
  if (authority.type !== 'automation') throw new FatalError('Automation authority is required.')
  const repository = getOverlayServerContext().appData.repositories.automations
  if (authority.automationRunId) {
    const payload = await repository.getRunForExecution({ runId: authority.automationRunId })
    const run = payload?.run
    if (!payload || !run || run._id !== authority.automationRunId
      || run.userId !== access.actorUserId || run.automationId !== authority.automationId
      || (run.status !== 'running' && !(options.allowQueued && run.status === 'queued'))
      || isDeleted(payload.automation as AutomationRecord)) {
      throw new FatalError('Automation run is no longer authorized.')
    }
    if (!run.workflowRunId) throw new RetryableError('Automation workflow ownership is not acknowledged yet.')
    if (run.workflowRunId !== authority.originWorkflowRunId) {
      throw new FatalError('Automation workflow ownership changed.')
    }
    return { automation: payload.automation as AutomationRecord, run }
  }
  const automation = await repository.getAutomation({
    automationId: authority.automationId,
    userId: access.actorUserId,
    workspaceId: access.workspaceId,
  }) as AutomationRecord | null
  if (!automation || isDeleted(automation) || automation.enabled !== true) {
    throw new FatalError('Automation is no longer enabled.')
  }
  if (!automation.schedulerWorkflowRunId) {
    throw new RetryableError('Automation scheduler ownership is not acknowledged yet.')
  }
  if (automation.schedulerWorkflowRunId !== authority.originWorkflowRunId) {
    throw new FatalError('Automation scheduler ownership changed.')
  }
  return { automation }
}

function ownedConversationId(automation: AutomationRecord): string | undefined {
  if (!automation.conversationId || automation.conversationId === automation.sourceConversationId) return undefined
  return automation.conversationId
}

function assertConversation(
  conversation: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getConversationById']>>,
  actorUserId: string,
  workspaceId: string,
): void {
  if (!conversation || conversation.userId !== actorUserId || conversation.deletedAt != null
    || conversation.workspaceId !== workspaceId
    || conversation.conversationType && conversation.conversationType !== 'personal') {
    throw new FatalError('Automation conversation ownership changed.')
  }
}

export async function refreshAutomationHarnessSource(
  access: PersonalHarnessAccess,
  context: Pick<PersonalChatWorkToolingContext,
    'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds' | 'approvalMode' | 'turnId'>,
  options: { requireDelivery?: boolean } = {},
): Promise<AutomationSourceGrant> {
  const server = getOverlayServerContext()
  const authority = access.authentication
  if (authority.type !== 'automation') throw new FatalError('Automation authority is required.')
  const { automation, run } = await readSource(access)
  const [workspace, conversation, agentRun] = await Promise.all([
    server.workspaceService.resolveActiveWorkspace(access.actorUserId, access.workspaceId),
    server.appData.repositories.conversations.getConversationById({
      conversationId: access.conversationId as never, userId: access.actorUserId, workspaceId: access.workspaceId,
    }),
    options.requireDelivery === false ? Promise.resolve(null) : server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: access.conversationId as never, userId: access.actorUserId, agentRunId: access.agentRunId,
    }),
  ])
  const targetConversationId = ownedConversationId(automation)
  if (automation._id !== authority.automationId || automation.userId !== access.actorUserId
    || (automation.workspaceId && automation.workspaceId !== access.workspaceId)
    || (targetConversationId && targetConversationId !== access.conversationId)
    || (run?.conversationId && run.conversationId !== access.conversationId)
    || (run?.turnId && run.turnId !== context.turnId)
    || workspace.workspace.id !== access.workspaceId || workspace.principal.id !== access.principalId) {
    throw new FatalError('Automation source authorization changed.')
  }
  assertConversation(conversation, access.actorUserId, access.workspaceId)
  if (options.requireDelivery !== false
    && (!agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
      || agentRun.conversationId !== access.conversationId || agentRun.turnId !== context.turnId
      || agentRun.runner !== 'workflow' || agentRun.executionEngine !== 'overlay_harness' || agentRun.mode === 'room')) {
    throw new FatalError('Automation delivery ownership changed.')
  }

  if (!automation.agentId) {
    return { approvalMode: 'ask', allowedToolIds: context.accountAllowedToolIds ?? [],
      allowedConnectorIds: context.accountAllowedConnectorIds ?? [] }
  }
  const agent = await server.workspaceAgentService.get({
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, agentId: automation.agentId,
  })
  if (agent.harness !== 'overlay' || agent.archivedAt) {
    throw new FatalError('The bound automation agent is no longer available.')
  }
  const grant = resolveAgentGrant({
    agentId: automation.agentId, allowedToolIds: agent.allowedToolIds, isDefaultMaster: agent.isDefault === true,
  })
  const capabilities = grant.capabilities
  const allowedConnectorIds = capabilities.has('integrations') ? context.accountAllowedConnectorIds ?? [] : []
  return {
    approvalMode: agent.permissionMode === 'auto' ? 'auto' : 'ask',
    allowedToolIds: [
      ...(context.accountAllowedToolIds ?? []).filter(id => grant.overlayToolIds.includes(id)),
      ...(allowedConnectorIds.length ? context.integrationToolIds ?? [] : []),
    ],
    allowedConnectorIds,
  }
}

export async function assertAutomationAdmissionSource(input: {
  automationId: string
  runId?: string
  originWorkflowRunId: string
  actorUserId: string
  workspaceId?: string
  conversationId?: string
  turnId?: string
}): Promise<{
  workspaceId: string
  principalId: string
  conversationId?: string
  turnId: string
  automationRunId?: string
}> {
  const server = getOverlayServerContext()
  let automation: AutomationRecord
  let run: Source['run']
  if (input.runId) {
    const payload = await server.appData.repositories.automations.getRunForExecution({ runId: input.runId })
    if (!payload) throw new FatalError('Automation run is not available.')
    automation = payload.automation as AutomationRecord
    run = payload.run
    if (run._id !== input.runId || run.automationId !== input.automationId || run.userId !== input.actorUserId
      || !['queued', 'running'].includes(run.status) || isDeleted(automation)) {
      throw new FatalError('Automation run is not executable.')
    }
    if (!run.workflowRunId) throw new RetryableError('Automation workflow ownership is not acknowledged yet.')
    if (run.workflowRunId !== input.originWorkflowRunId) throw new FatalError('Automation workflow ownership changed.')
  } else {
    automation = await server.appData.repositories.automations.getAutomation({
      automationId: input.automationId, userId: input.actorUserId,
    }) as AutomationRecord
    if (!automation || isDeleted(automation) || automation.enabled !== true) {
      throw new FatalError('Automation is no longer enabled.')
    }
    if (!automation.schedulerWorkflowRunId) throw new RetryableError('Automation scheduler ownership is not acknowledged yet.')
    if (automation.schedulerWorkflowRunId !== input.originWorkflowRunId) {
      throw new FatalError('Automation scheduler ownership changed.')
    }
  }
  const targetConversationId = ownedConversationId(automation)
  const canonicalTurnId = input.runId ? `automation-run:${input.runId}` : input.turnId ?? ''
  if (automation._id !== input.automationId || automation.userId !== input.actorUserId
    || (automation.workspaceId && input.workspaceId && automation.workspaceId !== input.workspaceId)
    || (targetConversationId && input.conversationId && targetConversationId !== input.conversationId)
    || (run?.conversationId && targetConversationId && run.conversationId !== targetConversationId)
    || (run?.conversationId && run.conversationId === automation.sourceConversationId)
    || (run?.conversationId && input.conversationId && run.conversationId !== input.conversationId)) {
    throw new FatalError('Automation source binding changed.')
  }
  if (run?.turnId && run.turnId !== canonicalTurnId) {
    throw new FatalError('Automation run turn binding changed.')
  }
  const canonicalWorkspaceId = automation.workspaceId ?? input.workspaceId
  const workspace = await server.workspaceService.resolveActiveWorkspace(input.actorUserId, canonicalWorkspaceId)
  if ((canonicalWorkspaceId && workspace.workspace.id !== canonicalWorkspaceId)
    || (input.workspaceId && workspace.workspace.id !== input.workspaceId)) {
    throw new FatalError('Automation workspace ownership changed.')
  }
  const conversationId = targetConversationId ?? run?.conversationId
  if (conversationId) {
    const conversation = await server.appData.repositories.conversations.getConversationById({
      conversationId: conversationId as never, userId: input.actorUserId, workspaceId: workspace.workspace.id,
    })
    assertConversation(conversation, input.actorUserId, workspace.workspace.id)
  }
  return {
    workspaceId: workspace.workspace.id,
    principalId: workspace.principal.id,
    conversationId,
    turnId: canonicalTurnId,
    ...(input.runId ? { automationRunId: input.runId } : {}),
  }
}
