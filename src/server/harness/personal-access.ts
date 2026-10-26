import 'server-only'

import { FatalError } from 'workflow'
import type { PersonalChatWorkToolingContext } from '@/shared/agents/personal-chat-work'
import { hasRequiredApiKeyScopes } from '@/shared/auth/api-key-scopes'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { getOverlayServerContext } from '@/server/bootstrap'
import { assertUserCanUseByokModel } from '@/server/ai/model-runtime'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { actEntitlementService } from '@/server/conversations/http'
import { ConvexHarnessRepository } from './ConvexHarnessRepository'
import type { HarnessExecutionReference } from './state-steps'

export type PersonalHarnessAccess = HarnessExecutionReference & {
  conversationId: string
  agentRunId: string
  workspaceId: string
  principalId: string
  authentication: { type: 'session' | 'access-token' } | { type: 'api-key'; apiKeyId: string }
}

export type PersonalHarnessExecutionContext = PersonalChatWorkToolingContext & {
  requiresZeroDataRetention: boolean
}

// Call inside the model/tool step, not only in an earlier preparation step:
// a durable replay must not reuse a permission decision made before a wait.
export async function refreshPersonalHarnessAccess(
  access: PersonalHarnessAccess,
  context: Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'>,
  toolName?: string,
): Promise<PersonalHarnessExecutionContext> {
  if (context.userId !== access.actorUserId || context.workspaceId !== access.workspaceId
    || context.conversationId !== access.conversationId || context.automationExecution
    || context.automationId || context.approvalMode === 'auto') {
    throw new FatalError('Personal harness identity does not match its tooling context.')
  }
  if (!access.workspaceId || !access.principalId || !access.conversationId) {
    throw new FatalError('Personal harness identity is incomplete.')
  }
  const repository = new ConvexHarnessRepository()
  const state = await repository.get({ actorUserId: access.actorUserId, runId: access.runId })
  if (!state || state.workflowRunId !== access.workflowRunId || state.status !== 'running'
    || state.policy.actorUserId !== access.actorUserId || state.policy.workspaceId !== access.workspaceId
    || state.policy.deadlineAt <= Date.now()) {
    throw new FatalError('Personal harness execution is not authorized to continue.')
  }
  if (toolName && !state.policy.allowedToolIds.includes(toolName)) {
    throw new FatalError('Tool is outside this harness run\'s capabilities.')
  }
  const root = state.parentRunId
    ? await repository.get({ actorUserId: access.actorUserId, runId: state.rootRunId })
    : state
  if (!root?.workflowRunId || root.policy.actorUserId !== access.actorUserId
    || root.policy.workspaceId !== access.workspaceId || ['completed', 'cancelled', 'failed'].includes(root.status)) {
    throw new FatalError('The root harness execution is no longer active.')
  }

  const server = getOverlayServerContext()
  if (access.authentication.type === 'api-key') {
    const apiKeyId = access.authentication.apiKeyId
    const key = (await server.appData.repositories.apiKeys.listByUser({ userId: access.actorUserId }))
      .find(key => key.id === apiKeyId)
    if (!key || key.userId !== access.actorUserId || key.revokedAt != null
      || key.expiresAt <= Date.now() || !hasRequiredApiKeyScopes(key.scopes, ['chat:write'])) {
      throw new FatalError('The API key that authorized this run is no longer permitted.')
    }
  } else if (access.authentication.type !== 'session' && access.authentication.type !== 'access-token') {
    throw new FatalError('Personal harness authentication is not supported.')
  }
  const [workspace, conversation, agentRun, subject] = await Promise.all([
    server.workspaceService.resolveActiveWorkspace(access.actorUserId, access.workspaceId),
    server.appData.repositories.conversations.getConversationById({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId,
      workspaceId: access.workspaceId,
    }),
    server.appData.repositories.conversations.getLatestAgentRun({
      conversationId: asConversationId(access.conversationId), userId: access.actorUserId,
      agentRunId: access.agentRunId,
    }),
    server.authorizationService.resolveSubject(access.actorUserId),
  ])
  if (workspace.workspace.id !== access.workspaceId || workspace.principal.id !== access.principalId
    || !conversation || conversation.userId !== access.actorUserId || conversation.deletedAt != null
    || (conversation.workspaceId && conversation.workspaceId !== access.workspaceId)
    || (conversation.conversationType && conversation.conversationType !== 'personal')
    || !agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
    || agentRun.conversationId !== access.conversationId || agentRun.workflowRunId !== root.workflowRunId
    || agentRun.runner !== 'workflow' || agentRun.mode === 'room'
    || (agentRun.status !== 'running' && !(state.parentRunId
      && ['waiting_for_approval', 'waiting_for_input', 'waiting_for_children'].includes(agentRun.status)))) {
    throw new FatalError('Personal harness resource access has changed.')
  }
  const authorization = server.authorizationService
  if (!authorization.checkResolvedCapability(subject, 'conversations.edit').allowed
    || (toolName && !authorization.checkResolvedCapability(subject, 'tools.use').allowed)
    || (toolName && ['web_search', 'web_fetch', 'deep_search'].includes(toolName)
      && !authorization.checkResolvedCapability(subject, 'web_search.use').allowed)
    || (toolName && ['search_mcp_tools', 'call_mcp_tool'].includes(toolName)
      && !authorization.checkResolvedCapability(subject, 'mcp.use').allowed)
    || (context.memoryEnabled && !authorization.checkResolvedCapability(subject, 'memory.use').allowed)
    || !(await authorization.checkResolvedCatalogResourceAccess({
      capability: 'models.use', resourceId: context.effectiveModelId, resourceType: 'model', subject,
    })).allowed) {
    throw new FatalError('Personal harness permissions have been revoked.')
  }
  const [accountAllowedToolIds, accountAllowedConnectorIds, gate] = await Promise.all([
    authorization.filterCatalogResourceIds({
      capability: 'tools.use', resourceIds: context.accountAllowedToolIds ?? [], resourceType: 'tool', subject,
    }),
    authorization.filterCatalogResourceIds({
      capability: 'integrations.use', resourceIds: context.accountAllowedConnectorIds ?? [], resourceType: 'connector', subject,
    }),
    actEntitlementService.gateModelPolicy({
      effectiveModelId: context.effectiveModelId, userId: access.actorUserId,
      workspaceId: access.workspaceId, programmaticSubjectId: context.billingProgrammaticSubjectId,
    }),
  ])
  if (isByokModelId(context.effectiveModelId)) {
    await assertUserCanUseByokModel(context.effectiveModelId, access.actorUserId)
  } else if (!(await resolveAuthorizedModelIds({ entitlements: gate.runtimeEntitlements })).chat.has(context.effectiveModelId)) {
    throw new FatalError('The model is no longer allowed by server policy.')
  }
  // Never widen an admitted run when roles or subscriptions gain capabilities.
  const allowedTools = (context.accountAllowedToolIds ?? []).filter(id => accountAllowedToolIds.includes(id))
  const allowedConnectors = (context.accountAllowedConnectorIds ?? []).filter(id => accountAllowedConnectorIds.includes(id))
  return {
    baseUrl: context.baseUrl,
    billingProgrammaticSubjectId: context.billingProgrammaticSubjectId,
    conversationId: access.conversationId,
    effectiveModelId: context.effectiveModelId,
    entitlements: gate.runtimeEntitlements,
    latestUserText: context.latestUserText,
    mediaToolIntent: context.mediaToolIntent,
    memoryEnabled: context.memoryEnabled,
    mode: context.mode,
    paid: gate.paid,
    requiresZeroDataRetention: gate.paid && gate.appSettings?.onlyAllowZdrModels === true,
    requestFingerprint: context.requestFingerprint,
    turnId: context.turnId,
    requestedToolIds: context.requestedToolIds.filter(id => allowedTools.includes(id)),
    userId: access.actorUserId,
    workspaceId: access.workspaceId,
    accountAllowedToolIds: allowedTools,
    accountAllowedConnectorIds: allowedConnectors,
    approvalMode: 'ask',
  }
}
