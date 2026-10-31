import 'server-only'

import type { ModelMessage, UIMessage } from 'ai'
import type { CapabilityCheck } from '@overlay/app-core'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import type { WorkspaceAccess } from '@overlay/workspace-contracts'
import { OVERLAY_TOOL_IDS } from '@overlay/tools-core'
import { getOverlayServerContext } from '@/server/bootstrap'
import { convertToModelMessages, generateText } from '@/server/ai/sdk'
import { getLanguageModel, isSubscriptionModelForUser } from '@/server/ai/model-runtime'
import { summaryGenerationOptions } from '@/server/chat/context-compaction'
import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import {
  FREE_TIER_DEFAULT_MODEL_ID,
  DEFAULT_MODEL_ID,
} from '@/shared/ai/gateway/model-types'
import { isByokModelId } from '@/shared/ai/gateway/byok-model-conversion'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { meterAutomationWorkflowRun } from '@/server/billing/automation-workflow-billing'
import { resolveBillingPayer } from '@/server/billing/billing-runtime'
import { providerRequestFingerprint } from '@/server/billing/ServerProviderUsageMeter'
import { asConversationId } from '@/server/conversations/ActConversationRepository'
import { describePersonalChatWorkTools } from '@/server/conversations/personal-chat-work-tools'
import {
  actContextService,
  actEntitlementService,
  actMessagePersistenceService,
  actUsageBudgetService,
} from '@/server/conversations/http'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { logger } from '@/server/observability/logger'
import { summarizeErrorForLog } from '@/shared/security/safe-log'
import { buildSecondarySystemPromptExtension } from '@/server/agent/operator-system-prompt'
import {
  ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
  ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
  ACT_PAID_PLAN_ACT_TOOLS_REALITY,
  FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
  MEMORY_SAVE_PROTOCOL,
  cloneMessagesWithIndexedFileHint,
  indexedFilesSystemNote,
  indexedFilesSystemNotePreloaded,
} from '@/server/agent/knowledge-agent-instructions'
import { MATH_FORMAT_INSTRUCTION } from '@/shared/markdown/math-format-instructions'
import { TABLE_FORMAT_INSTRUCTION } from '@/shared/markdown/markdown-table-instructions'
import { buildActAgentInstructions } from '@/server/app-api/v1/conversations/act/instructions'
import {
  resolveEffectiveActModelId,
} from '@/server/app-api/v1/conversations/act/route-helpers'
import {
  authorizeActRequest,
} from '@/server/app-api/v1/conversations/act/turn-authorization'
import {
  prepareActTooling,
  preloadActExternalToolTasks,
} from '@/server/app-api/v1/conversations/act/tooling'
import { filterCatalogResources } from '@/server/authorization'
import {
  classifyMediaToolIntentForTurn,
  mayNeedMediaGenerationTools,
} from '@/server/tools/media-tool-intent'
import { parseMentionTokens } from '@/shared/knowledge/mention-tokens'
import {
  buildAutomationSystemPrompt,
  buildAutomationUserMessage,
} from '@/shared/automations/automation-prompts'
import { buildSurfaceSystemPrompt } from '@/shared/surfaces/surface-prompts'
import {
  applyAgentCapabilityFilter,
  resolveAgentGrant,
} from '@/server/agents/agent-tooling'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import type {
  PersonalChatWorkToolDefinition,
  PersonalChatWorkToolingContext,
} from '@/shared/agents/personal-chat-work'
import type { SourceCitationMap } from '@/shared/knowledge/ask-knowledge-types'
import { getBaseUrl } from '@/server/web/app-url'
import { automationService } from './http'

/**
 * Normalized input for one durable automation turn. Both the one-shot run
 * workflow and the scheduling workflow's per-iteration call converge here.
 * Everything on it must stay JSON-serializable — it crosses workflow
 * step boundaries.
 */
/**
 * Surface provenance for a turn triggered by an external platform message
 * (Slack first). When present, `instructions` carries the raw inbound message
 * text instead of automation instructions, the agent's own persona prompt
 * becomes the system extension, and billing attributes to
 * `surface:<platform>:<bindingId>`.
 */
