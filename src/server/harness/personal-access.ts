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
import { refreshAutomationHarnessSource } from './automation-access'
import { refreshSurfaceHarnessSource } from './surface-access'
import { surfaceHarnessTurnId } from './surface-authority'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import type { PersonalHarnessAuthentication } from './personal-authentication'

export type PersonalHarnessAccess = HarnessExecutionReference & {
  conversationId: string
  agentRunId: string
  workspaceId: string
  principalId: string
  authentication: PersonalHarnessAuthentication
}

export type PersonalHarnessExecutionContext = PersonalChatWorkToolingContext & {
  requiresZeroDataRetention: boolean
}

type PersonalContext = Omit<PersonalChatWorkToolingContext, 'entitlements' | 'paid'>
type HarnessState = NonNullable<Awaited<ReturnType<ConvexHarnessRepository['get']>>>
type ServerContext = ReturnType<typeof getOverlayServerContext>

function hasValidPersonalContext(context: PersonalContext): boolean {
  return !context.automationExecution && !context.automationId && !context.automationRunId
    && context.approvalMode !== 'auto' && !context.memoryOwnerId
}

function hasValidAutomationContext(
  context: PersonalContext,
  authority: Extract<PersonalHarnessAuthentication, { type: 'automation' }>,
): boolean {
  return context.automationExecution === true
    && context.automationId === authority.automationId
    && context.automationRunId === authority.automationRunId
    && context.billingProgrammaticSubjectId === `automation:${authority.automationId}`
    && !context.memoryOwnerId
}

function hasValidSurfaceContext(
  context: PersonalContext,
  authority: Extract<PersonalHarnessAuthentication, { type: 'surface' }>,
): boolean {
  return context.automationExecution === true && !context.automationId && !context.automationRunId
    && context.turnId === surfaceHarnessTurnId(authority)
    && context.billingProgrammaticSubjectId === `surface:slack:${authority.bindingId}`
    && (!context.memoryOwnerId || context.memoryOwnerId === agentMemoryOwnerId(authority.agentId))
}

function assertSuppliedContext(access: PersonalHarnessAccess, context: PersonalContext): void {
  const automationAuthority = access.authentication.type === 'automation' ? access.authentication : undefined
  const surfaceAuthority = access.authentication.type === 'surface' ? access.authentication : undefined
  const authorityMatches = automationAuthority
    ? hasValidAutomationContext(context, automationAuthority)
    : surfaceAuthority
      ? hasValidSurfaceContext(context, surfaceAuthority)
      : hasValidPersonalContext(context)
  if (context.userId !== access.actorUserId || context.workspaceId !== access.workspaceId
    || context.conversationId !== access.conversationId
    || !authorityMatches) {
    throw new FatalError('Personal harness identity does not match its tooling context.')
  }
  if (!access.workspaceId || !access.principalId || !access.conversationId) {
    throw new FatalError('Personal harness identity is incomplete.')
  }
}

function assertCurrentHarness(access: PersonalHarnessAccess, state: HarnessState): void {
  if (state.workflowRunId !== access.workflowRunId || state.status !== 'running'
    || state.policy.actorUserId !== access.actorUserId || state.policy.workspaceId !== access.workspaceId
    || state.policy.deadlineAt <= Date.now()) {
    throw new FatalError('Personal harness execution is not authorized to continue.')
  }
}

function assertToolAllowed(state: HarnessState, toolName?: string): void {
  if (toolName && !state.policy.allowedToolIds.includes(toolName)) {
    throw new FatalError('Tool is outside this harness run\'s capabilities.')
  }
}

function assertActiveRoot(access: PersonalHarnessAccess, root: HarnessState | null): asserts root is HarnessState {
  if (!root?.workflowRunId || root.policy.actorUserId !== access.actorUserId
    || root.policy.workspaceId !== access.workspaceId || ['completed', 'cancelled', 'failed'].includes(root.status)) {
    throw new FatalError('The root harness execution is no longer active.')
  }
}

async function readCurrentHarnessAuthority(
  repository: ConvexHarnessRepository,
  access: PersonalHarnessAccess,
  toolName?: string,
): Promise<{ state: HarnessState; root: HarnessState }> {
  const state = await repository.get({ actorUserId: access.actorUserId, runId: access.runId })
  if (!state) throw new FatalError('Personal harness execution is not authorized to continue.')
  assertCurrentHarness(access, state)
  assertToolAllowed(state, toolName)
  const root = state.parentRunId
    ? await repository.get({ actorUserId: access.actorUserId, runId: state.rootRunId })
    : state
  assertActiveRoot(access, root)
  return { state, root }
}

