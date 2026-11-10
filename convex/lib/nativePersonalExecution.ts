import type { Doc } from '../_generated/dataModel'

export function publicPersonalRun(run: Doc<'conversationAgentRuns'>) {
  return {
    id: run._id,
    conversationId: run.conversationId,
    userId: run.userId,
    turnId: run.turnId,
    userMessageId: run.userMessageId,
    assistantMessageId: run.assistantMessageId,
    mode: run.mode,
    runner: run.runner,
    executionEngine: run.executionEngine,
    variantIndex: run.variantIndex,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failedAt: run.failedAt,
    cancelledAt: run.cancelledAt,
    approval: run.approval,
    inputRequest: run.inputRequest,
    plan: run.plan,
    authorizationPause: run.authorizationPause,
    terminalError: run.terminalError ? {
      code: run.terminalError.code,
      message: run.terminalError.message,
      retryable: run.terminalError.retryable,
    } : undefined,
    metrics: run.metrics ? {
      browserDisconnectedAt: run.metrics.browserDisconnectedAt,
      browserReconnectedAt: run.metrics.browserReconnectedAt,
    } : undefined,
  }
}
