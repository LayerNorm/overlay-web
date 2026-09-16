import 'server-only'

/**
 * Pure helpers for managed-harness tool approvals — extracted from
 * `managed-harness-steps.ts` so they are unit-testable without pulling the
 * server repository graph into the test bundle.
 *
 * See `docs/plans/MANAGED_HARNESS_AGENTS_PLAN.md`, Phase 4.
 */

export type ManagedHarnessPendingApproval = {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  providerExecuted?: boolean
}

/**
 * Pending approvals carried on a suspended turn's `continueFrom` handle —
 * `HarnessV1ContinueTurnState.pendingToolApprovals`. Kept structural so the
 * workflow never imports harness types into its bundle.
 */
export function pendingHarnessApprovals(
  continueFrom: Record<string, unknown> | undefined,
): ManagedHarnessPendingApproval[] {
  const pending = continueFrom?.pendingToolApprovals
  if (!Array.isArray(pending)) return []
  return pending.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    if (typeof record.approvalId !== 'string'
      || typeof record.toolCallId !== 'string'
      || typeof record.toolName !== 'string') {
      return []
    }
    return [{
      approvalId: record.approvalId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      input: record.input,
      ...(record.providerExecuted === true ? { providerExecuted: true as const } : {}),
    }]
  })
}

/**
 * Builds the message list that delivers approval decisions into a suspended
 * turn. `HarnessAgent.stream({ session, messages })` recognizes a trailing
 * `role:'tool'` message of `tool-approval-response` parts — matched against
 * `tool-approval-request`/`tool-call` parts earlier in the same list — and
 * forwards them to the harness's pending approval queue instead of starting
 * a fresh prompt turn. The session's own state carries the real transcript;
 * this list only needs to cross-reference the pending set.
 */
export function harnessApprovalContinuationMessages(
  pending: readonly ManagedHarnessPendingApproval[],
  decision: { approved: boolean; reason?: string },
): Array<Record<string, unknown>> {
  const toolCallPart = (approval: ManagedHarnessPendingApproval) => ({
    type: 'tool-call',
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    input: typeof approval.input === 'string' ? safeParseJson(approval.input) : approval.input,
  })
  return [
    {
      role: 'assistant',
      content: pending.flatMap((approval) => [
        toolCallPart(approval),
        {
          type: 'tool-approval-request',
          approvalId: approval.approvalId,
          toolCallId: approval.toolCallId,
        },
      ]),
    },
    {
      role: 'tool',
      content: pending.map((approval) => ({
        type: 'tool-approval-response',
        approvalId: approval.approvalId,
        approved: decision.approved,
        ...(decision.reason ? { reason: decision.reason } : {}),
        ...(approval.providerExecuted === true ? { providerExecuted: true } : {}),
      })),
    },
  ]
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