async function assertApiKeyStillAllowed(access: PersonalHarnessAccess, server: ServerContext): Promise<void> {
  if (access.authentication.type === 'api-key') {
    const apiKeyId = access.authentication.apiKeyId
    const key = (await server.appData.repositories.apiKeys.listByUser({ userId: access.actorUserId }))
      .find(key => key.id === apiKeyId)
    if (!key || key.userId !== access.actorUserId || key.revokedAt != null
      || key.expiresAt <= Date.now() || !hasRequiredApiKeyScopes(key.scopes, ['chat:write'])) {
      throw new FatalError('The API key that authorized this run is no longer permitted.')
    }
  } else if (access.authentication.type !== 'session' && access.authentication.type !== 'access-token'
    && access.authentication.type !== 'automation' && access.authentication.type !== 'surface') {
    throw new FatalError('Personal harness authentication is not supported.')
  }
}

function assertWorkspaceConversationIdentity(
  access: PersonalHarnessAccess,
  workspace: Awaited<ReturnType<ServerContext['workspaceService']['resolveActiveWorkspace']>>,
  conversation: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getConversationById']>>,
): void {
  if (workspace.workspace.id !== access.workspaceId || workspace.principal.id !== access.principalId
    || !conversation || conversation.userId !== access.actorUserId || conversation.deletedAt != null
    || (conversation.workspaceId && conversation.workspaceId !== access.workspaceId)
    || (access.authentication.type === 'surface'
      ? conversation.conversationType !== 'channel'
      : (conversation.conversationType && conversation.conversationType !== 'personal'))) {
    throw new FatalError('Personal harness resource access has changed.')
  }
}

function assertDeliveryOwnership(
  access: PersonalHarnessAccess,
  state: HarnessState,
  root: HarnessState,
  agentRun: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getLatestAgentRun']>>,
): void {
  if (!agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
    || agentRun.conversationId !== access.conversationId || agentRun.harnessRunId !== root.runId
    || agentRun.workflowRunId !== root.workflowRunId
    || agentRun.runner !== 'workflow' || agentRun.executionEngine !== 'overlay_harness' || agentRun.mode === 'room'
    || (agentRun.status !== 'running' && !(state.parentRunId
      && ['waiting_for_approval', 'waiting_for_input', 'waiting_for_children'].includes(agentRun.status)))) {
    throw new FatalError('Personal harness resource access has changed.')
  }
}

function assertPersonalCapabilities(
  authorization: ServerContext['authorizationService'],
  subject: Awaited<ReturnType<ServerContext['authorizationService']['resolveSubject']>>,
  context: PersonalContext,
  toolName?: string,
): void {
  if (!authorization.checkResolvedCapability(subject, 'conversations.edit').allowed
    || (toolName && !authorization.checkResolvedCapability(subject, 'tools.use').allowed)
    || (toolName && ['web_search', 'web_fetch', 'deep_search'].includes(toolName)
      && !authorization.checkResolvedCapability(subject, 'web_search.use').allowed)
    || (toolName && ['search_mcp_tools', 'call_mcp_tool'].includes(toolName)
      && !authorization.checkResolvedCapability(subject, 'mcp.use').allowed)
    || (context.memoryEnabled && !authorization.checkResolvedCapability(subject, 'memory.use').allowed)) {
    throw new FatalError('Personal harness permissions have been revoked.')
  }
}

async function assertModelCatalogAccess(
  authorization: ServerContext['authorizationService'],
  subject: Awaited<ReturnType<ServerContext['authorizationService']['resolveSubject']>>,
  modelId: string,
): Promise<void> {
  if (!(await authorization.checkResolvedCatalogResourceAccess({
    capability: 'models.use', resourceId: modelId, resourceType: 'model', subject,
  })).allowed) {
    throw new FatalError('Personal harness permissions have been revoked.')
  }
}

async function assertCurrentModelPolicy(modelId: string, userId: string, entitlements: PersonalHarnessExecutionContext['entitlements']): Promise<void> {
  if (isByokModelId(modelId)) {
    await assertUserCanUseByokModel(modelId, userId)
  } else if (!(await resolveAuthorizedModelIds({ entitlements })).chat.has(modelId)) {
    throw new FatalError('The model is no longer allowed by server policy.')
  }
}

async function readCurrentModelAndGrants(
  authorization: ServerContext['authorizationService'],
  subject: Awaited<ReturnType<ServerContext['authorizationService']['resolveSubject']>>,
  access: PersonalHarnessAccess,
  context: PersonalContext,
): Promise<{
  accountAllowedToolIds: string[]
  accountAllowedConnectorIds: string[]
  gate: Awaited<ReturnType<typeof actEntitlementService.gateModelPolicy>>
}> {
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
  return { accountAllowedToolIds, accountAllowedConnectorIds, gate }
}

