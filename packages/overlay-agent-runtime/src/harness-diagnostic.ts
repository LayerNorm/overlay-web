export type HarnessDiagnosticCode =
  | 'TASK_DEADLINE' | 'TASK_SPEND_LIMIT' | 'WORKSPACE_FUNDS'
  | 'PROVIDER_REJECTED' | 'PROVIDER_REQUEST_INVALID' | 'PROVIDER_ACCOUNT' | 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_UNAVAILABLE'
  | 'TOOL_FAILED' | 'TOOL_OUTCOME_UNKNOWN' | 'MODEL_OUTCOME_UNKNOWN'
  | 'AUTHORIZATION_REVOKED' | 'PERSISTENCE_FAILED' | 'STAGNATION' | 'UNKNOWN'

export type HarnessDiagnostic = {
  diagnosticId: string
  code: HarnessDiagnosticCode
  stage: 'admission' | 'model' | 'tool' | 'persistence' | 'delivery'
  operationId?: string
  retryability: 'automatic' | 'user_action' | 'reconcile' | 'none'
  safeMessage: string
  nextAction: string
  occurredAt: number
}

export function stableHarnessDiagnosticId(runId: string, operationId: string, revision: number): string {
  const value = `${runId}\0${operationId}\0${revision}`
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }
  return `hd_${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
}

const descriptions: Record<HarnessDiagnosticCode, Pick<HarnessDiagnostic, 'safeMessage' | 'nextAction' | 'retryability'>> = {
  TASK_DEADLINE: { safeMessage: 'This task reached its explicit time limit.', nextAction: 'Review the saved work and start a new task with a longer limit.', retryability: 'user_action' },
  TASK_SPEND_LIMIT: { safeMessage: 'This task reached its explicit model-spend limit, not its workspace credit limit.', nextAction: 'Review the saved work and increase the task spending limit before continuing.', retryability: 'user_action' },
  WORKSPACE_FUNDS: { safeMessage: 'The workspace has less than 2% of its budget left, so this task stopped.', nextAction: 'Add usage to the workspace, then ask the agent to continue.', retryability: 'user_action' },
  PROVIDER_TIMEOUT: { safeMessage: 'The model provider did not respond in time.', nextAction: 'Review the saved work before retrying the request.', retryability: 'user_action' },
  PROVIDER_RATE_LIMIT: { safeMessage: 'The model provider temporarily limited requests.', nextAction: 'Wait before retrying, or select another available model.', retryability: 'user_action' },
  PROVIDER_REJECTED: { safeMessage: 'The model provider blocked this response with its content filter. Any partial response is incomplete.', nextAction: 'Review the request before trying again.', retryability: 'user_action' },
  PROVIDER_UNAVAILABLE: { safeMessage: 'The model provider could not complete the request.', nextAction: 'Review the saved work and retry when the provider is available.', retryability: 'user_action' },
  PROVIDER_REQUEST_INVALID: { safeMessage: 'The model provider refused this request because it could not accept part of it.', nextAction: 'Choose a model that supports this content, or remove the unsupported attachment, before retrying.', retryability: 'user_action' },
  PROVIDER_ACCOUNT: { safeMessage: 'The model provider rejected the connected account or key, its access, or its billing.', nextAction: 'Reconnect the account or check the provider key, access and billing in Settings, then retry.', retryability: 'user_action' },
  TOOL_FAILED: { safeMessage: 'A tool could not complete its operation.', nextAction: 'Review the failed tool and saved work before continuing.', retryability: 'user_action' },
  TOOL_OUTCOME_UNKNOWN: { safeMessage: 'A tool operation ended without a confirmed outcome.', nextAction: 'Check whether the action took effect before retrying it.', retryability: 'reconcile' },
  MODEL_OUTCOME_UNKNOWN: { safeMessage: 'A model request ended without confirmed usage.', nextAction: 'Reconcile the outstanding request before retrying it.', retryability: 'reconcile' },
  AUTHORIZATION_REVOKED: { safeMessage: 'This task no longer has the authorization it needs.', nextAction: 'Check workspace membership and tool access before starting another task.', retryability: 'user_action' },
  PERSISTENCE_FAILED: { safeMessage: 'The task could not save or publish its latest progress.', nextAction: 'Reload to inspect saved work. Do not repeat completed actions to recover missing text.', retryability: 'reconcile' },
  STAGNATION: { safeMessage: 'The task paused because repeated attempts made no verifiable progress.', nextAction: 'Review the blocker and provide guidance to continue.', retryability: 'user_action' },
  UNKNOWN: { safeMessage: 'The task stopped for an unclassified reason.', nextAction: 'Use the diagnostic ID to investigate before retrying actions.', retryability: 'reconcile' },
}

export function createHarnessDiagnostic(input: Pick<HarnessDiagnostic,
  'diagnosticId' | 'code' | 'stage' | 'operationId' | 'occurredAt'>): HarnessDiagnostic {
  return { ...input, ...descriptions[input.code] }
}

export function harnessDiagnosticMessage(diagnostic: HarnessDiagnostic): string {
  return `${diagnostic.safeMessage} ${diagnostic.nextAction} Diagnostic ID: ${diagnostic.diagnosticId}`
}
