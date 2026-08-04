import { logger } from '@/server/observability/logger'
import type { ToolSet } from '@/server/ai/sdk'
import {
  getOverlayRuntimeConfig,
  getOverlayRuntimeConfigSync,
} from '@/server/config'
import {
  deriveOverlayCapabilities,
  normalizeIntegrationProviderKey,
  type CapabilityCheck,
} from '@overlay/app-core'
import {
  getGatewayParallelSearchTool,
  getGatewayPerplexitySearchTool,
} from '@/server/ai/model-runtime'
import {
  filterGatewayCompatibleToolSet,
  summarizeGatewayToolSchemaViolations,
} from '@/server/ai/gateway/tool-schema-compat'
import {
  createIntegrationToolSet,
  filterIntegrationToolSet,
  getIntegrationProvider,
  getSelectedIntegrationProviderId,
} from '@/server/integrations'
import { createMcpLazyMetaTools, type McpToolApprovalFn } from '@/server/tools/mcp-tools'
import {
  applyProjectToolPolicy,
  type ProjectSettings,
} from '@/shared/projects/project-settings'
import {
  allowedOverlayToolIdsForTurn,
} from '@/server/tools/tools/exposure-policy'
import { createFreeTierGatedStubTools } from '@/server/tools/tools/free-tier-gated-stub-tools'
import { createWebTools } from '@/server/web/web-tools'
import {
  summarizeErrorForLog,
  summarizeToolIndexMapForLog,
  summarizeToolSetForLog,
} from '@/shared/security/safe-log'
import type { ChatToolRequestId } from '@/shared/chat/tool-requests'
import type { Entitlements } from '@/shared/app/app-contracts'

type ActMode = 'chat' | 'automate'
type MediaToolIntent = 'image' | 'video' | null
type ToolDefinition = ToolSet[string]

export interface ActToolPreloadTasks {
  connectedConnectorIdsTask: Promise<string[]>
  integrationToolsTask: Promise<ToolSet>
}

export interface ActTooling {
  allowedOverlayToolIds: string[]
  composioStrippedForCompareSlot: boolean
  exposedMediaTools: string[]
  gatewaySearchLog: string
  missingGatewaySearchTools: boolean
  tools: ToolSet
  /** v7 toolApproval function for MCP tools (replaces deprecated per-tool needsApproval). */
  toolApproval?: McpToolApprovalFn
  /** Populated when TTFT_DEBUG timing is collected during prepareActTooling. */
  ttft?: {
    mcpCatalogMs: number
  }
}

export function preloadActExternalToolTasks(params: {
  accessToken?: string
  serverSecret: string
  userId: string
}): ActToolPreloadTasks {
  try {
    if (!getActCapabilitiesSync().integrations) {
      return {
        connectedConnectorIdsTask: Promise.resolve([]),
        integrationToolsTask: Promise.resolve({} as ToolSet),
      }
    }
  } catch (_error) {
    return {
      connectedConnectorIdsTask: Promise.resolve([]),
      integrationToolsTask: Promise.resolve({} as ToolSet),
    }
  }

  const connectedConnectorIdsTask = getIntegrationProvider()
    .listConnections({
      userId: params.userId,
      accessToken: params.accessToken,
    })
    .then((connections) => [...new Set(connections
      .map(({ providerKey }) => normalizeIntegrationProviderKey(providerKey)))])
    .catch((error) => {
      logger.warn(
        '[conversations/act] connected connector preload failed:',
        summarizeErrorForLog(error),
      )
      return []
    })
  const integrationToolsTask = createIntegrationToolSet({
    userId: params.userId,
    accessToken: params.accessToken,
  })
  void integrationToolsTask.catch((error) => {
    logger.warn('[conversations/act] integration tool preload failed:', summarizeErrorForLog(error))
  })

  return { connectedConnectorIdsTask, integrationToolsTask }
}

