import { createHook, FatalError, getWorkflowMetadata, sleep } from 'workflow'
import {
  attachWorkspaceAgentRun,
  callWorkspaceAgentModel,
  completeWorkspaceAgentRun,
  denyExpiredWorkspaceAgentApproval,
  executeWorkspaceAgentTool,
  failWorkspaceAgentRun,
  finalizeWorkspaceAgentTurn,
  inspectWorkspaceAgentTool,
  persistWorkspaceAgentToolProgress,
  prepareWorkspaceAgentTurn,
  releaseWorkspaceAgentReservation,
  resumeWorkspaceAgentAfterApproval,
  waitForWorkspaceAgentApproval,
} from '@/server/agents/workspace-agent-turn-lifecycle'

/**
 * Reason code and retryability for a failed turn.
 *
 * Deliberately kept inside the workflow module and free of imports. Anything a
 * workflow body pulls in that is not a `"use step"` function is bundled for the
 * workflow runtime, where Node built-ins do not exist — importing this from the
 * server would drag `node:crypto` in behind it and fail the build. The error is
 * matched by name rather than by class for the same reason.
 */
function describeWorkspaceAgentFailure(error: unknown): {
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
    // An entitlement or usage refusal will refuse again; retrying it only burns
    // the run. Everything else is worth another attempt.
    retryable: reasonCode !== 'not_entitled'
      && reasonCode !== 'usage_limited'
      && reasonCode !== 'room_access_denied'
      && reasonCode !== 'not_a_collaboration_room',
  }
}

export type WorkspaceAgentTurnInput = {
  actorUserId: string
  agentId: string
  conversationId: string
  /** The human message being replied to. */
  messageId: string
  memoryEnabled?: boolean
  runId: string
  threadRootMessageId?: string
  /** The `generating` reply row opened with the run record. */
  turnMessageId: string
  workspaceId: string
}

/**
 * One room agent's reply, as a durable run.
 *
 * The point of the workflow is ownership: the turn belongs to the run record
 * rather than to an HTTP request, so closing the tab, navigating away, or
 * losing the serverless instance cannot end it. The reply is already a row in
 * the transcript before this starts, so wherever the reader goes, they come
 * back to it.
 *
 * Model calls and tool calls are separate durable steps. In particular, an
 * approval suspension never replays a completed provider request or tool.
 */