export type SurfaceTurnContext = {
  platform: string
  bindingId: string
  connectionId: string
  /** Platform install key — Slack team_id (or enterprise_id for org installs). */
  teamId: string
  channelId: string
  channelName?: string
  /** Platform thread key — Slack thread_ts the conversation maps to. */
  threadId: string
  /** Inbound platform message id — dedupe key for the persisted user row. */
  messageId: string
  agentId: string
  agentName: string
  agentInstructions?: string
  /** The agent's own principal — memory and tooling attribute to it. */
  agentPrincipalId?: string
  /** The agent's tool grant — narrows the turn's tool surface. */
  agentAllowedToolIds?: string[]
  agentIsDefault?: boolean
  agentPermissionMode?: 'ask' | 'auto'
  /** Creator's human principal — owns the surface conversation rows. */
  creatorPrincipalId?: string
  authorExternalId?: string
  authorName?: string
  authorEmail?: string
  /** Workspace-membership status of the sender (same convention as imports). */
  authorStatus?: 'member' | 'invited' | 'not_invited'
  /** ts of the "working" placeholder the handler posted — the reply edits it. */
  placeholderTs?: string
}

export type AutomationAgentTurnInput = {
  automationId?: string
  /** Present for manual "run now" executions backed by an automation_runs row. */
  runId?: string
  userId: string
  name: string
  description?: string
  instructions: string
  modelId?: string
  conversationId?: string
  turnId: string
  scheduledFor: number
  workspaceId?: string
  originWorkflowRunId?: string
  surface?: SurfaceTurnContext
}

/**
 * The serializable preparation plan consumed by the personal Harness
 * workflow. It carries no request-scoped state across workflow boundaries.
 */
export type AutomationAgentTurnPlan = {
  conversationId: string
  effectiveModelId: string
  instructions: string
  messages: ModelMessage[]
  paid: boolean
  providerOptions?: Record<string, Record<string, unknown>>
  reservationId: string | null
  userMessageId: string
  principalId: string
  sourceCitations?: SourceCitationMap
  toolDefinitions: PersonalChatWorkToolDefinition[]
  toolingContext: PersonalChatWorkToolingContext
}

/**
 * Raised for failures the caller should treat as terminal for this turn —
 * denials, missing configuration, or an unroutable model — so the workflow
 * can mark the run failed without retrying a hopeless step forever.
 */
export class AutomationTurnError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly payload?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AutomationTurnError'
  }
}

/**
 * Create (or reuse) the conversation an automation turn writes into, bound to
 * the same workspace the BFF would resolve for the acting user.
 */
export async function ensureAutomationConversation(
  input: AutomationAgentTurnInput,
): Promise<{ conversationId: string; workspaceId: string }> {
  const overlayContext = getOverlayServerContext()
  const source = await readAutomationConversationSource(input, overlayContext)
  assertAutomationConversationTarget(input, source)
  const workspace = await resolveAutomationConversationWorkspace(input, source.automation, overlayContext)
  if (source.canonicalConversationId) {
    await validateOwnedAutomationConversation(input, source, workspace.workspace.id, overlayContext)
    return { conversationId: source.canonicalConversationId, workspaceId: workspace.workspace.id }
  }
  return await createOwnedAutomationConversation(input, workspace.workspace.id, overlayContext)
}

async function readAutomationConversationSource(
  input: AutomationAgentTurnInput,
  overlayContext: ReturnType<typeof getOverlayServerContext>,
) {
  if (!input.automationId) throw new AutomationTurnError('Automation identity is required.', 409)
  const automation = await automationService.getAutomationForExecution({
    automationId: input.automationId,
    userId: input.userId,
  })
  if (!automation || automation.deletedAt) throw new AutomationTurnError('Automation is no longer available.', 409)
  if (!input.originWorkflowRunId) throw new AutomationTurnError('Automation workflow identity is required.', 409)
  const run = input.runId
    ? await overlayContext.appData.repositories.automations.getRunForExecution({ runId: input.runId })
    : null
  if (input.runId) {
    if (!run || run.run.automationId !== input.automationId || run.run.userId !== input.userId
      || run.run.workflowRunId !== input.originWorkflowRunId
      || !['queued', 'running'].includes(run.run.status)) {
      throw new AutomationTurnError('Automation run ownership changed.', 409)
    }
  } else if (automation.schedulerWorkflowRunId !== input.originWorkflowRunId || automation.enabled !== true) {
    throw new AutomationTurnError('Automation scheduler ownership changed.', 409)
  }
  const ownedConversationId = automation.conversationId
    && automation.conversationId !== automation.sourceConversationId
    ? automation.conversationId
    : undefined
  const canonicalConversationId = ownedConversationId ?? run?.run.conversationId
  return { automation, run, ownedConversationId, canonicalConversationId }
}

