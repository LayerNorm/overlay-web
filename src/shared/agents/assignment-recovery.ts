type NativeRecoveryIdentity = {
  actorUserId: string
  workspaceId: string
  conversationId: string
  deliveryRunId: string
  memoryEnabled?: boolean
}

export type AssignmentCancellationRoot = { actorUserId: string; agentRunId: string; rootRunId: string }

export type NativeRecoveryWork =
  | (NativeRecoveryIdentity & { kind: 'turn' })
  | (NativeRecoveryIdentity & { kind: 'publication'; runId: string; workflowRunId: string; executionGeneration: number })
  | (NativeRecoveryIdentity & { kind: 'assignment'; parentRunId: string; rootRunId: string;
      workflowRunId: string; executionGeneration: number; toolCallId: string; agentId: string;
      brief: string; assignmentId?: string; expectedAttemptId?: string })
  | { kind: 'cancel'; workflows: string[]; cancellationRoot?: AssignmentCancellationRoot }

export type NativeRecoveryRequest = { kind: 'assignment' | 'turn'; id: string; generation: number }
