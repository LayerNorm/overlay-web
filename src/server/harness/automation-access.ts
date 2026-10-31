import 'server-only'

import { FatalError, RetryableError } from 'workflow'
import { resolveAgentGrant } from '@/server/agents/agent-tooling'
import { getOverlayServerContext } from '@/server/bootstrap'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import type { PersonalHarnessAccess } from './personal-access'

type ServerContext = ReturnType<typeof getOverlayServerContext>

export type AutomationHarnessAuthority = Extract<PersonalHarnessAccess['authentication'], { type: 'automation' }>

export type AutomationSourceGrant = {
  approvalMode: 'ask' | 'auto'
  allowedToolIds: string[]
}

function assertBoundResource(
  access: PersonalHarnessAccess,
  automation: { _id: string; userId?: string; workspaceId?: string; conversationId?: string; sourceConversationId?: string },
  conversation: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getConversationById']>>,
  workspace: Awaited<ReturnType<ServerContext['workspaceService']['resolveActiveWorkspace']>>,
): void {
  const authority = access.authentication
  if (authority.type !== 'automation') throw new FatalError('Automation authority is required.')
  const expectedConversationId = automation.conversationId || automation.sourceConversationId
  if (automation._id !== authority.automationId
    || automation.userId !== access.actorUserId
    || (automation.workspaceId && automation.workspaceId !== access.workspaceId)
    || (expectedConversationId && expectedConversationId !== access.conversationId)
    || workspace.workspace.id !== access.workspaceId
    || workspace.principal.id !== access.principalId
    || !conversation
    || conversation.userId !== access.actorUserId
    || conversation.deletedAt != null
    || (conversation.workspaceId && conversation.workspaceId !== access.workspaceId)
    || (conversation.conversationType && conversation.conversationType !== 'personal')) {
    throw new FatalError('Automation source authorization changed.')
  }
}

async function readAutomationRecord(
  access: PersonalHarnessAccess,
  server: ServerContext,
) {
  const authority = access.authentication
  if (authority.type !== 'automation') throw new FatalError('Automation authority is required.')
  if (authority.automationRunId) {
    const payload = await server.appData.repositories.automations.getRunForExecution({
      runId: authority.automationRunId,
    })
    if (!payload || payload.run._id !== authority.automationRunId
      || payload.run.status !== 'running'
      || payload.run.userId !== access.actorUserId
      || payload.run.automationId !== authority.automationId) {
      throw new FatalError('Automation run is no longer authorized.')
    }
    if (!payload.run.workflowRunId) {
      throw new RetryableError('Automation workflow ownership is not acknowledged yet.')
    }
    if (payload.run.workflowRunId !== authority.originWorkflowRunId) {
      throw new FatalError('Automation workflow ownership changed.')
    }
    return payload.automation
  }
  const automation = await server.appData.repositories.automations.getAutomation({
    automationId: authority.automationId,
    userId: access.actorUserId,
  })
  if (!automation || automation.deletedAt || automation.enabled === false) {
    throw new FatalError('Automation is no longer enabled.')
  }
  if (!automation.schedulerWorkflowRunId) {
    throw new RetryableError('Automation scheduler ownership is not acknowledged yet.')
  }
  if (automation.schedulerWorkflowRunId !== authority.originWorkflowRunId) {
    throw new FatalError('Automation scheduler ownership changed.')
  }
  return automation
}

