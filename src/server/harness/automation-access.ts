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
  assertRefreshSourceBinding({ authority, access, automation, run, targetConversationId, turnId: context.turnId })
  assertRefreshWorkspaceBinding(access, workspace.workspace.id, workspace.principal.id)
  assertConversation(conversation, access.actorUserId, access.workspaceId)
  assertRefreshDeliveryBinding(options.requireDelivery, agentRun, access, context.turnId)
  return await resolveAutomationSourceGrant(server.workspaceAgentService, automation, access, context)
}

function assertRefreshSourceBinding(args: {
  authority: Extract<PersonalHarnessAccess['authentication'], { type: 'automation' }>
  access: PersonalHarnessAccess
  automation: AutomationRecord
  run?: Source['run']
  targetConversationId?: string
  turnId: string
}) {
  const { authority, access, automation, run, targetConversationId, turnId } = args
  if (automation._id !== authority.automationId || automation.userId !== access.actorUserId
    || (automation.workspaceId && automation.workspaceId !== access.workspaceId)
    || (targetConversationId && targetConversationId !== access.conversationId)
    || (run?.conversationId && run.conversationId !== access.conversationId)
    || (run?.turnId && run.turnId !== turnId)) {
    throw new FatalError('Automation source authorization changed.')
  }
}

function assertRefreshWorkspaceBinding(
  access: PersonalHarnessAccess,
  workspaceId: string,
  principalId: string,
) {
  if (workspaceId !== access.workspaceId || principalId !== access.principalId) {
    throw new FatalError('Automation source authorization changed.')
  }
}

function assertRefreshDeliveryBinding(
  requireDelivery: boolean | undefined,
  agentRun: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getLatestAgentRun']>> | null,
  access: PersonalHarnessAccess,
  turnId: string,
) {
  if (requireDelivery !== false
    && (!agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
      || agentRun.conversationId !== access.conversationId || agentRun.turnId !== turnId
      || agentRun.runner !== 'workflow' || agentRun.executionEngine !== 'overlay_harness' || agentRun.mode === 'room')) {
    throw new FatalError('Automation delivery ownership changed.')
  }
}

async function resolveAutomationSourceGrant(
  agentService: ServerContext['workspaceAgentService'],
  automation: AutomationRecord,
  access: PersonalHarnessAccess,
  context: Pick<PersonalChatWorkToolingContext,
    'accountAllowedToolIds' | 'accountAllowedConnectorIds' | 'integrationToolIds'>,
): Promise<AutomationSourceGrant> {
  if (!automation.agentId) {
    return { approvalMode: 'ask', allowedToolIds: context.accountAllowedToolIds ?? [],
      allowedConnectorIds: context.accountAllowedConnectorIds ?? [] }
  }
  const agent = await agentService.get({
    actorUserId: access.actorUserId, workspaceId: access.workspaceId, agentId: automation.agentId,
  })
  if (agent.harness !== 'overlay' || agent.archivedAt) {
    throw new FatalError('The bound automation agent is no longer available.')
  }
  const grant = resolveAgentGrant({
    agentId: automation.agentId, allowedToolIds: agent.allowedToolIds, isDefaultMaster: agent.isDefault === true,
  })
  const allowedConnectorIds = grant.capabilities.has('integrations') ? context.accountAllowedConnectorIds ?? [] : []
  return {
    approvalMode: agent.permissionMode === 'auto' ? 'auto' : 'ask',
    allowedToolIds: [
      ...(context.accountAllowedToolIds ?? []).filter(id => grant.overlayToolIds.includes(id)),
      ...(allowedConnectorIds.length ? context.integrationToolIds ?? [] : []),
    ],
    allowedConnectorIds,
  }
}

type AutomationAdmissionInput = {
  automationId: string
  runId?: string
  originWorkflowRunId: string
  actorUserId: string
  workspaceId?: string
  conversationId?: string
  turnId?: string
}

type AutomationAdmissionSource = {
  automation: AutomationRecord
  run?: Source['run']
}

