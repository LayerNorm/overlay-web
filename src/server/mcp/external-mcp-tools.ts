import 'server-only'

import { randomUUID } from 'node:crypto'
import type { ToolSet } from '@/server/ai/sdk'
import { buildExternalAppTooling } from '@/server/agents/agent-tooling'
import { adaptToolsForMcp } from '@/server/agents/agent-mcp-tools'
import { getOverlayServerContext } from '@/server/bootstrap'
import { canUsePaidBudgetFeatures } from '@/server/billing/billing-runtime'
import { logger } from '@/server/observability/logger'
import { hashOperationalIdentifier } from '@/server/security/operational-key-hash'
import { MCP_ACCESS_LABEL, MCP_EXTERNAL_WITHHELD_TOOL_IDS, mcpToolGrantFor } from '@/shared/mcp/access'
import type { McpPrincipal } from './McpAccessService'

export const EXTERNAL_MCP_APPROVAL_REFUSAL =
  'This tool needs the owner\'s approval inside Overlay, and apps connected over MCP cannot ask for it. ' +
  'Tell the user which tool you wanted so they can run it from an Overlay chat.'

function instructionsFor(principal: McpPrincipal, workspaceName: string | null, toolNames: readonly string[]): string {
  if (toolNames.length === 0) return ''
  return [
    `Overlay${workspaceName ? ` — ${workspaceName}` : ''}`,
    'These tools act on the owner\'s Overlay workspace: their notes, files, memory, and knowledge' +
      (toolNames.includes('create_automation') ? ', automations' : '') +
      (toolNames.some((name) => name.includes('mcp')) ? ', connected apps, and MCP servers' : '') + '. ' +
      `Access is limited to what the owner chose for ${principal.clientName}: ${MCP_ACCESS_LABEL[principal.access].toLowerCase()}. ` +
      'Notes are Markdown — read one with get_note and change it with edit_note, replace_note_section, or append_to_note rather than rewriting it. ' +
      'Memory is shared with the owner\'s other apps, so save only what is worth remembering.',
    `Available: ${toolNames.join(', ')}.`,
  ].join('\n')
}

/**
 * The Overlay tools for one MCP request from an outside app: the person's grant
 * level, run through the same tool pipeline, policy, and entitlements as an Overlay
 * agent, acting as that person. Returns no tools, rather than failing the request,
 * when the pipeline is unavailable.
 */
export async function buildOverlayMcpTools(principal: McpPrincipal): Promise<{ tools: ToolSet; instructions: string }> {
  try {
    const server = getOverlayServerContext()
    const entitlements = await server.chatUsagePolicy.getEntitlements({
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      programmaticSubjectId: `mcp:${principal.grantId}`,
    })
    if (!entitlements) return { tools: {}, instructions: '' }
    const requestId = randomUUID()
    const tooling = await buildExternalAppTooling({
      actorUserId: principal.userId,
      // The effective model only picks provider-specific tool variants; MCP tools do not run a model.
      effectiveModelId: 'openrouter/free',
      entitlements,
      grantToolIds: mcpToolGrantFor(principal.access),
      idempotencyKey: `mcp:${principal.grantId}:${requestId}`,
      paid: canUsePaidBudgetFeatures(entitlements),
      requestFingerprint: hashOperationalIdentifier('overlay-mcp-external-tools', `${principal.grantId}:${requestId}`),
      turnId: `mcp_${requestId}`,
      workspaceId: principal.workspaceId,
    })
    const tools = adaptToolsForMcp({
      tools: tooling.tools,
      ...(tooling.toolApproval ? { toolApproval: tooling.toolApproval } : {}),
      ...(tooling.toolsContext ? { toolsContext: tooling.toolsContext } : {}),
      withheldToolIds: MCP_EXTERNAL_WITHHELD_TOOL_IDS,
      approvalRefusal: EXTERNAL_MCP_APPROVAL_REFUSAL,
    })
    const workspace = await server.workspaceService.resolveActiveWorkspace(principal.userId, principal.workspaceId).catch((_error) => null)
    return { tools, instructions: instructionsFor(principal, workspace?.workspace.name ?? null, Object.keys(tools)) }
  } catch (error) {
    logger.warn('[mcp] Overlay tools unavailable for this request', {
      grantId: principal.grantId,
      reason: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
    })
    return { tools: {}, instructions: '' }
  }
}