function assertAutomationConversationTarget(
  input: AutomationAgentTurnInput,
  source: Awaited<ReturnType<typeof readAutomationConversationSource>>,
): void {
  const { ownedConversationId, canonicalConversationId, run } = source
  if (input.conversationId && input.conversationId !== canonicalConversationId) {
    throw new AutomationTurnError('Automation conversation binding changed.', 409)
  }
  if (run?.run.conversationId && ownedConversationId
      && run.run.conversationId !== ownedConversationId) {
    throw new AutomationTurnError('Automation run conversation binding changed.', 409)
  }
}

async function resolveAutomationConversationWorkspace(
  input: AutomationAgentTurnInput,
  automation: NonNullable<Awaited<ReturnType<typeof automationService.getAutomationForExecution>>>,
  overlayContext: ReturnType<typeof getOverlayServerContext>,
) {
  if (automation.workspaceId && input.workspaceId && automation.workspaceId !== input.workspaceId) {
    throw new AutomationTurnError('Automation workspace binding changed.', 409)
  }
  const workspace = await overlayContext.workspaceService.resolveActiveWorkspace(
    input.userId,
    automation.workspaceId ?? input.workspaceId,
  )
  if (automation.workspaceId && workspace.workspace.id !== automation.workspaceId) {
    throw new AutomationTurnError('Automation workspace binding changed.', 409)
  }
  if (input.workspaceId && workspace.workspace.id !== input.workspaceId) {
    throw new AutomationTurnError('Automation workspace binding changed.', 409)
  }
  return workspace
}

async function validateOwnedAutomationConversation(
  input: AutomationAgentTurnInput,
  source: Awaited<ReturnType<typeof readAutomationConversationSource>>,
  workspaceId: string,
  overlayContext: ReturnType<typeof getOverlayServerContext>,
): Promise<void> {
  const conversationId = source.canonicalConversationId!
  const conversation = await overlayContext.appData.repositories.conversations.getConversationById({
    conversationId: asConversationId(conversationId), userId: input.userId, workspaceId,
  })
  if (!conversation || conversation.userId !== input.userId || conversation.deletedAt != null
    || conversation.workspaceId !== workspaceId
    || (conversation.conversationType && conversation.conversationType !== 'personal')) {
    throw new AutomationTurnError('Automation conversation ownership changed.', 409)
  }
  if (!source.ownedConversationId) await attachOwnedAutomationConversation(input, conversationId)
}

async function attachOwnedAutomationConversation(
  input: AutomationAgentTurnInput,
  conversationId: string,
): Promise<void> {
  await automationService.attachOwnedConversation({
    automationId: input.automationId!,
    conversationId,
    userId: input.userId,
  })
  const attached = await automationService.getAutomationForExecution({
    automationId: input.automationId!,
    userId: input.userId,
  })
  if (attached?.conversationId !== conversationId) {
    throw new AutomationTurnError('Automation conversation could not be bound safely.', 409)
  }
}

async function createOwnedAutomationConversation(
  input: AutomationAgentTurnInput,
  workspaceId: string,
  overlayContext: ReturnType<typeof getOverlayServerContext>,
): Promise<{ conversationId: string; workspaceId: string }> {
  const conversationId = await overlayContext.appData.repositories.conversations
    .createConversation({
      clientId: `automation:${input.automationId!}:owned`,
      userId: input.userId,
      title: `Automation: ${input.name || 'Untitled'}`,
      askModelIds: [input.modelId || DEFAULT_MODEL_ID],
      actModelId: input.modelId || DEFAULT_MODEL_ID,
      lastMode: 'act',
      isAutomation: true,
      workspaceId,
    })
  if (!conversationId) {
    throw new AutomationTurnError('Failed to create automation conversation')
  }
  await attachOwnedAutomationConversation(input, String(conversationId))
  return {
    conversationId: String(conversationId),
    workspaceId,
  }
}