function buildExecutionContext(
  access: PersonalHarnessAccess,
  context: PersonalContext,
  accountAllowedToolIds: string[],
  accountAllowedConnectorIds: string[],
  gate: Awaited<ReturnType<typeof actEntitlementService.gateModelPolicy>>,
  sourceGrant?: { approvalMode: 'ask' | 'auto'; allowedToolIds: string[]; allowedConnectorIds: string[]; memoryOwnerId?: string },
): PersonalHarnessExecutionContext {
  const allowedTools = (context.accountAllowedToolIds ?? [])
    .filter(id => accountAllowedToolIds.includes(id))
    .filter(id => !sourceGrant || sourceGrant.allowedToolIds.includes(id))
  const allowedConnectors = (context.accountAllowedConnectorIds ?? [])
    .filter(id => accountAllowedConnectorIds.includes(id))
    .filter(id => !sourceGrant || sourceGrant.allowedConnectorIds.includes(id))
  return {
    baseUrl: context.baseUrl,
    billingProgrammaticSubjectId: context.billingProgrammaticSubjectId,
    conversationId: access.conversationId,
    effectiveModelId: context.effectiveModelId,
    entitlements: gate.runtimeEntitlements,
    latestUserText: context.latestUserText,
    mediaToolIntent: context.mediaToolIntent,
    ...(sourceGrant?.memoryOwnerId ? { memoryOwnerId: sourceGrant.memoryOwnerId } : {}),
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
    integrationToolIds: context.integrationToolIds,
    ...(access.authentication.type === 'automation'
      ? { automationExecution: true, automationId: access.authentication.automationId,
        automationRunId: access.authentication.automationRunId,
        approvalMode: sourceGrant?.approvalMode ?? 'ask' }
      : access.authentication.type === 'surface'
        ? { automationExecution: true, approvalMode: sourceGrant?.approvalMode ?? 'ask' }
        : { approvalMode: 'ask' as const }),
  }
}

// Call inside the model/tool step, not only in an earlier preparation step:
// a durable replay must not reuse a permission decision made before a wait.
export async function refreshPersonalHarnessAccess(
  access: PersonalHarnessAccess,
  context: PersonalContext,
  toolName?: string,
): Promise<PersonalHarnessExecutionContext> {
  assertSuppliedContext(access, context)
  const repository = new ConvexHarnessRepository()
  const { state, root } = await readCurrentHarnessAuthority(repository, access, toolName)
  const server = getOverlayServerContext()
  let sourceGrant: Awaited<ReturnType<typeof refreshAutomationHarnessSource>>
    | Awaited<ReturnType<typeof refreshSurfaceHarnessSource>> | undefined
  if (access.authentication.type === 'automation') {
    sourceGrant = await refreshAutomationHarnessSource(access, context)
  } else if (access.authentication.type === 'surface') {
    sourceGrant = await refreshSurfaceHarnessSource(access, context, root.workflowRunId!)
  } else {
    await assertApiKeyStillAllowed(access, server)
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
  assertWorkspaceConversationIdentity(access, workspace, conversation)
  assertDeliveryOwnership(access, state, root, agentRun)
  const authorization = server.authorizationService
  assertPersonalCapabilities(authorization, subject, context, toolName)
  await assertModelCatalogAccess(authorization, subject, context.effectiveModelId)
  const grants = await readCurrentModelAndGrants(authorization, subject, access, context)
  if (sourceGrant) {
    const integrationToolIds = new Set(context.integrationToolIds ?? [])
    const currentConnectors = grants.accountAllowedConnectorIds
    const initialConnectors = context.accountAllowedConnectorIds ?? []
    const connectorGrantChanged = initialConnectors.length !== currentConnectors.length
      || initialConnectors.some(id => !currentConnectors.includes(id))
    const currentSourceToolIds = sourceGrant.allowedToolIds.filter(id => integrationToolIds.has(id)
      ? !connectorGrantChanged
      : grants.accountAllowedToolIds.includes(id))
    const revokedSnapshotTools = state.policy.allowedToolIds.filter(id => !currentSourceToolIds.includes(id))
    if (revokedSnapshotTools.length || (toolName && !currentSourceToolIds.includes(toolName))) {
      throw new FatalError(access.authentication.type === 'surface'
        ? 'Surface agent permissions have been revoked.'
        : 'Automation agent permissions have been revoked.')
    }
  }
  await assertCurrentModelPolicy(context.effectiveModelId, access.actorUserId, grants.gate.runtimeEntitlements)
  return buildExecutionContext(access, context, grants.accountAllowedToolIds, grants.accountAllowedConnectorIds, grants.gate, sourceGrant)
}
