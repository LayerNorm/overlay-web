import type { ToolExecutionOptions } from 'ai'
import type { HarnessApprovalRequest, HarnessExecutionPorts } from './ports'

export type HarnessToolExecutionOptions = ToolExecutionOptions<unknown> & { harnessApproved?: boolean }
type Decisions = NonNullable<Awaited<ReturnType<HarnessExecutionPorts['waitForApproval']>>>

function canonicalInput(input: unknown): string | undefined {
  return JSON.stringify(input, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
}

// Only authenticated wait decisions populate this workflow-local ledger.
// Conversation content and provider-supplied approval parts never grant authority.
export function createHarnessToolApprovals() {
  const approved = new Map<string, { toolName: string; input: string | undefined }>()
  return {
    record(requests: HarnessApprovalRequest[], decisions: Decisions): void {
      approved.clear()
      if (new Set(requests.map(request => request.toolCallId)).size !== requests.length) {
        throw new Error('Approval requests must have unique tool call identities.')
      }
      for (const request of requests) {
        if (decisions.find(decision => decision.approvalId === request.approvalId)?.approved === true) {
          approved.set(request.toolCallId, { toolName: request.toolName, input: canonicalInput(request.input) })
        }
      }
    },
    consume(toolName: string, toolCallId: string, input: unknown): boolean {
      const decision = approved.get(toolCallId)
      approved.delete(toolCallId)
      return decision?.toolName === toolName && decision.input === canonicalInput(input)
    },
  }
}

export type HarnessToolApprovals = ReturnType<typeof createHarnessToolApprovals>
