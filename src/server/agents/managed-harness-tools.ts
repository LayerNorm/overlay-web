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
 * Overlay workspace tools for managed harness agents (Claude Code, Codex,
 * OpenCode, Pi, Hermes in an Overlay sandbox).
 *
 * The tools are passed to `HarnessAgent` as host-executed tools: the harness
 * asks for a call, and it runs here, in the workflow step, with the same
 * delegate identity and grant as a native agent turn. Nothing — no token, no
 * extra egress — is added to the sandbox.
 */

/**
 * Tools a harness does not get: it already has a shell and file system in its
 * own sandbox (so no second computer or Daytona workspace), and its transcript
 * cannot render generated UI.
 */
export const HARNESS_WITHHELD_TOOL_IDS: ReadonlySet<string> = new Set([
  ...COMPUTER_TOOL_IDS,
  'run_daytona_sandbox',
  'present_generated_ui',
])

export const MCP_APPROVAL_REFUSAL =
  'This MCP tool requires approval in Overlay, and agents running in a managed runtime cannot request approval yet. ' +
  'Tell the user which tool you wanted to call so they can run it from an Overlay chat.'

type ToolDefinition = ToolSet[string]
type ExecuteOptions = { toolCallId?: string; context?: unknown }

/**
 * Adapts a workspace agent's tool set for `HarnessAgent`:
 *  - drops the withheld tools;
 *  - hands each tool its `toolsContext` entry directly (the harness does not
 *    route AI SDK tool context) and drops `contextSchema` so it cannot fail
 *    validation before `execute`;
 *  - refuses MCP calls whose server policy requires approval, because the
 *    harness approval map is static per tool name and cannot express it.
 *    A native agent turn stalls on those instead; refusing is the explicit
 *    equivalent.
 */
export function adaptToolsForHarness(args: {
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

/** Appended to a harness agent's instructions so it reaches for the tools. */
export function harnessOverlayToolsInstructions(toolNames: readonly string[]): string {
  if (toolNames.length === 0) return ''
  return [
    'Overlay workspace tools',
    'Besides your own shell and files, you have tools that act on the Overlay workspace this conversation belongs to: ' +
      'its notes, files, memory, knowledge search, automations, connected apps, and MCP servers. ' +
      'Your sandbox disk is scratch space; anything the team should see belongs in Overlay, written with these tools. ' +
      'Notes are Markdown — read one with get_note and change it with edit_note, replace_note_section, or append_to_note rather than rewriting it.',
    `Available: ${toolNames.join(', ')}.`,
  ].join('\n')
}

/** The agent's grant, carried in the workflow input so each slice rebuilds the same tools. */
export type ManagedHarnessToolGrant = {
  allowedToolIds: string[]
  isDefaultMaster: boolean
}

/**
 * The Overlay tools for one harness slice. Built the same way as a native
 * agent turn (grant, workspace policy, entitlements), so a harness agent and
 * an Overlay agent with the same grant can do the same things in the
 * workspace. Returns no tools, rather than failing the turn, when the grant
 * is missing or the tool pipeline is unavailable.
 */
export async function buildManagedHarnessTools(input: {
  actorUserId: string
  agentId: string
  agentPrincipalId: string
  conversationId: string
  invocationNonce: string
  latestUserText?: string
  memoryEnabled?: boolean
  modelId: string
  toolGrant?: ManagedHarnessToolGrant
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
      // Stable across slices, so a retried slice does not repeat side effects.
      idempotencyKey: `${input.invocationNonce}:harness-tools`,
      ...(input.latestUserText ? { latestUserText: input.latestUserText } : {}),
      memoryEnabled: input.memoryEnabled !== false,
      paid: canUsePaidBudgetFeatures(entitlements),
      requestFingerprint: hashOperationalIdentifier('workspace-agent-harness-tools', input.invocationNonce),
      turnId: input.turnId,
      workspaceId: input.workspaceId,
    })
    const tools = adaptToolsForHarness(tooling)
    return { tools, instructions: harnessOverlayToolsInstructions(Object.keys(tools)) }
  } catch (error) {
    logger.warn('[managed-harness] Overlay tools unavailable for this slice', {
      agentId: input.agentId,
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { tools: {}, instructions: '' }
  }
}
