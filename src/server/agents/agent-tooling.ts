import 'server-only'

import type { ToolSet } from '@/server/ai/sdk'
import { prepareActTooling, preloadActExternalToolTasks } from '@/server/app-api/v1/conversations/act/tooling'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getInternalApiBaseUrl } from '@/server/web/app-url'
import { logger } from '@/server/observability/logger'
import type { McpToolApprovalFn } from '@/server/tools/mcp-tools'
import { agentMemoryOwnerId } from '@/shared/agents/agent-memory'
import {
  agentToolCapabilities,
  allAgentToolGrantIds,
  normalizeAgentToolGrant,
  overlayToolIdsFromGrant,
  type AgentToolCapability,
} from '@/shared/agents/tool-groups'
import type { Entitlements } from '@/shared/app/app-contracts'

/** Web-search tools, which have no overlay tool id to filter on. */
const WEB_SEARCH_TOOL_IDS = ['perplexity_search', 'parallel_search'] as const
/** MCP meta-tools, which stand in for every tool on every connected server. */
const MCP_TOOL_IDS = ['search_mcp_tools', 'call_mcp_tool'] as const
/**
 * Free-tier stubs are merged after the overlay allow-list is applied, so they
 * are the one way an overlay tool id can reach an agent that was not granted
 * it. They only answer "that needs a paid plan", but an ungranted agent should
 * not see the tool at all.
 */
const FREE_TIER_STUB_TOOL_IDS = [
  'perplexity_search',
  'parallel_search',
  'interactive_browser_session',
  'run_daytona_sandbox',
] as const

export type WorkspaceAgentToolGrant = {
  agentId: string
  allowedToolIds: readonly string[]
  /** The default master agent holds every grant without enumerating them. */
  isDefaultMaster: boolean
}

export type WorkspaceAgentToolingResult = {
  tools: ToolSet
  toolApproval?: McpToolApprovalFn
  toolsContext?: Record<string, unknown>
  /** Tool names exposed this turn, for the audit log. */
  exposedToolIds: string[]
}

/** The effective grant for an agent: the master agent holds everything. */
export function resolveAgentGrant(grant: WorkspaceAgentToolGrant): {
  capabilities: Set<AgentToolCapability>
  overlayToolIds: string[]
} {
  const allowed = grant.isDefaultMaster && grant.allowedToolIds.length === 0
    ? allAgentToolGrantIds()
    : normalizeAgentToolGrant(grant.allowedToolIds)
  return {
    capabilities: agentToolCapabilities(allowed),
    overlayToolIds: overlayToolIdsFromGrant(allowed),
  }
}

/**
 * Removes the tool surfaces the agent was not granted.
 *
 * Overlay tools are already narrowed upstream by `accountAllowedToolIds`, which
 * the act pipeline intersects with its own policy. The surfaces filtered here
 * are the ones assembled by provider paths that carry no stable per-tool id:
 * web search, connected apps, and MCP servers.
 */
function applyAgentCapabilityFilter(args: {
  capabilities: ReadonlySet<AgentToolCapability>
  integrationToolIds: readonly string[]
  overlayToolIds: readonly string[]
  tools: ToolSet
}): ToolSet {
  const withheld = new Set<string>()
  if (!args.capabilities.has('web_search')) WEB_SEARCH_TOOL_IDS.forEach((id) => withheld.add(id))
  if (!args.capabilities.has('mcp')) MCP_TOOL_IDS.forEach((id) => withheld.add(id))
  if (!args.capabilities.has('integrations')) args.integrationToolIds.forEach((id) => withheld.add(id))
  const granted = new Set(args.overlayToolIds)
  for (const stubId of FREE_TIER_STUB_TOOL_IDS) {
    const grantedByCapability = stubId === 'perplexity_search' || stubId === 'parallel_search'
      ? args.capabilities.has('web_search')
      : granted.has(stubId)
    if (!grantedByCapability) withheld.add(stubId)
  }
  if (withheld.size === 0) return args.tools
  return Object.fromEntries(
    Object.entries(args.tools).filter(([toolId]) => !withheld.has(toolId)),
  )
}

/**
 * Builds the tool set for a workspace agent turn.
 *
 * Agents run the same pipeline as personal chat rather than a reduced one, so
 * they inherit connected apps, MCP servers, web search, and every future tool
 * automatically. Two things narrow it: the deployment/account/project policy
 * the pipeline already applies, and the agent's own grant.
 *
 * Tools authenticate as the triggering human (`actorUserId`) — the delegate
 * model. The agent's identity rides along on the tool options for attribution
 * and for memory ownership, not for authorization. See docs/develop/bring-your-own-agents.md,
 * "Agent as principal", for the model that replaces this.
 */
export async function buildWorkspaceAgentTooling(args: {
  accessToken?: string
  actorUserId: string
  agentPrincipalId: string
  conversationId: string
  effectiveModelId: string
  entitlements: Entitlements
  grant: WorkspaceAgentToolGrant
  /** Stable per-turn key so a retried turn does not repeat side effects. */
  idempotencyKey: string
  latestUserText?: string
  memoryEnabled: boolean
  paid: boolean
  requestFingerprint: string
  turnId: string
  workspaceId: string
}): Promise<WorkspaceAgentToolingResult> {
  const { capabilities, overlayToolIds } = resolveAgentGrant(args.grant)
  const tooling = await prepareActTooling({
    accessToken: args.accessToken,
    // The agent's overlay grant enters as account policy, which the pipeline
    // only ever intersects — so a grant can never widen what the workspace
    // already allows.
    accountAllowedToolIds: overlayToolIds,
    agentId: args.grant.agentId,
    agentPrincipalId: args.agentPrincipalId,
    baseUrl: getInternalApiBaseUrl(),
    conversationId: args.conversationId,
    effectiveModelId: args.effectiveModelId,
    entitlements: args.entitlements,
    idempotencyKey: args.idempotencyKey,
    isMultiModelFollowUpSlot: false,
    latestUserText: args.latestUserText,
    mediaToolIntent: null,
    memoryEnabled: args.memoryEnabled,
    // The agent remembers as itself, so what it learns accrues to the agent
    // rather than to the memory of whoever happened to summon it.
    memoryOwnerId: agentMemoryOwnerId(args.grant.agentId),
    mode: 'chat',
    paid: args.paid,
    preloadTasks: preloadActExternalToolTasks({
      userId: args.actorUserId,
      accessToken: args.accessToken,
      serverSecret: getInternalApiSecret(),
    }),
    requestFingerprint: args.requestFingerprint,
    serverSecret: getInternalApiSecret(),
    turnId: args.turnId,
    userId: args.actorUserId,
    workspaceId: args.workspaceId,
  })

  const tools = applyAgentCapabilityFilter({
    capabilities,
    integrationToolIds: tooling.integrationToolIds,
    overlayToolIds: tooling.allowedOverlayToolIds,
    tools: tooling.tools,
  })

  logger.info('[workspace-agent] tools', {
    agentId: args.grant.agentId,
    capabilities: [...capabilities].join(',') || '(none)',
    conversationId: args.conversationId,
    exposedToolCount: Object.keys(tools).length,
    overlayToolIds: tooling.allowedOverlayToolIds.join(',') || '(none)',
  })

  return {
    tools,
    exposedToolIds: Object.keys(tools),
    ...(tooling.toolApproval ? { toolApproval: tooling.toolApproval } : {}),
    ...(tooling.toolsContext ? { toolsContext: tooling.toolsContext } : {}),
  }
}