/**
 * Billing subject, idempotency key, and operation-id prefix for a turn:
 * surface turns bill to `surface:<platform>:<bindingId>`, automations to the
 * automation (or run).
 */
function turnBillingKeys(input: AutomationAgentTurnInput) {
  const surface = input.surface
  if (surface) {
    return {
      billingProgrammaticSubjectId: `surface:${surface.platform}:${surface.bindingId}`,
      requestIdempotencyKey: `surface:${surface.platform}:${surface.bindingId}:${surface.messageId || input.turnId}`,
      operationIdPrefix: 'surface.turn',
    }
  }
  return {
    billingProgrammaticSubjectId: `automation:${input.automationId ?? input.runId ?? input.turnId}`,
    requestIdempotencyKey: `automation:${input.runId ?? input.automationId ?? 'turn'}:${input.turnId}`,
    operationIdPrefix: 'automation.turn',
  }
}

/**
 * A surface turn carries the bound agent's grant: the tool surface is the
 * account's allowed tools intersected with the agent's allowedToolIds (the
 * delegate model — tools still authenticate as the creator). The grant can
 * only ever narrow, never widen.
 */
function narrowToolIdsToSurfaceAgent(
  surface: SurfaceTurnContext | undefined,
  accountAllowedToolIds: string[],
) {
  if (!surface) return { agentGrant: undefined, allowedToolIds: accountAllowedToolIds }
  const agentGrant = resolveAgentGrant({
    agentId: surface.agentId,
    allowedToolIds: surface.agentAllowedToolIds ?? [],
    isDefaultMaster: surface.agentIsDefault === true,
  })
  return {
    agentGrant,
    allowedToolIds: accountAllowedToolIds.filter((toolId) => agentGrant.overlayToolIds.includes(toolId)),
  }
}

type AutomationBoundAgent = Awaited<ReturnType<
  ReturnType<typeof getOverlayServerContext>['workspaceAgentService']['get']
>>

async function resolveTurnAgentAuthorization(
  input: AutomationAgentTurnInput,
  userId: string,
  workspaceId: string,
  overlayContext: ReturnType<typeof getOverlayServerContext>,
  surface: SurfaceTurnContext | undefined,
) {
  let approvalMode: 'ask' | 'auto' = surface?.agentPermissionMode ?? 'ask'
  let automationAgent: AutomationBoundAgent | null = null
  let automationAgentId: string | undefined
  if (!surface && input.automationId) {
    const automation = await automationService.getAutomationForExecution({
      automationId: input.automationId,
      userId,
    })
    const agentId = automation?.agentId
    if (agentId) {
      automationAgentId = agentId
      automationAgent = await overlayContext.workspaceAgentService.get({
        actorUserId: userId,
        workspaceId,
        agentId,
      })
      if (automationAgent.harness !== 'overlay' || automationAgent.archivedAt) {
        throw new AutomationTurnError('The bound automation agent is no longer available.', 409)
      }
      approvalMode = automationAgent.permissionMode === 'auto' ? 'auto' : 'ask'
    }
  }
  return { approvalMode, automationAgent, automationAgentId }
}

function narrowTurnAgentGrant(
  surface: SurfaceTurnContext | undefined,
  automationAgent: AutomationBoundAgent | null,
  automationAgentId: string | undefined,
  accountAllowedToolIds: string[],
  accountAllowedConnectorIds: string[],
) {
  let { agentGrant, allowedToolIds } = narrowToolIdsToSurfaceAgent(surface, accountAllowedToolIds)
  if (!surface && automationAgent) {
    agentGrant = resolveAgentGrant({
      agentId: automationAgentId ?? '',
      allowedToolIds: automationAgent.allowedToolIds,
      isDefaultMaster: automationAgent.isDefault === true,
    })
    allowedToolIds = accountAllowedToolIds.filter(id => agentGrant!.overlayToolIds.includes(id))
    if (!agentGrant.capabilities.has('integrations')) accountAllowedConnectorIds.length = 0
  }
  return { agentGrant, allowedToolIds }
}