async function readAutomationAdmissionSource(
  input: AutomationAdmissionInput,
  server: ServerContext,
): Promise<AutomationAdmissionSource> {
  if (input.runId) {
    const payload = await server.appData.repositories.automations.getRunForExecution({ runId: input.runId })
    if (!payload) throw new FatalError('Automation run is not available.')
    assertAdmissionRunOwner(input, payload.automation as AutomationRecord, payload.run)
    return { automation: payload.automation as AutomationRecord, run: payload.run }
  }
  const automation = await server.appData.repositories.automations.getAutomation({
    automationId: input.automationId, userId: input.actorUserId,
  }) as AutomationRecord
  assertAdmissionSchedulerOwner(input, automation)
  return { automation }
}

function assertAdmissionRunOwner(
  input: AutomationAdmissionInput,
  automation: AutomationRecord,
  run: NonNullable<Source['run']>,
): void {
  if (run._id !== input.runId || run.automationId !== input.automationId || run.userId !== input.actorUserId
    || !['queued', 'running'].includes(run.status) || isDeleted(automation)) {
    throw new FatalError('Automation run is not executable.')
  }
  if (!run.workflowRunId) throw new RetryableError('Automation workflow ownership is not acknowledged yet.')
  if (run.workflowRunId !== input.originWorkflowRunId) throw new FatalError('Automation workflow ownership changed.')
}

function assertAdmissionSchedulerOwner(
  input: AutomationAdmissionInput,
  automation: AutomationRecord,
): void {
  if (!automation || isDeleted(automation) || automation.enabled !== true) {
    throw new FatalError('Automation is no longer enabled.')
  }
  if (!automation.schedulerWorkflowRunId) throw new RetryableError('Automation scheduler ownership is not acknowledged yet.')
  if (automation.schedulerWorkflowRunId !== input.originWorkflowRunId) {
    throw new FatalError('Automation scheduler ownership changed.')
  }
}

function assertAdmissionRecordBinding(
  input: AutomationAdmissionInput,
  automation: AutomationRecord,
  run: Source['run'],
  targetConversationId?: string,
  canonicalTurnId = '',
): void {
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
}

async function resolveAdmissionWorkspace(
  input: AutomationAdmissionInput,
  server: ServerContext,
  automation: AutomationRecord,
) {
  const canonicalWorkspaceId = automation.workspaceId ?? input.workspaceId
  const workspace = await server.workspaceService.resolveActiveWorkspace(input.actorUserId, canonicalWorkspaceId)
  if ((canonicalWorkspaceId && workspace.workspace.id !== canonicalWorkspaceId)
    || (input.workspaceId && workspace.workspace.id !== input.workspaceId)) {
    throw new FatalError('Automation workspace ownership changed.')
  }
  return workspace
}

async function validateAdmissionConversation(
  input: AutomationAdmissionInput,
  server: ServerContext,
  conversationId: string | undefined,
  workspaceId: string,
): Promise<void> {
  if (!conversationId) return
  const conversation = await server.appData.repositories.conversations.getConversationById({
    conversationId: conversationId as never, userId: input.actorUserId, workspaceId,
  })
  assertConversation(conversation, input.actorUserId, workspaceId)
}

export async function assertAutomationAdmissionSource(input: AutomationAdmissionInput): Promise<{
  workspaceId: string
  principalId: string
  conversationId?: string
  turnId: string
  automationRunId?: string
}> {
  const server = getOverlayServerContext()
  const { automation, run } = await readAutomationAdmissionSource(input, server)
  const targetConversationId = ownedConversationId(automation)
  const canonicalTurnId = input.runId ? `automation-run:${input.runId}` : input.turnId ?? ''
  assertAdmissionRecordBinding(input, automation, run, targetConversationId, canonicalTurnId)
  const workspace = await resolveAdmissionWorkspace(input, server, automation)
  const conversationId = targetConversationId ?? run?.conversationId
  await validateAdmissionConversation(input, server, conversationId, workspace.workspace.id)
  return {
    workspaceId: workspace.workspace.id,
    principalId: workspace.principal.id,
    conversationId,
    turnId: canonicalTurnId,
    ...(input.runId ? { automationRunId: input.runId } : {}),
  }
}
