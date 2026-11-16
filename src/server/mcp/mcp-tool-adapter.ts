import 'server-only'

import type { ToolSet } from '@/server/ai/sdk'
import type { McpToolApprovalFn } from '@/server/tools/mcp-tools'
import { COMPUTER_TOOL_IDS } from '@/shared/agents/tool-groups'

/**
 * Adapts Overlay workspace tools for apps that call them over MCP (Settings →
 * Connected apps). Each call runs on Overlay's servers with the caller's
 * delegate identity, exactly as a native agent turn would.
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
  'This MCP tool requires approval in Overlay, and this client cannot request approval. ' +
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
  /** Extra tools to withhold beyond the harness set. */
  withheldToolIds?: readonly string[]
  /** What a refused tool call tells the client. */
  approvalRefusal?: string
  /** Asks the person for approval and waits for the answer; without it a tool that needs approval is refused. */
  requestApproval?: (toolName: string, input: unknown) => Promise<{ allowed: true } | { allowed: false; message: string }>
  /** Rechecked after any human wait and immediately before executing a tool. */
  authorize?: () => Promise<boolean>
  /** Durable calls claim their side effect only after the owner's policy allows it. */
  beforeExecute?: (approvalRequired: boolean) => Promise<void>
}): ToolSet {
  const adapted: ToolSet = {}
  const withheld = new Set(args.withheldToolIds ?? [])
  for (const [name, definition] of Object.entries(args.tools)) {
    if (HARNESS_WITHHELD_TOOL_IDS.has(name) || withheld.has(name)) continue
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
        if (decision === 'user-approval') {
          if (!args.requestApproval) return { success: false, error: args.approvalRefusal ?? MCP_APPROVAL_REFUSAL }
          const outcome = await args.requestApproval(name, input ?? {})
          if (!outcome.allowed) return { success: false, error: outcome.message }
        }
        if (args.authorize && !(await args.authorize())) return { success: false, error: 'This agent execution is no longer authorized.' }
        await args.beforeExecute?.(decision === 'user-approval')
        const context = args.toolsContext?.[name]
        return await execute(input, context === undefined ? options : { ...options, context })
      },
    } as unknown as ToolDefinition
  }
  return adapted
}
