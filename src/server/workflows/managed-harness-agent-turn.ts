import { createHook, getWorkflowMetadata } from 'workflow'
import type { ConnectedAgentSandboxBilling } from '@/server/agents/ConnectedAgentRepository'
import type { ManagedHarnessId } from '@overlay/workspace-contracts'
import {
  abandonWorkspaceAgentRun,
  attachWorkspaceAgentRun,
  completeWorkspaceAgentRun,
} from '@/server/agents/workspace-agent-turn-lifecycle'
import {
  acquireManagedHarnessTurn,
  failManagedHarnessTurn,
  finalizeManagedHarnessTurn,
  harnessApprovalContinuationMessages,
  markManagedHarnessApprovalResolved,
  markManagedHarnessApprovalWaiting,
  pendingHarnessApprovals,
  runManagedHarnessTurnSlice,
  type ManagedHarnessWorkflowState,
} from '@/server/agents/managed-harness-steps'

/**
 * Reason code and retryability for a failed harness turn. Kept inside the
 * workflow module and free of server imports — a workflow body is bundled for
 * the workflow runtime, where Node built-ins do not exist. The error is
 * matched by name for the same reason.
 */
function describeManagedHarnessFailure(error: unknown): {
  errorMessage: string
  reasonCode: string
  retryable: boolean
} {
  const reasonCode = error instanceof Error && error.name === 'WorkspaceAgentInvocationError'
    ? String((error as { reasonCode?: unknown }).reasonCode ?? 'model_failed')
    : 'model_failed'
  return {
    errorMessage: error instanceof Error ? error.message : 'The agent turn failed.',
    reasonCode,
    retryable: reasonCode !== 'not_entitled'
      && reasonCode !== 'usage_limited'
      && reasonCode !== 'room_access_denied'
      && reasonCode !== 'not_a_collaboration_room',
  }
}

/**
 * Bound on approve/deny round-trips in one turn — mirrors
 * `MAX_WORK_APPROVAL_CYCLES` in the hosted work loop so a harness that
 * suspends on every call cannot park the run forever.
 */
const MAX_MANAGED_HARNESS_APPROVAL_CYCLES = 20

export type ManagedHarnessTurnInput = {
  actorUserId: string
  agentId: string
  agentPrincipalId: string
  bindingId: string
  conversationId: string
  environmentId: string
  /** Validated with `isManagedHarnessId` at dispatch, before the run opens. */
  harnessId: ManagedHarnessId
  /** Harness-native model alias resolved from the binding's catalog value. */
  harnessModel?: string
  /** Provider connection funding `modelBilling:'byok'` bindings. */
  byokConnectionId?: string
  /** Owner of that connection — connections are per-user. */
  byokConnectionUserId?: string
  /** Agent's standing instructions, applied to the HarnessAgent. */
  instructions?: string
  invocationNonce: string
  /** Slice ceiling — dispatch derives it from the connected-agent run-time cap. */
  maxTurnSlices: number
  memoryEnabled?: boolean
  modelId: string
  /** Full room-context prompt envelope for the turn. */
  prompt: string
  reservationId: string | null
  runId: string
  sandboxBilling?: ConnectedAgentSandboxBilling | null
  threadRootMessageId?: string
  turnId: string
  /** The `generating` reply row opened with the run record. */
  turnMessageId: string
  workingDirectory: string
  workspaceId: string
}

/**
 * One managed HarnessAgent reply, as a durable run.
 *
 * Same ownership story as `workspaceAgentTurnWorkflow` — the turn belongs to
 * the run record, not the request — but the model loop is delegated to a
 * harness running inside the managed sandbox. Each step executes one time
 * slice of `@ai-sdk/workflow-harness`: when the slice budget elapses the
 * runner suspends the turn at a cursor (`continueFrom`) and the next step
 * resumes it, so a turn can outlive any single step and the workflow run
 * survives redeploys between slices. The reply row streams live via the
 * transcript writable; `agentHarnessSessions.resumeState` carries the native
 * session into the next user turn.
 */
