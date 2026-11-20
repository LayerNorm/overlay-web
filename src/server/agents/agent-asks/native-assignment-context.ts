export type NativeAgentAssignmentContext = {
  parentConversationId: string
  parentRunId: string
  rootRunId: string
  toolCallId: string
  idempotencyKey: string
}

export function nativeAgentAssignmentContext(input: {
  parentConversationId: string
  parentRunId: string
  rootRunId: string
  toolCallId: string
}): NativeAgentAssignmentContext {
  return {
    ...input,
    idempotencyKey: `harness-run:${input.parentRunId}:tool:${input.toolCallId}`,
  }
}
