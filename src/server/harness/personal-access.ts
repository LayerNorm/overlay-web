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

function assertSuppliedContext(access: PersonalHarnessAccess, context: PersonalContext): void {
  const automationAuthority = access.authentication.type === 'automation' ? access.authentication : undefined
  const authorityMatches = automationAuthority
    ? hasValidAutomationContext(context, automationAuthority)
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

function assertCurrentHarness(access: PersonalHarnessAccess, state: HarnessState, renewalMode = false): void {
  const leaseExpired = state.policy.deadlineAt <= Date.now()
    && !(renewalMode && state.policy.executionPolicyVersion === 2)
  const allowedStatus = state.status === 'running'
    || renewalMode && ['waiting_for_resources', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_children'].includes(state.status)
  if (state.workflowRunId !== access.workflowRunId
    || (state.executionGeneration ?? 0) !== (access.executionGeneration ?? 0)
    || !allowedStatus
    || state.policy.actorUserId !== access.actorUserId || state.policy.workspaceId !== access.workspaceId
    || leaseExpired
    || (state.policy.taskDeadlineAt !== undefined && state.policy.taskDeadlineAt <= Date.now() && !renewalMode)) {
    throw new FatalError('Personal harness execution is not authorized to continue.')
  }
}

function assertToolAllowed(state: HarnessState, toolName?: string): void {
  if (toolName && !state.policy.allowedToolIds.includes(toolName)) {
    throw new FatalError('Tool is outside this harness run\'s capabilities.')
  }
}

function assertActiveRoot(access: PersonalHarnessAccess, root: HarnessState | null, renewalMode = false): asserts root is HarnessState {
  const ownerTransferInProgress = root?.policy.executionPolicyVersion === 2
    && !root.workflowRunId && Boolean(root.handoffWorkflowRunId) && !['completed', 'cancelled', 'failed'].includes(root.status)
  if (!root || (!root.workflowRunId && !ownerTransferInProgress) || root.policy.actorUserId !== access.actorUserId
    || root.policy.workspaceId !== access.workspaceId
    || (root.executionGeneration ?? 0) !== (root.runId === access.runId ? access.executionGeneration ?? 0 : root.executionGeneration ?? 0)
    || (root.policy.deadlineAt <= Date.now() && !(renewalMode && root.policy.executionPolicyVersion === 2))
    || (root.policy.taskDeadlineAt !== undefined && root.policy.taskDeadlineAt <= Date.now() && !renewalMode)
    || ['completed', 'cancelled', 'failed'].includes(root.status)) {
    throw new FatalError('The root harness execution is no longer active.')
  }
}

async function readCurrentHarnessAuthority(
  repository: ConvexHarnessRepository,
  access: PersonalHarnessAccess,
  toolName?: string,
  renewalMode = false,
): Promise<{ state: HarnessState; root: HarnessState }> {
  const state = await repository.get({ actorUserId: access.actorUserId, runId: access.runId })
  if (!state) throw new FatalError('Personal harness execution is not authorized to continue.')
  assertCurrentHarness(access, state, renewalMode)
  assertToolAllowed(state, toolName)
  const root = state.parentRunId
    ? await repository.get({ actorUserId: access.actorUserId, runId: state.rootRunId })
    : state
  assertActiveRoot(access, root, renewalMode)
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
    && access.authentication.type !== 'automation') {
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
    || (conversation.conversationType && conversation.conversationType !== 'personal')) {
    throw new FatalError('Personal harness resource access has changed.')
  }
}

function assertDeliveryOwnership(
  access: PersonalHarnessAccess,
  state: HarnessState,
  root: HarnessState,
  agentRun: Awaited<ReturnType<ServerContext['appData']['repositories']['conversations']['getLatestAgentRun']>>,
  renewalMode = false,
): void {
  if (!agentRun || agentRun.id !== access.agentRunId || agentRun.userId !== access.actorUserId
    || agentRun.conversationId !== access.conversationId || agentRun.harnessRunId !== root.runId
    || agentRun.runner !== 'workflow' || agentRun.executionEngine !== 'overlay_harness' || agentRun.mode === 'room'
    || (agentRun.status !== 'running' && !(state.parentRunId
      && ['waiting_for_approval', 'waiting_for_input', 'waiting_for_children', 'waiting_for_resources'].includes(agentRun.status))
      && !(renewalMode && state.runId === root.runId
        && ['waiting_for_resources', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_children'].includes(state.status)
        && agentRun.status === state.status))) {
    throw new FatalError('Personal harness resource access has changed.')
  }
  const deliveryOwner = root.workflowRunId ?? root.handoffWorkflowRunId
  if (!deliveryOwner || agentRun.workflowRunId !== deliveryOwner) {
    throw new FatalError('Personal harness delivery ownership has changed.')
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

async function assertCurrentModelPolicy(
  modelId: string,
  userId: string,
  workspaceId: string,
  entitlements: PersonalHarnessExecutionContext['entitlements'],
): Promise<void> {
  if (isByokModelId(modelId)) {
    await assertUserCanUseByokModel(modelId, userId, workspaceId)
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
  sourceGrant?: { approvalMode: 'ask' | 'auto'; allowedToolIds: string[]; allowedConnectorIds: string[] },
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
    ...(context.notebook ? { notebook: context.notebook } : {}),
    ...(access.authentication.type === 'automation'
      ? { automationExecution: true, automationId: access.authentication.automationId,
        automationRunId: access.authentication.automationRunId,
        approvalMode: sourceGrant?.approvalMode ?? 'ask' }
      : { approvalMode: 'ask' as const }),
  }
}

// Every tool an automation run was admitted with must still be allowed, judged by the
// rule that admitted it: account tools by the current account and source grants,
// integration tools by an unchanged connector grant, and web search, MCP and
// connected-app tools by a bound agent's capabilities. Tools no grant names (such as
// generated UI) stay governed by the per-call capability checks above.
function assertAutomationGrantCurrent(
  state: HarnessState,
  context: PersonalContext,
  sourceGrant: Awaited<ReturnType<typeof refreshAutomationHarnessSource>>,
  grants: Awaited<ReturnType<typeof readCurrentModelAndGrants>>,
  toolName?: string,
): void {
  const integrationToolIds = new Set(context.integrationToolIds ?? [])
  const accountToolIds = new Set(context.accountAllowedToolIds ?? [])
  const withheld = new Set(sourceGrant.withheldToolIds)
  const currentConnectors = grants.accountAllowedConnectorIds
  const initialConnectors = context.accountAllowedConnectorIds ?? []
  const connectorGrantChanged = initialConnectors.length !== currentConnectors.length
    || initialConnectors.some(id => !currentConnectors.includes(id))
  const stillAllowed = (id: string) => {
    if (withheld.has(id)) return false
    if (integrationToolIds.has(id)) return !connectorGrantChanged && sourceGrant.allowedToolIds.includes(id)
    if (accountToolIds.has(id)) return sourceGrant.allowedToolIds.includes(id) && grants.accountAllowedToolIds.includes(id)
    return true
  }
  if (state.policy.allowedToolIds.some(id => !stillAllowed(id)) || (toolName && !stillAllowed(toolName))) {
    throw new FatalError('Automation agent permissions have been revoked.')
  }
}

// Call inside the model/tool step, not only in an earlier preparation step:
// a durable replay must not reuse a permission decision made before a wait.
export async function refreshPersonalHarnessAccess(
  access: PersonalHarnessAccess,
  context: PersonalContext,
  toolName?: string,
  options: { renewalMode?: boolean; renewLease?: boolean } = {},
): Promise<PersonalHarnessExecutionContext> {
  assertSuppliedContext(access, context)
  if (options.renewLease && !options.renewalMode) throw new FatalError('Invalid lease renewal mode.')
  const repository = new ConvexHarnessRepository()
  const { state, root } = await readCurrentHarnessAuthority(repository, access, toolName, options.renewalMode)
  if (context.notebook && (root.policy.surface?.kind !== 'notebook'
    || root.policy.surface.noteId !== context.notebook.noteId
    || root.policy.surface.turnId !== context.turnId
    || root.policy.surface.requestDigest !== context.notebook.requestDigest
    || !state.policy.allowedToolIds.every(id => ['search_knowledge', 'read_note', 'propose_edit', 'finish'].includes(id)))) {
    throw new FatalError('Notebook harness source or capabilities changed.')
  }
  const server = getOverlayServerContext()
  let sourceGrant: Awaited<ReturnType<typeof refreshAutomationHarnessSource>> | undefined
  if (access.authentication.type === 'automation') {
    sourceGrant = await refreshAutomationHarnessSource(access, context)
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
  assertDeliveryOwnership(access, state, root, agentRun, options.renewalMode === true)
  const authorization = server.authorizationService
  assertPersonalCapabilities(authorization, subject, context, toolName)
  await assertModelCatalogAccess(authorization, subject, context.effectiveModelId)
  const grants = await readCurrentModelAndGrants(authorization, subject, access, context)
  if (sourceGrant) assertAutomationGrantCurrent(state, context, sourceGrant, grants, toolName)
  await assertCurrentModelPolicy(
    context.effectiveModelId,
    access.actorUserId,
    access.workspaceId,
    grants.gate.runtimeEntitlements,
  )
  if (options.renewLease && state.policy.executionPolicyVersion === 2) {
    const current = await repository.get({ actorUserId: access.actorUserId, runId: access.runId })
    if (!current || current.workflowRunId !== access.workflowRunId
      || (current.executionGeneration ?? 0) !== (access.executionGeneration ?? 0)) {
      throw new FatalError('Personal harness execution ownership changed during lease renewal.')
    }
    await repository.renewLease({
      actorUserId: access.actorUserId, runId: access.runId, workflowRunId: access.workflowRunId,
      executionGeneration: access.executionGeneration ?? 0, expectedRevision: current.revision,
      now: Date.now(), leaseMs: 24 * 60 * 60 * 1_000,
    })
  }
  return buildExecutionContext(access, context, grants.accountAllowedToolIds, grants.accountAllowedConnectorIds, grants.gate, sourceGrant)
}
