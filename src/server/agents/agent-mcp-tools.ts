import 'server-only'

import type { ToolSet } from '@/server/ai/sdk'
import { buildWorkspaceAgentTooling } from '@/server/agents/agent-tooling'
import { getOverlayServerContext } from '@/server/bootstrap'
import { canUsePaidBudgetFeatures } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import type { McpToolApprovalFn } from '@/server/tools/mcp-tools'
import { COMPUTER_TOOL_IDS } from '@/shared/agents/tool-groups'

/**
 * Overlay workspace tools for agents that connect over MCP (`/api/agent-mcp`).
 *
 * The tool set is the one a native Overlay agent with the same grant gets —
 * built by `buildWorkspaceAgentTooling`, then adapted here — and every call runs
 * on Overlay's servers with the same delegate identity as a native agent turn.
 */

/**
 * Tools an MCP client does not get: it has its own machine and file system (so no
 * second computer or code sandbox), and its transcript cannot render generated UI.
 */
export const HARNESS_WITHHELD_TOOL_IDS: ReadonlySet<string> = new Set([
  ...COMPUTER_TOOL_IDS,
  'present_generated_ui',
])

export const MCP_APPROVAL_REFUSAL =
  'This MCP tool requires approval in Overlay, and agents running in a managed runtime cannot request approval yet. ' +
  'Tell the user which tool you wanted to call so they can run it from an Overlay chat.'

type ToolDefinition = ToolSet[string]
type ExecuteOptions = { toolCallId?: string; context?: unknown }

/**
 * Adapts a workspace agent's tool set for MCP clients:
 *  - drops the withheld tools;
 *  - hands each tool its `toolsContext` entry directly (MCP clients do not
 *    route AI SDK tool context) and drops `contextSchema` so it cannot fail
 *    validation before `execute`;
 *  - refuses MCP calls whose server policy requires approval, because the
 *    MCP clients have no room approval flow for them.
 *    A native agent turn stalls on those instead; refusing is the explicit
 *    equivalent.
 */
export function adaptToolsForMcp(args: {
  tools: ToolSet
  toolApproval?: McpToolApprovalFn
  toolsContext?: Record<string, unknown>
}): ToolSet {
  const adapted: ToolSet = {}
  for (const [name, definition] of Object.entries(args.tools)) {
    if (HARNESS_WITHHELD_TOOL_IDS.has(name)) continue
    const original = definition as ToolDefinition & {
      contextSchema?: unknown
      execute?: (input: unknown, options: ExecuteOptions) => unknown
    }
    if (typeof original.execute !== 'function') continue
    const execute = original.execute.bind(original)
    const { contextSchema: _contextSchema, ...rest } = original
    void _contextSchema
    adapted[name] = {
      ...rest,
      execute: async (input: unknown, options: ExecuteOptions) => {
        const decision = args.toolApproval?.({
          toolCall: { toolName: name, input: (input ?? {}) as Record<string, unknown> },
        })
        if (decision === 'user-approval') return { success: false, error: MCP_APPROVAL_REFUSAL }
        const context = args.toolsContext?.[name]
        return await execute(input, context === undefined ? options : { ...options, context })
      },
    } as unknown as ToolDefinition
  }
  return adapted
}

/** Server instructions telling an MCP client what the Overlay tools are for. */
export function overlayMcpInstructions(toolNames: readonly string[]): string {
  if (toolNames.length === 0) return ''
  return [
    'Overlay workspace tools',
    'Besides your own shell and files, you also have tools that act on the Overlay workspace this conversation belongs to: ' +
      'its notes, files, memory, knowledge search, automations, connected apps, and MCP servers. ' +
      'Your own disk is scratch space; anything the team should see belongs in Overlay, written with these tools. ' +
      'Notes are Markdown — read one with get_note and change it with edit_note, replace_note_section, or append_to_note rather than rewriting it.',
    `Available: ${toolNames.join(', ')}.`,
  ].join('\n')
}

/** The agent's grant, carried in the MCP token so each request rebuilds the same tools. */
export type AgentMcpToolGrant = {
  allowedToolIds: string[]
  isDefaultMaster: boolean
}

/**
 * The Overlay tools for one MCP request. Built the same way as a native
 * agent turn (grant, workspace policy, entitlements), so an MCP-connected agent and
 * an Overlay agent with the same grant can do the same things in the
 * workspace. Returns no tools, rather than failing the turn, when the grant
 * is missing or the tool pipeline is unavailable.
 */
export async function buildAgentMcpTools(input: {
  actorUserId: string
  agentId: string
  agentPrincipalId: string
  conversationId: string
  invocationNonce: string
  latestUserText?: string
  memoryEnabled?: boolean
  modelId: string
  toolGrant?: AgentMcpToolGrant
  turnId: string
  workspaceId: string
}): Promise<{ tools: ToolSet; instructions: string }> {
  if (!input.toolGrant) return { tools: {}, instructions: '' }
  try {
    const entitlements = await getOverlayServerContext().chatUsagePolicy.getEntitlements({
      userId: input.actorUserId,
      workspaceId: input.workspaceId,
      programmaticSubjectId: `agent:${input.agentId}`,
    })
    if (!entitlements) return { tools: {}, instructions: '' }
    const tooling = await buildWorkspaceAgentTooling({
      actorUserId: input.actorUserId,
      agentPrincipalId: input.agentPrincipalId,
      conversationId: input.conversationId,
      effectiveModelId: input.modelId,
      entitlements,
      grant: { agentId: input.agentId, ...input.toolGrant },
      // Stable across requests of one run, so a retried call does not repeat side effects.
      idempotencyKey: `${input.invocationNonce}:mcp-tools`,
      ...(input.latestUserText ? { latestUserText: input.latestUserText } : {}),
      memoryEnabled: input.memoryEnabled !== false,
      paid: canUsePaidBudgetFeatures(entitlements),
      requestFingerprint: hashOperationalIdentifier('workspace-agent-mcp-tools', input.invocationNonce),
      turnId: input.turnId,
      workspaceId: input.workspaceId,
    })
    const tools = adaptToolsForMcp(tooling)
    return { tools, instructions: overlayMcpInstructions(Object.keys(tools)) }
  } catch (error) {
    logger.warn('[agent-mcp] Overlay tools unavailable for this request', {
      agentId: input.agentId,
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { tools: {}, instructions: '' }
  }
}