export async function prepareActTooling(params: {
  accountAllowedConnectorIds?: readonly string[]
  accountAllowedToolIds?: readonly string[]
  accessToken?: string
  automationExecution?: boolean
  automationMode?: boolean
  automationId?: string
  baseUrl: string
  conversationId?: string
  conversationProjectId?: string
  /** Knowledge bases in scope this turn; steers tools toward the scoped variants. */
  activeKnowledgeBaseIds?: readonly string[]
  /** Configuration of the conversation's project, when it has one. */
  projectSettings?: ProjectSettings
  entitlements: Entitlements
  effectiveModelId: string
  forwardCookie?: string | null
  isMultiModelFollowUpSlot: boolean
  latestUserText?: string
  memoryEnabled?: boolean
  mediaToolIntent: MediaToolIntent
  mode?: ActMode
  paid: boolean
  preloadTasks: ActToolPreloadTasks
  requestFingerprint: string
  requestedToolIds?: readonly ChatToolRequestId[]
  serverSecret: string
  turnId: string
  userId: string
}): Promise<ActTooling> {
  const capabilities = await getActCapabilities()
  const memoryEnabled = params.memoryEnabled !== false && capabilities.memory && capabilities.vectorSearch
  // Account and project policies are applied after deployment gates and only
  // ever narrow, so neither can reintroduce a tool the deployment withheld.
  // Project policy remains last so it can further constrain account access.
  const accountScopedToolIds = applyAccountToolPolicy(applyRuntimeToolGates(
    withRequestedOverlayToolIds(
      allowedOverlayToolIdsForTurn({
        latestUserText: params.latestUserText ?? '',
        automationMode: params.automationMode === true || params.mode === 'automate',
        automationExecution: params.automationExecution === true,
        mediaToolIntent: params.mediaToolIntent,
      }),
      params.requestedToolIds ?? [],
      memoryEnabled,
    ),
    capabilities,
  ), params.accountAllowedToolIds)
  // Project policy is applied last and only ever narrows, so a project can never
  // reintroduce a tool the account or deployment already withheld. This gate lives
  // at the tool layer deliberately: Phase 4 scoped only the retrieval path and left
  // the agent's tools reachable, which is how a knowledge base answered from
  // unrelated files.
  const allowedOverlayToolIds = applyProjectToolPolicy(
    accountScopedToolIds,
    params.projectSettings,
  )

  const mcpCatalogStartedAt = performance.now()
  const mcpToolsTask: Promise<{ tools: ToolSet; toolApproval?: McpToolApprovalFn }> =
    params.isMultiModelFollowUpSlot || !capabilities.mcpServers
      ? Promise.resolve({ tools: {} })
      : createMcpLazyMetaTools({
          userId: params.userId,
          accessToken: params.accessToken,
          serverSecret: params.serverSecret,
          conversationId: params.conversationId,
          turnId: params.turnId,
          modelId: params.effectiveModelId,
          projectId: params.conversationProjectId,
          enabledServerIds: params.projectSettings?.enabledMcpServerIds,
        })
  const [integrationRaw, mcpToolsResult, webToolSet, perplexityTool, parallelTool] = await Promise.all([
    capabilities.integrations ? params.preloadTasks.integrationToolsTask : Promise.resolve({} as ToolSet),
    mcpToolsTask,
    Promise.resolve(
      createWebTools({
        userId: params.userId,
        accessToken: params.accessToken,
        serverSecret: params.serverSecret,
        conversationId: params.conversationId,
        turnId: params.turnId,
        automationId: params.automationId,
        projectId: params.conversationProjectId,
        baseUrl: params.baseUrl,
        allowedToolIds: allowedOverlayToolIds,
        forwardCookie: params.forwardCookie ?? undefined,
        includePaidOnlyOverlayTools: params.paid,
        memoryEnabled,
        activeKnowledgeBaseIds: params.activeKnowledgeBaseIds,
      }),
    ),
    params.paid && capabilities.webSearch
      ? getGatewayPerplexitySearchTool(params.accessToken, params.effectiveModelId, {
          entitlements: params.entitlements,
          requestFingerprint: params.requestFingerprint,
          userId: params.userId,
        })
      : Promise.resolve(null),
    params.paid && capabilities.webSearch
      ? getGatewayParallelSearchTool(params.accessToken, params.effectiveModelId, {
          entitlements: params.entitlements,
          requestFingerprint: params.requestFingerprint,
          userId: params.userId,
        })
      : Promise.resolve(null),
  ])

  const mcpCatalogMs = params.isMultiModelFollowUpSlot
    ? 0
    : performance.now() - mcpCatalogStartedAt

  const tooling = buildActTooling({
    allowedOverlayToolIds,
    integrationProvider: getSelectedIntegrationProviderId(),
    integrationRaw,
    isMultiModelFollowUpSlot: params.isMultiModelFollowUpSlot,
    mcpToolsRaw: mcpToolsResult.tools,
    mcpToolApproval: mcpToolsResult.toolApproval,
    paid: params.paid,
    parallelTool,
    perplexityTool,
    webToolSet,
    enabledConnectorSlugs: intersectConnectorPolicies(
      params.accountAllowedConnectorIds,
      params.projectSettings?.enabledConnectorSlugs,
    ),
  })

  tooling.ttft = { mcpCatalogMs: +mcpCatalogMs.toFixed(1) }

  if (!params.paid) {
    return tooling
  }

  const compatible = await filterGatewayCompatibleToolSet(tooling.tools)
  if (compatible.dropped.length === 0) {
    return tooling
  }

  logger.warn(
    '[conversations/act] dropped Gateway-incompatible tools:',
    summarizeGatewayToolSchemaViolations(compatible.dropped),
  )
  return {
    ...tooling,
    tools: compatible.tools,
  }
}

