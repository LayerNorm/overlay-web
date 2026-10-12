import 'server-only'

import { createHash } from 'node:crypto'
import type { ConnectedAgentRepository } from './ConnectedAgentRepository'

/**
 * Approval for an Overlay tool a connected agent called over MCP.
 *
 * The call asks for approval in the run's conversation (the same card an agent's own
 * permission request shows), then waits a short while for the answer. If the person
 * has not answered by then it returns instead of holding the connection (agent hosts
 * time MCP calls out in about a minute), and tells the agent to call again with the
 * same arguments: the answer is remembered for this run, so the retry runs at once.
 * A denial, or the run ending, refuses.
 */

export const MCP_APPROVAL_POLL_MS = 2_000
export const MCP_APPROVAL_WAIT_MS = 25_000
const MAX_PROMPT_ARGS_CHARS = 240

export type McpApprovalOutcome = { allowed: true } | { allowed: false; message: string }

type Gateway = Pick<ConnectedAgentRepository, 'requestMcpApproval'>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** One tool with one set of arguments is one request, however many times the agent asks. */
export function mcpApprovalRequestKey(toolName: string, input: unknown): string {
  return `mcp:${createHash('sha256').update(`${toolName}\n${stableJson(input ?? {})}`).digest('hex').slice(0, 24)}`
}

export function mcpApprovalPrompt(toolName: string, input: unknown): string {
  const args = stableJson(input ?? {})
  const shown = args.length > MAX_PROMPT_ARGS_CHARS ? `${args.slice(0, MAX_PROMPT_ARGS_CHARS)}…` : args
  return `Allow the agent to run ${toolName}? ${shown === '{}' ? '' : shown}`.trim()
}

export function createMcpApprovalGate(args: {
  repository: Gateway
  workspaceId: string
  environmentId: string
  runId: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  waitMs?: number
}): (toolName: string, input: unknown) => Promise<McpApprovalOutcome> {
  const now = args.now ?? Date.now
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const waitMs = args.waitMs ?? MCP_APPROVAL_WAIT_MS
  return async (toolName, input) => {
    const requestKey = mcpApprovalRequestKey(toolName, input)
    const prompt = mcpApprovalPrompt(toolName, input)
    const deadline = now() + waitMs
    for (;;) {
      const status = await args.repository.requestMcpApproval({
        workspaceId: args.workspaceId, environmentId: args.environmentId, runId: args.runId, requestKey, prompt, now: now(),
      })
      if (status.state === 'unavailable') {
        return { allowed: false, message: `${toolName} needs approval in Overlay, but this run can no longer ask for it.` }
      }
      if (status.state === 'resolved') {
        return status.decision === 'allow'
          ? { allowed: true }
          : { allowed: false, message: `The user did not allow ${toolName}${status.decision === 'deny' ? '' : ' (the run ended first)'}. Do not retry it; continue without it or ask the user.` }
      }
      if (now() >= deadline) {
        return {
          allowed: false,
          message: `${toolName} is waiting for the user's approval in the Overlay conversation. Tell the user, then call ${toolName} again with the same arguments once they have approved.`,
        }
      }
      await sleep(Math.min(MCP_APPROVAL_POLL_MS, Math.max(0, deadline - now())))
    }
  }
}