export async function managedHarnessAgentTurnWorkflow(input: ManagedHarnessTurnInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachWorkspaceAgentRun({
    actorUserId: input.actorUserId,
    runId: input.runId,
    workflowRunId,
  })

  const identity = {
    actorUserId: input.actorUserId,
    agentId: input.agentId,
    agentPrincipalId: input.agentPrincipalId,
    bindingId: input.bindingId,
    conversationId: input.conversationId,
    environmentId: input.environmentId,
    harnessId: input.harnessId,
    harnessModel: input.harnessModel,
    byokConnectionId: input.byokConnectionId,
    byokConnectionUserId: input.byokConnectionUserId,
    instructions: input.instructions,
    invocationNonce: input.invocationNonce,
    modelId: input.modelId,
    prompt: input.prompt,
    runId: input.runId,
    threadRootMessageId: input.threadRootMessageId,
    turnId: input.turnId,
    turnMessageId: input.turnMessageId,
    workingDirectory: input.workingDirectory,
    workspaceId: input.workspaceId,
  }

  // Session coordinates for the failure path — refreshed as slices land so
  // teardown can reattach and destroy whatever is live.
  let sessionId: string | undefined
  let resumeFrom: Record<string, unknown> | undefined
  let continueFrom: Record<string, unknown> | undefined

  try {
    const acquired = await acquireManagedHarnessTurn({
      bindingId: input.bindingId,
      conversationId: input.conversationId,
      environmentId: input.environmentId,
      harnessId: input.harnessId,
      workspaceId: input.workspaceId,
    })
    sessionId = acquired.sessionId
    resumeFrom = acquired.resumeFrom

    let slice = await runManagedHarnessTurnSlice({
      ...identity,
      sessionId,
      resumeFrom,
      state: null,
      transcript: { content: '', parts: [] },
    })
    let slices = 1
    let approvalCycles = 0
    let state: ManagedHarnessWorkflowState = slice.state

    // One loop over the slice state machine: `ready_for_next_step` keeps
    // time-slicing within the run budget; `awaiting_tool_approval` parks the
    // run on `waiting_for_approval` (the room's approve/deny card renders
    // from the run row) and blocks on a `createHook` token the shared
    // approval route resolves via `resumeHook`. Decisions re-enter the
    // suspended turn as synthesized `tool-approval-response` continuation
    // messages — the session owns the real transcript.
    while (state.status === 'ready_for_next_step' || state.status === 'awaiting_tool_approval') {
      if (state.status === 'awaiting_tool_approval') {
        const pending = pendingHarnessApprovals(state.continueFrom)
        if (pending.length === 0) {
          throw new Error('The managed agent turn suspended without an approval request.')
        }
        if (approvalCycles >= MAX_MANAGED_HARNESS_APPROVAL_CYCLES) {
          throw new Error('The managed agent turn exceeded the maximum number of approval cycles.')
        }
        const token = `agent-run:${input.runId}:approval:${approvalCycles}`
        approvalCycles += 1
        await markManagedHarnessApprovalWaiting({
          actorUserId: input.actorUserId,
          approval: {
            token,
            requestedAt: Date.now(),
            title: 'The agent needs your approval',
            requests: pending.map((request) => ({
              approvalId: request.approvalId,
              toolCallId: request.toolCallId,
              toolName: request.toolName,
              input: request.input,
            })),
          },
          runId: input.runId,
        })
        const decision = await createHook<{ approved: boolean; reason?: string }>({ token })
        await markManagedHarnessApprovalResolved({
          actorUserId: input.actorUserId,
          runId: input.runId,
        })
        state = { ...state, messages: harnessApprovalContinuationMessages(pending, decision) }
      } else {
        if (slices >= input.maxTurnSlices) break
        resumeFrom = state.resumeFrom
        continueFrom = state.continueFrom
      }
      slice = await runManagedHarnessTurnSlice({
        ...identity,
        sessionId,
        state,
        transcript: slice.transcript,
      })
      slices += 1
      state = slice.state
    }
    // Keep teardown coordinates current regardless of how the loop exited.
    resumeFrom = state.resumeFrom ?? resumeFrom
    continueFrom = state.continueFrom ?? continueFrom

    if (state.status === 'finished') {
      const result = await finalizeManagedHarnessTurn({
        ...identity,
        memoryEnabled: input.memoryEnabled,
        reservationId: input.reservationId,
        sandboxBilling: input.sandboxBilling,
        state,
        transcript: slice.transcript,
      })
      if (!result) {
        await abandonWorkspaceAgentRun({
          actorUserId: input.actorUserId,
          reasonCode: 'empty_response',
          runId: input.runId,
        })
        return { completed: false, runId: input.runId }
      }
      await completeWorkspaceAgentRun({
        actorUserId: input.actorUserId,
        result,
        runId: input.runId,
      })
      return { completed: true, runId: input.runId }
    }

    if (state.status === 'ready_for_next_step' || state.status === 'timed_out') {
      throw new Error('The managed agent turn exceeded its time budget.')
    }
    throw new Error(state.error ?? 'The managed agent turn failed.')
  } catch (error) {
    const failure = describeManagedHarnessFailure(error)
    await failManagedHarnessTurn({
      ...identity,
      errorMessage: failure.errorMessage,
      reasonCode: failure.reasonCode,
      reservationId: input.reservationId,
      retryable: failure.retryable,
      sandboxBilling: input.sandboxBilling,
      ...(sessionId ? { sessionId } : {}),
      ...(resumeFrom ? { resumeFrom } : {}),
      ...(continueFrom ? { continueFrom } : {}),
    })
    throw error
  }
}