export async function prepareAutomationAgentTurn(
  input: AutomationAgentTurnInput & { conversationId: string; workspaceId: string },
): Promise<AutomationAgentTurnPlan> {
  const overlayContext = getOverlayServerContext()
  const userId = input.userId
  const serverSecret = getInternalApiSecret()
  const cid = asConversationId(input.conversationId)
  const billingWorkspaceId = input.workspaceId

  const effectiveModelId = resolveEffectiveActModelId(input.modelId)

  const surface = input.surface
  const { billingProgrammaticSubjectId, requestIdempotencyKey, operationIdPrefix } = turnBillingKeys(input)
  const requestFingerprint = providerRequestFingerprint({
    automationId: input.automationId,
    runId: input.runId,
    turnId: input.turnId,
    userId,
  })

  const { paid, runtimeEntitlements } = await actEntitlementService.gateModelAccess({
    effectiveModelId,
    programmaticSubjectId: billingProgrammaticSubjectId,
    userId,
    workspaceId: billingWorkspaceId,
  })

  // Automation workflow metering is per automation run. Surface model calls
  // are billed by the Harness provider dispatch, not a turn-wide reservation.
  if (!surface) {
    const workflowMeter = await meterAutomationWorkflowRun({
      entitlements: runtimeEntitlements,
      idempotencyKey: requestIdempotencyKey,
      programmaticSubjectId: billingProgrammaticSubjectId,
      requestFingerprint,
      userId,
      workspaceId: billingWorkspaceId,
    })
    if (!workflowMeter.ok) {
      throw new AutomationTurnError(
        typeof workflowMeter.payload?.message === 'string'
          ? workflowMeter.payload.message
          : 'Automation workflow metering was denied.',
        workflowMeter.status,
        workflowMeter.payload,
      )
    }
  }

  const [resolvedBillingPayer, authorizedModelIds] = await Promise.all([
    resolveBillingPayer({
    programmaticSubjectId: billingProgrammaticSubjectId,
    userId,
    workspaceId: billingWorkspaceId,
    }),
    resolveAuthorizedModelIds({ entitlements: runtimeEntitlements }),
  ])
  if (!authorizedModelIds.chat.has(effectiveModelId)) {
    throw new AutomationTurnError(
      `Model ${effectiveModelId} is not allowed by the server model policy.`,
      403,
      { error: 'model_not_allowed' },
    )
  }

  const mentions = parseMentionTokens(input.instructions)
    .map((mention) => ({ type: mention.type, id: mention.id, name: mention.name || mention.id }))
  const memoryEnabled = true

  // The durable turn re-runs the act route's catalog authorization under a
  // synthetic service-auth context — subject resolution keys off auth.userId.
  const workspaceAccess: WorkspaceAccess = await overlayContext.workspaceService
    .resolveActiveWorkspace(userId, billingWorkspaceId)
  const routeContext: AppApiRouteContext = {
    params: Promise.resolve({}),
    auth: { userId, accessToken: '', authType: 'service' },
    parsedQuery: {},
    parsedJson: { automationId: input.automationId, surfaceBindingId: input.surface?.bindingId },
    parsedFormData: null,
    capabilities: {} as CapabilityCheck,
    appDataCapabilities: overlayContext.appDataCapabilities,
    requestFingerprint,
    requestIdempotencyKey,
    workspace: workspaceAccess,
  }
  const denied = await authorizeActRequest({
    authorization: overlayContext.authorizationService,
    context: routeContext,
    effectiveModelId,
    memoryEnabled,
    mentions,
    requestedToolIds: [],
  })
  if (denied) {
    const payload = await denied.json().catch((_error) => ({})) as Record<string, unknown>
    throw new AutomationTurnError(
      typeof payload.message === 'string' ? payload.message : 'Automation turn denied by authorization policy.',
      denied.status,
      payload,
    )
  }

  // For surface turns, `instructions` carries the raw inbound platform text.
  const userText = surface ? input.instructions : buildAutomationUserMessage(input)
  const userMessage: UIMessage = {
    id: input.turnId,
    role: 'user',
    parts: [{ type: 'text', text: userText }],
  }

  // User-message save runs parallel to context assembly; a transient write
  // must not mask a later fatal context error (mirrors the act route).
  const saveUserMessageTask = actMessagePersistenceService.persistUserMessage({
    conversationId: cid,
    userId,
    turnId: input.turnId,
    modelId: effectiveModelId,
    latestUserContent: userText,
    latestUserText: userText,
    latestUserParts: [{ type: 'text', text: userText }],
    mode: 'act',
    billingActorUserId: userId,
    billingAccountId: resolvedBillingPayer.scope === 'workspace'
      ? resolvedBillingPayer.billingAccountId
      : undefined,
    billingSpendSubjectId: resolvedBillingPayer.subject.id,
    billingSpendSubjectKind: resolvedBillingPayer.subject.kind,
    importedAuthorName: surface?.authorName,
    importedAuthorEmail: surface?.authorEmail,
    importedAuthorStatus: surface?.authorStatus,
    skip: false,
  }).catch((error) => {
    logger.warn('[automations/turn] user-message persistence failed', {
      turnId: input.turnId,
      error: summarizeErrorForLog(error),
    })
    return undefined
  })

  const turnContextTask = actContextService.loadTurnContext({
    accessToken: undefined,
    conversationId: cid,
    indexedAttachments: undefined,
    indexedFileNames: undefined,
    latestUserText: userText,
    memoryEnabled,
    mentions,
    requestIdempotencyKey,
    requestFingerprint,
    billingProgrammaticSubjectId,
    billingUserId: userId,
    serverSecret,
    userId,
    externalContextEnabled: true,
    workspaceId: billingWorkspaceId,
  })

  const mediaIntentTask = (async () => {
    if (!paid) return null
    if (!mayNeedMediaGenerationTools(userText)) return null
    return await classifyMediaToolIntentForTurn({
      userText,
      userId,
      accessToken: undefined,
      entitlements: runtimeEntitlements,
      idempotencyKey: requestIdempotencyKey,
      operationId: `${operationIdPrefix}.media-intent`,
      programmaticSubjectId: billingProgrammaticSubjectId,
      requestFingerprint,
      workspaceId: billingWorkspaceId,
    })
  })()

  const [userMessageId, turnContext, resolvedMediaToolIntent] = await Promise.all([
    saveUserMessageTask,
    turnContextTask,
    mediaIntentTask,
  ])
  const {
    autoRetrieval,
    docContextBundle,
    hasPreloadedDocContext,
    indexedAttachmentList,
    memoryContext,
    mentionsContext,
    skillsContext,
    sourceCitationMap,
  } = turnContext

  const indexedNote = hasPreloadedDocContext
    ? indexedFilesSystemNotePreloaded(indexedAttachmentList)
    : indexedFilesSystemNote(indexedAttachmentList)

  let messagesForModel = await actContextService.buildMessagesForModel({
    requestMessages: [userMessage],
    latestUserMessage: userMessage,
    latestTurnId: input.turnId,
    conversationId: cid,
    userId,
    targetModelId: effectiveModelId,
  })
  const summaryModelId = isByokModelId(effectiveModelId)
    ? effectiveModelId
    : FREE_TIER_DEFAULT_MODEL_ID
  messagesForModel = cloneMessagesWithIndexedFileHint(
    messagesForModel,
    indexedAttachmentList,
    hasPreloadedDocContext,
  )
  messagesForModel = await actContextService.prepareExistingMessagesForModel({
    accessToken: undefined,
    conversationId: cid,
    generateSummaryText: async ({ prompt, targetSummaryTokens }) => {
      const estimatedInputTokens = Math.ceil(prompt.length / 4) + 64
      const summaryReservation = await actUsageBudgetService.reserveForAttempt({
        entitlements: runtimeEntitlements,
        estimatedInputTokens,
        idempotencyKey: requestIdempotencyKey,
        maxOutputTokens: targetSummaryTokens,
        modelId: summaryModelId,
        operationId: `${operationIdPrefix}.context-summary`,
        paid,
        requestFingerprint,
        userId,
        workspaceId: billingWorkspaceId,
        programmaticSubjectId: billingProgrammaticSubjectId,
      })
      if (!summaryReservation.ok) {
        throw new Error(String(summaryReservation.failure.payload.error ?? 'context_summary_budget_denied'))
      }
      let providerWorkStarted = false
      try {
        await actUsageBudgetService.markReservationStarted({
          reservationId: summaryReservation.reservationId,
          userId,
        })
        providerWorkStarted = true
        const summaryModel = await getLanguageModel(summaryModelId, undefined, userId)
        const isSubscription = await isSubscriptionModelForUser(summaryModelId, userId)
        const summaryResult = await generateText({
          model: summaryModel,
          ...summaryGenerationOptions({ prompt, targetSummaryTokens, isSubscription }),
        })
        const summaryUsage = (summaryResult as unknown as {
          usage?: { inputTokens?: number; outputTokens?: number }
        }).usage
        await actUsageBudgetService.recordFinishedUsage({
          forceFreeTierLimits: false,
          inputTokens: summaryUsage?.inputTokens ?? estimatedInputTokens,
          modelId: summaryModelId,
          outputTokens: summaryUsage?.outputTokens ?? targetSummaryTokens,
          reservationId: summaryReservation.reservationId,
          userId,
        })
        return summaryResult.text.trim()
      } catch (error) {
        await actUsageBudgetService.releaseReservation({
          reason: error instanceof Error ? error.message : 'context_summary_provider_failed',
          reservationId: summaryReservation.reservationId,
          userId,
        }).catch((_releaseError) => undefined)
        if (providerWorkStarted && summaryReservation.reservationId) {
          await actUsageBudgetService.markReservationForReconcile({
            errorMessage: error instanceof Error ? error.message : 'context_summary_provider_failed',
            reservationId: summaryReservation.reservationId,
            userId,
          }).catch((_reconcileError) => undefined)
        }
        throw error
      }
    },
    messages: messagesForModel,
    targetModelId: effectiveModelId,
    summarizerModelId: summaryModelId,
    userId,
  })

  const { approvalMode, automationAgent, automationAgentId } = await resolveTurnAgentAuthorization(
    input, userId, billingWorkspaceId, overlayContext, surface,
  )
  const toolPreloadTasks = preloadActExternalToolTasks({
    userId,
    serverSecret,
    workspaceId: billingWorkspaceId,
    approvalMode,
    computerApprovalContext: 'automation',
  })
  const accountAllowedToolIdsTask = filterCatalogResources({
    authorization: overlayContext.authorizationService,
    capability: 'tools.use',
    context: routeContext,
    getId: (toolId) => toolId,
    resourceType: 'tool',
    values: OVERLAY_TOOL_IDS,
  })
  const accountAllowedConnectorIdsTask = toolPreloadTasks.connectedConnectorIdsTask
    .then((connectorIds) => filterCatalogResources({
      authorization: overlayContext.authorizationService,
      capability: 'integrations.use',
      context: routeContext,
      getId: (connectorId) => connectorId,
      resourceType: 'connector',
      values: connectorIds,
    }))
  const [accountAllowedToolIds, accountAllowedConnectorIds] = await Promise.all([
    accountAllowedToolIdsTask,
    accountAllowedConnectorIdsTask,
  ])

  const { agentGrant, allowedToolIds: surfaceAllowedToolIds } = narrowTurnAgentGrant(
    surface, automationAgent, automationAgentId, accountAllowedToolIds, accountAllowedConnectorIds,
  )

  const baseUrl = getBaseUrl()
  const actTooling = await prepareActTooling({
    accountAllowedConnectorIds,
    accountAllowedToolIds: surfaceAllowedToolIds,
    accessToken: undefined,
    agentId: surface?.agentId,
    agentPrincipalId: surface?.agentPrincipalId,
    automationExecution: true,
    ...(!surface ? { automationId: input.automationId } : {}),
    computerApprovalContext: 'automation',
    approvalMode,
    baseUrl,
    conversationId: cid,
    entitlements: runtimeEntitlements,
    effectiveModelId,
    latestUserText: userText,
    memoryEnabled,
    // The agent remembers as itself on surface turns, so what it learns from
    // platform threads accrues to the agent, not the creator's memory.
    memoryOwnerId: surface ? agentMemoryOwnerId(surface.agentId) : undefined,
    mediaToolIntent: resolvedMediaToolIntent,
    paid,
    preloadTasks: toolPreloadTasks,
    requestFingerprint,
    requestedToolIds: [],
    serverSecret,
    turnId: input.turnId,
    userId,
    workspaceId: billingWorkspaceId,
    billingProgrammaticSubjectId,
  })
  if (agentGrant) {
    actTooling.tools = applyAgentCapabilityFilter({
      capabilities: agentGrant.capabilities,
      integrationToolIds: actTooling.integrationToolIds,
      overlayToolIds: actTooling.allowedOverlayToolIds,
      tools: actTooling.tools,
    })
  }

  const instructions = buildActAgentInstructions({
    availableToolIds: Object.keys(actTooling.tools),
    autoRetrieval,
    constants: {
      ACT_KNOWLEDGE_TOOLS_NOTE_NO_WEB,
      ACT_KNOWLEDGE_WEB_TOOLS_NOTE,
      ACT_PAID_PLAN_ACT_TOOLS_REALITY,
      FREE_TIER_NO_PAID_AGENT_CAPABILITIES,
      MATH_FORMAT_INSTRUCTION,
      MEMORY_SAVE_PROTOCOL,
      TABLE_FORMAT_INSTRUCTION,
    },
    docContextText: docContextBundle.contextText,
    effectiveModelId,
    exposedMediaTools: actTooling.exposedMediaTools,
    hasPreloadedDocContext,
    indexedNote,
    memoryContext,
    memoryEnabled,
    mentionsContext,
    mode: undefined,
    paid,
    requestedToolIds: [],
    skillsContext,
    userSystemPromptExtension: buildSecondarySystemPromptExtension(
      surface
        ? buildSurfaceSystemPrompt(surface)
        : buildAutomationSystemPrompt(input),
    ),
    automationExecution: true,
    automationMode: false,
  })

  const modelMessages = await convertToModelMessages(messagesForModel)
  if (!userMessageId) throw new AutomationTurnError('Automation user message was not persisted.')
  const toolDefinitions = await describePersonalChatWorkTools(
    actTooling.tools,
    Boolean(actTooling.toolApproval),
    approvalMode,
  )

  const toolingContext: PersonalChatWorkToolingContext = {
    accountAllowedConnectorIds: [...accountAllowedConnectorIds],
    accountAllowedToolIds: [...surfaceAllowedToolIds],
    integrationToolIds: [...actTooling.integrationToolIds],
    baseUrl,
    billingProgrammaticSubjectId,
    conversationId: cid,
    effectiveModelId,
    entitlements: runtimeEntitlements,
    latestUserText: userText,
    mediaToolIntent: resolvedMediaToolIntent,
    memoryEnabled,
    ...(surface ? { memoryOwnerId: agentMemoryOwnerId(surface.agentId) } : {}),
    paid,
    requestFingerprint,
    requestedToolIds: [],
    turnId: input.turnId,
    userId,
    workspaceId: billingWorkspaceId,
    automationExecution: true,
    ...(!surface ? { automationId: input.automationId, automationRunId: input.runId } : {}),
    approvalMode,
  }

  return {
    conversationId: String(cid),
    effectiveModelId,
    instructions,
    messages: modelMessages,
    paid,
    ...(modelSupportsZeroDataRetention(effectiveModelId)
      ? { providerOptions: { gateway: { zeroDataRetention: true } } }
      : {}),
    reservationId: null,
    userMessageId: String(userMessageId),
    principalId: workspaceAccess.principal.id,
    sourceCitations: sourceCitationMap,
    toolDefinitions,
    toolingContext,
  }
}
