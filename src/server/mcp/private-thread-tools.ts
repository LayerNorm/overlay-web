import 'server-only'

import { randomUUID } from 'node:crypto'
import type { ToolSet } from '@/server/ai/sdk'
import { buildExternalAppTooling } from '@/server/agents/agent-tooling'
import { getOverlayServerContext } from '@/server/bootstrap'
import { workspaceExecutionPolicy } from '@/server/billing/WorkspaceExecutionPolicy'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { logger } from '@/server/observability/logger'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getDeepSearchTool, getWebFetchTool, getWebSearchTool, type WebSearchToolName } from '@/server/tools/tools/web-search'
import type { Entitlements } from '@/shared/app/app-contracts'
import { allAgentToolGrantIds, normalizeAgentToolGrant } from '@/shared/agents/tool-groups'
import { DEFAULT_MODEL_ID } from '@/shared/ai/gateway/model-types'
import {
  allowancePeriod,
  PRIVATE_THREAD_ALLOWANCE_LIMITS,
  PRIVATE_THREAD_ALLOWANCE_MESSAGES,
  privateThreadFreeGrant,
} from '@/shared/billing/private-thread-allowance'
import { MCP_EXTERNAL_WITHHELD_TOOL_IDS } from '@/shared/mcp/access'
import type { McpPrincipal } from './McpAccessService'
import { adaptToolsForMcp } from './mcp-tool-adapter'

/**
 * The Overlay tools of a private thread on Overlay Desktop (internal/develop/private-threads.md). The thread's
 * transcript never reaches Overlay: the Agent Host calls these tools over `/api/mcp` with what each call needs.
 *
 * - Paid workspace: the agent's whole tool grant, charged to the workspace like any agent turn.
 * - Unpaid workspace with just this person: the free tier, the grant narrowed to memory, files, notes, tasks,
 *   skills and web search, with web searches counted against the person's monthly allowance.
 * - Unpaid workspace with other people: no Overlay tools; team workspaces are paid-only.
 */

export type PrivateThreadTier = 'paid' | 'free' | 'none'

const NO_TOOLS = { tools: {} as ToolSet, instructions: '' }

const TIER_NOTE: Record<Exclude<PrivateThreadTier, 'paid'>, string> = {
  free: 'This workspace is on the free tier for private threads: memory, files, notes, tasks, skills and ' +
    `${PRIVATE_THREAD_ALLOWANCE_LIMITS.web_search} web searches a month. Other Overlay tools need a paid workspace.`,
  none: 'Overlay tools in private threads need a paid plan in a workspace with other people.',
}

const WEB_TOOL_NAMES = ['web_search', 'deep_search', 'web_fetch'] as const

export class PrivateThreadAllowanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrivateThreadAllowanceError'
  }
}

/** Counts searches against the person's monthly allowance, atomically in Convex, before they run. */
export async function consumePrivateThreadWebSearches(userId: string, searches: number, now = Date.now()): Promise<void> {
  const result = await convex.mutation<{ ok: boolean; used: number; limit: number }>(
    'platform/privateThreadAllowances:consumeByServer',
    {
      serverSecret: getInternalApiSecret(),
      userId,
      period: allowancePeriod(now),
      resource: 'web_search',
      amount: searches,
      limit: PRIVATE_THREAD_ALLOWANCE_LIMITS.web_search,
    },
    { throwOnError: true },
  )
  if (!result?.ok) throw new PrivateThreadAllowanceError(PRIVATE_THREAD_ALLOWANCE_MESSAGES.web_search)
}

export async function privateThreadTier(principal: Pick<McpPrincipal, 'userId' | 'workspaceId'>): Promise<PrivateThreadTier> {
  const policy = await workspaceExecutionPolicy()
  const { access } = await policy.inspect({ userId: principal.userId, workspaceId: principal.workspaceId, checkBudget: false })
  if (access.canExecute) return 'paid'
  const { humanMemberCount } = await getOverlayServerContext().workspaceService.countMemberKinds({
    actorUserId: principal.userId,
    workspaceId: principal.workspaceId,
  })
  return humanMemberCount <= 1 ? 'free' : 'none'
}