export async function refreshAutomationHarnessSource(
  access: PersonalHarnessAccess,
  context: Pick<PersonalChatWorkToolingContext, 'accountAllowedToolIds' | 'approvalMode'>,
  options: { requireDelivery?: boolean } = {},
): Promise<AutomationSourceGrant> {
  const server = getOverlayServerContext()
  const authority = access.authentication
  if (authority.type !== 'automation') throw new FatalError('Automation authority is required.')
  const automation = await readAutomationRecord(access, server)
  const [workspace, conversation, agentRun] = await Promise.all([
    server.workspaceService.resolveActiveWorkspace(access.actorUserId, access.workspaceId),
    server.appData.repositories.conversations.getConversationById({
      conversationId: access.conversationId as never,
      userId: access.actorUserId,
      workspaceId: access.workspaceId,
    }),
    options.requireDelivery === false ? Promise.resolve(null) : server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: access.conversationId as never,
      userId: access.actorUserId,
      agentRunId: access.agentRunId,
    }),
  ])
  assertBoundResource(access, automation, conversation, workspace)
  if (options.requireDelivery !== false
    && (!agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
      || agentRun.conversationId !== access.conversationId
      || agentRun.runner !== 'workflow' || agentRun.executionEngine !== 'overlay_harness'
      || agentRun.mode === 'room')) {
    throw new FatalError('Automation delivery ownership changed.')
  }

  const agentId = automation.agentId
  if (!agentId) return { approvalMode: 'ask', allowedToolIds: context.accountAllowedToolIds ?? [] }
  const agent = await server.workspaceAgentService.get({
    actorUserId: access.actorUserId,
    workspaceId: access.workspaceId,
    agentId,
  })
  if (agent.harness !== 'overlay' || agent.archivedAt) {
    throw new FatalError('The bound automation agent is no longer available.')
  }
  const grant = resolveAgentGrant({
    agentId,
    allowedToolIds: agent.allowedToolIds,
    isDefaultMaster: agent.isDefault === true,
  })
  const accountToolIds = context.accountAllowedToolIds ?? []
  return {
    approvalMode: agent.permissionMode === 'auto' ? 'auto' : 'ask',
    allowedToolIds: accountToolIds.filter(toolId => grant.overlayToolIds.includes(toolId)),
  }
}

export async function assertAutomationAdmissionSource(input: {
  automationId: string
  runId?: string
  originWorkflowRunId: string
  actorUserId: string
  workspaceId?: string
  conversationId?: string
}): Promise<{ workspaceId: string; principalId: string; conversationId?: string; automationRunId?: string }> {
  const server = getOverlayServerContext()
  const payload = input.runId
    ? await server.appData.repositories.automations.getRunForExecution({ runId: input.runId })
    : await server.appData.repositories.automations.getAutomation({ automationId: input.automationId, userId: input.actorUserId })
  if (!payload) throw new FatalError('Automation source is not available.')
  const automation = 'automation' in payload ? payload.automation : payload
  if (automation._id !== input.automationId || automation.userId !== input.actorUserId
    || automation.deletedAt || automation.enabled === false) {
    throw new FatalError('Automation source is not available.')
  }
  if (input.runId) {
    const run = (payload as Awaited<ReturnType<ServerContext['appData']['repositories']['automations']['getRunForExecution']>>)?.run
    if (!run || run.status !== 'running' || run.automationId !== input.automationId || run.userId !== input.actorUserId) {
      throw new FatalError('Automation run is not executable.')
    }
    if (!run.workflowRunId) throw new RetryableError('Automation workflow ownership is not acknowledged yet.')
    if (run.workflowRunId !== input.originWorkflowRunId) throw new FatalError('Automation workflow ownership changed.')
  } else {
    if (!automation.schedulerWorkflowRunId) throw new RetryableError('Automation scheduler ownership is not acknowledged yet.')
    if (automation.schedulerWorkflowRunId !== input.originWorkflowRunId) throw new FatalError('Automation scheduler ownership changed.')
  }
  const workspace = await server.workspaceService.resolveActiveWorkspace(input.actorUserId, input.workspaceId)
  const conversationId = input.conversationId || automation.conversationId
  if (conversationId) {
    const conversation = await server.appData.repositories.conversations.getConversationById({
      conversationId: conversationId as never, userId: input.actorUserId, workspaceId: workspace.workspace.id,
    })
    if (!conversation || conversation.userId !== input.actorUserId || conversation.deletedAt != null
      || (conversation.workspaceId && conversation.workspaceId !== workspace.workspace.id)
      || (conversation.conversationType && conversation.conversationType !== 'personal')) {
      throw new FatalError('Automation conversation ownership changed.')
    }
  }
  return {
    workspaceId: workspace.workspace.id,
    principalId: workspace.principal.id,
    conversationId,
    ...(input.runId ? { automationRunId: input.runId } : {}),
  }
}