export function applyAccountToolPolicy(
  deploymentAllowedToolIds: readonly string[],
  accountAllowedToolIds?: readonly string[],
): string[] {
  if (accountAllowedToolIds === undefined) return [...deploymentAllowedToolIds]
  const accountIds = new Set(accountAllowedToolIds)
  return deploymentAllowedToolIds.filter((toolId) => accountIds.has(toolId))
}

export function intersectConnectorPolicies(
  accountAllowedConnectorIds?: readonly string[],
  projectEnabledConnectorIds?: readonly string[],
): string[] | undefined {
  if (accountAllowedConnectorIds === undefined) {
    return projectEnabledConnectorIds === undefined
      ? undefined
      : projectEnabledConnectorIds.map(normalizeIntegrationProviderKey)
  }
  const accountIds = accountAllowedConnectorIds.map(normalizeIntegrationProviderKey)
  if (projectEnabledConnectorIds === undefined) return accountIds
  const projectIds = new Set(projectEnabledConnectorIds.map(normalizeIntegrationProviderKey))
  return accountIds.filter((id) => projectIds.has(id))
}

export function buildActTooling(params: {
  allowedOverlayToolIds: string[]
  integrationProvider?: 'composio' | 'executor' | 'none'
  integrationRaw: ToolSet
  isMultiModelFollowUpSlot: boolean
  mcpToolsRaw: ToolSet
  mcpToolApproval?: McpToolApprovalFn
  paid: boolean
  parallelTool: ToolDefinition | null
  perplexityTool: ToolDefinition | null
  webToolSet: ToolSet
  enabledConnectorSlugs?: readonly string[]
}): ActTooling {
  const integrationTools = filterIntegrationToolSet(
    params.integrationRaw,
    params.paid,
    params.integrationProvider,
    params.enabledConnectorSlugs,
  )
  const integrationsForAgent: ToolSet = params.isMultiModelFollowUpSlot ? {} : integrationTools
  const freeTierStubsActive = !params.paid && !params.isMultiModelFollowUpSlot
  const freeTierGatedStubs: ToolSet = createFreeTierGatedStubTools(freeTierStubsActive)
  const mcpTools: ToolSet = params.isMultiModelFollowUpSlot ? {} : params.mcpToolsRaw
  const tools: ToolSet = {
    ...integrationsForAgent,
    ...mcpTools,
    ...params.webToolSet,
    ...freeTierGatedStubs,
    ...(params.perplexityTool ? { perplexity_search: params.perplexityTool } : {}),
    ...(params.parallelTool ? { parallel_search: params.parallelTool } : {}),
  }

  return {
    allowedOverlayToolIds: params.allowedOverlayToolIds,
    composioStrippedForCompareSlot: params.isMultiModelFollowUpSlot,
    exposedMediaTools: exposedMediaToolIds(params.webToolSet),
    gatewaySearchLog: [
      `perplexity:${params.perplexityTool ? 'yes' : 'no'}`,
      `parallel:${params.parallelTool ? 'yes' : 'no'}`,
    ].join(' '),
    missingGatewaySearchTools: !params.perplexityTool || !params.parallelTool,
    tools,
    ...(params.mcpToolApproval && !params.isMultiModelFollowUpSlot
      ? { toolApproval: params.mcpToolApproval }
      : {}),
  }
}