/** Free-tier web tools: the same tools, counted against the allowance instead of charged to the workspace. */
async function freeWebTools(args: { userId: string; workspaceId: string; agentId: string; entitlements: Entitlements }) {
  const context = {
    entitlements: args.entitlements,
    programmaticSubjectId: `private:${args.agentId}`,
    userId: args.userId,
    workspaceId: args.workspaceId,
    allowance: async (_toolName: WebSearchToolName, searches: number) => consumePrivateThreadWebSearches(args.userId, searches),
  }
  const [webSearch, deepSearch, webFetch] = await Promise.all([
    getWebSearchTool(DEFAULT_MODEL_ID, context),
    getDeepSearchTool(DEFAULT_MODEL_ID, context),
    getWebFetchTool(context),
  ])
  return { web_search: webSearch, deep_search: deepSearch, web_fetch: webFetch }
}

/** A refused allowance is a tool result the agent reads and works around, not a failed request. */
function refusingAllowance(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, definition] of Object.entries(tools)) {
    const original = definition as ToolSet[string] & { execute?: (input: unknown, options: unknown) => unknown }
    if (typeof original.execute !== 'function') { wrapped[name] = definition; continue }
    const execute = original.execute.bind(original)
    wrapped[name] = {
      ...original,
      execute: async (input: unknown, options: unknown) => {
        try {
          return await execute(input, options)
        } catch (error) {
          if (error instanceof PrivateThreadAllowanceError) return { success: false, error: error.message }
          throw error
        }
      },
    } as ToolSet[string]
  }
  return wrapped
}

export async function buildPrivateThreadMcpTools(principal: McpPrincipal): Promise<{ tools: ToolSet; instructions: string }> {
  const agentId = principal.agentId
  if (!agentId) return NO_TOOLS
  const server = getOverlayServerContext()
  const agent = await server.workspaceAgentService
    .get({ actorUserId: principal.userId, workspaceId: principal.workspaceId, agentId })
    .catch((_error) => null)
  if (!agent) return NO_TOOLS
  const tier = await privateThreadTier(principal)
  if (tier === 'none') return { tools: {}, instructions: TIER_NOTE.none }

  const agentGrant = agent.isDefault && agent.allowedToolIds.length === 0
    ? allAgentToolGrantIds()
    : normalizeAgentToolGrant(agent.allowedToolIds)
  const grantToolIds = tier === 'free' ? privateThreadFreeGrant(agentGrant) : agentGrant
  const programmaticSubjectId = `private:${agent.id}`
  const entitlements = await server.chatUsagePolicy.getEntitlements({
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    programmaticSubjectId,
  })
  if (!entitlements) return NO_TOOLS
  const requestId = randomUUID()
  const tooling = await buildExternalAppTooling({
    actorUserId: principal.userId,
    effectiveModelId: DEFAULT_MODEL_ID,
    entitlements,
    grantToolIds,
    idempotencyKey: `private:${agent.id}:${requestId}`,
    paid: tier === 'paid',
    requestFingerprint: hashOperationalIdentifier('overlay-private-thread-tools', `${principal.grantId}:${requestId}`),
    turnId: `private_${requestId}`,
    workspaceId: principal.workspaceId,
  })
  let tools = tooling.tools
  if (tier === 'free') {
    const web = await freeWebTools({ userId: principal.userId, workspaceId: principal.workspaceId, agentId: agent.id, entitlements })
    tools = { ...tools }
    for (const name of WEB_TOOL_NAMES) {
      if (!(name in tools)) continue
      const replacement = web[name]
      if (replacement) tools[name] = replacement as ToolSet[string]
      else delete tools[name]
    }
    tools = refusingAllowance(tools)
  }
  const adapted = adaptToolsForMcp({
    tools,
    ...(tooling.toolApproval ? { toolApproval: tooling.toolApproval } : {}),
    ...(tooling.toolsContext ? { toolsContext: tooling.toolsContext } : {}),
    withheldToolIds: MCP_EXTERNAL_WITHHELD_TOOL_IDS,
    approvalRefusal: 'This tool needs approval in an Overlay chat, which a private thread cannot ask for. ' +
      'Tell the user which tool you wanted so they can run it from a synced thread.',
  })
  logger.info('[mcp] private thread tools', { tier, toolCount: Object.keys(adapted).length })
  const names = Object.keys(adapted)
  const instructions = [
    names.length > 0
      ? `Overlay tools act on the person's Overlay workspace (memory, files, notes, tasks…) as ${agent.name}. ` +
        'The conversation itself stays on this computer; each call sends only what that tool needs.'
      : '',
    tier === 'free' ? TIER_NOTE.free : '',
  ].filter(Boolean).join('\n')
  return { tools: adapted, instructions }
}