export async function workspaceAgentTurnWorkflow(input: WorkspaceAgentTurnInput) {
  'use workflow'

  const { workflowRunId } = getWorkflowMetadata()
  await attachWorkspaceAgentRun({
    actorUserId: input.actorUserId,
    runId: input.runId,
    workflowRunId,
  })

  let prepared: Awaited<ReturnType<typeof prepareWorkspaceAgentTurn>> | undefined
  try {
    prepared = await prepareWorkspaceAgentTurn({ ...input, memoryEnabled: input.memoryEnabled !== false })
    let messages = prepared.messages
    let content = ''
    let transcriptParts: Array<Record<string, unknown>> = []
    let inTokens = 0
    let outTokens = 0
    const steps: Array<Record<string, unknown>> = []
    let approvalCycles = 0
    for (let modelStep = 0; modelStep < prepared.maxSteps; modelStep += 1) {
      const call = await callWorkspaceAgentModel({ prepared, messages, baseParts: transcriptParts })
      transcriptParts = call.transcriptParts
      content += call.text
      inTokens += call.usage.inputTokens ?? 0
      outTokens += call.usage.outputTokens ?? 0
      const toolResults: Array<Record<string, unknown>> = []
      const toolMessageContent: Array<Record<string, unknown>> = []
      steps.push({ content: call.parts, text: call.text, toolCalls: call.toolCalls, toolResults, response: { messages: call.responseMessages }, usage: call.usage, finishReason: call.finishReason })
      if (!call.toolCalls.length) {
        const result = await finalizeWorkspaceAgentTurn({ prepared, steps, content, inputTokens: inTokens, outputTokens: outTokens })
        await completeWorkspaceAgentRun({ actorUserId: input.actorUserId, result, runId: input.runId })
        return { completed: true, runId: input.runId }
      }
      for (const toolCall of call.toolCalls) {
        const inspection = await inspectWorkspaceAgentTool({ prepared, toolCall })
        if (!inspection.available) {
          const output = { error: 'This action is no longer authorized.' }
          toolResults.push({ type: 'tool-error', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input, output })
          toolMessageContent.push({ type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output })
          transcriptParts.push({ type: 'tool-invocation', toolInvocation: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, state: 'output-error', toolInput: toolCall.input, toolOutput: output } })
          await persistWorkspaceAgentToolProgress({ prepared, parts: transcriptParts })
          continue
        }
        let approved = false
        if (inspection.needsApproval) {
          approvalCycles += 1
          if (approvalCycles > prepared.maxSteps) throw new FatalError('Agent turn exceeded its approval cycle limit.')
          const token = `native-agent-approval:${input.runId}:${approvalCycles}`
          const hook = createHook<{ approved: boolean; reason?: string }>({ token })
          let decision: { approved: boolean; reason?: string } | undefined
          try {
            if (await hook.getConflict()) throw new FatalError('Approval token is already in use.')
            await waitForWorkspaceAgentApproval({ actorUserId: input.actorUserId, runId: input.runId, token, requests: [{ approvalId: `${input.runId}:${toolCall.toolCallId}`, toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input }] })
            const outcome = await Promise.race([hook.then(value => ({ value })), sleep('15m').then(() => ({ timedOut: true as const }))])
            decision = 'timedOut' in outcome ? (await denyExpiredWorkspaceAgentApproval({ token }), await hook) : outcome.value
          } finally {
            hook.dispose()
          }
          if (!decision || typeof decision.approved !== 'boolean') throw new FatalError('Approval response was malformed.')
          approved = decision.approved
          await resumeWorkspaceAgentAfterApproval({ actorUserId: input.actorUserId, runId: input.runId })
          if (!approved) {
            const output = { error: 'reason' in decision ? decision.reason ?? 'The action was not approved.' : 'Approval timed out.' }
            toolResults.push({ type: 'tool-error', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input, output })
            toolMessageContent.push({ type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output })
            transcriptParts.push({ type: 'tool-invocation', toolInvocation: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, state: 'output-error', toolInput: toolCall.input, toolOutput: output } })
            await persistWorkspaceAgentToolProgress({ prepared, parts: transcriptParts })
            continue
          }
        }
        const result = await executeWorkspaceAgentTool({ prepared, toolCall, approved })
        toolResults.push({ type: result.error || result.refusedApproval ? 'tool-error' : 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input, output: result.display })
        toolMessageContent.push({ type: 'tool-result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, output: result.output })
        transcriptParts.push({ type: 'tool-invocation', toolInvocation: { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, state: result.error || result.refusedApproval ? 'output-error' : 'output-available', toolInput: toolCall.input, toolOutput: result.display } })
        await persistWorkspaceAgentToolProgress({ prepared, parts: transcriptParts })
      }
      messages = [...messages, ...call.responseMessages, { role: 'tool', content: toolMessageContent as never }]
    }
    throw new FatalError('Agent turn exceeded its model step limit.')
  } catch (error) {
    if (prepared) await releaseWorkspaceAgentReservation({ actorUserId: input.actorUserId, prepared }).catch((_error) => undefined)
    const failure = describeWorkspaceAgentFailure(error)
    await failWorkspaceAgentRun({
      actorUserId: input.actorUserId,
      conversationId: input.conversationId,
      errorMessage: failure.errorMessage,
      reasonCode: failure.reasonCode,
      retryable: failure.retryable,
      runId: input.runId,
      turnMessageId: input.turnMessageId,
      workspaceId: input.workspaceId,
    })
    throw error
  }
}