export function logActTooling(tooling: Pick<ActTooling,
  'allowedOverlayToolIds' |
  'composioStrippedForCompareSlot' |
  'gatewaySearchLog' |
  'missingGatewaySearchTools' |
  'tools'
>): void {
  logger.info(
    '[conversations/act] tools:',
    summarizeToolSetForLog(tooling.tools),
    '| tool_index_map:',
    summarizeToolIndexMapForLog(tooling.tools),
    tooling.composioStrippedForCompareSlot ? '| composio:stripped_for_compare_slot' : '',
    '| allowed_overlay_tools:',
    tooling.allowedOverlayToolIds.join(', ') || '(none)',
    '| web_search (AI Gateway):',
    tooling.gatewaySearchLog,
    tooling.missingGatewaySearchTools ? ' — if missing, check AI_GATEWAY_API_KEY and Gateway logs' : '',
  )
}

function exposedMediaToolIds(webToolSet: ToolSet): string[] {
  return [
    'generate_image',
    'generate_video',
    'animate_image',
    'generate_video_with_reference',
    'apply_motion_control',
    'edit_video',
  ].filter((toolId) => toolId in webToolSet)
}

function withRequestedOverlayToolIds(
  baseToolIds: string[],
  requestedToolIds: readonly ChatToolRequestId[],
  memoryEnabled: boolean,
): string[] {
  const allowed = new Set(baseToolIds)
  if (!memoryEnabled) {
    allowed.delete('save_memory')
    allowed.delete('save_memory_batch')
    allowed.delete('update_memory')
    allowed.delete('delete_memory')
  }

  for (const toolId of requestedToolIds) {
    if (toolId === 'memory' && memoryEnabled) {
      allowed.add('search_knowledge')
      allowed.add('save_memory')
      allowed.add('save_memory_batch')
    }
    if (toolId === 'sandbox') {
      allowed.add('run_daytona_sandbox')
    }
    if (toolId === 'browser') {
      allowed.add('interactive_browser_session')
    }
  }

  return Array.from(allowed)
}

function applyRuntimeToolGates(
  toolIds: string[],
  capabilities: CapabilityCheck,
): string[] {
  const allowed = new Set(toolIds)
  if (!capabilities.memory || !capabilities.vectorSearch) {
    allowed.delete('search_knowledge')
    allowed.delete('save_memory')
    allowed.delete('save_memory_batch')
    allowed.delete('update_memory')
    allowed.delete('delete_memory')
  }
  if (!capabilities.knowledge) {
    allowed.delete('search_knowledge')
  }
  if (!capabilities.browserUse) {
    allowed.delete('interactive_browser_session')
  }
  if (!capabilities.sandboxes) {
    allowed.delete('run_daytona_sandbox')
  }
  if (!capabilities.automations) {
    allowed.delete('schedule_automation')
    allowed.delete('list_automations')
    allowed.delete('cancel_automation')
  }
  return Array.from(allowed)
}

function getActCapabilitiesSync(): CapabilityCheck {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveOverlayCapabilities()
  }
  return deriveOverlayCapabilities(getOverlayRuntimeConfigSync())
}

async function getActCapabilities(): Promise<CapabilityCheck> {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return deriveOverlayCapabilities()
  }
  return deriveOverlayCapabilities(await getOverlayRuntimeConfig())
}
