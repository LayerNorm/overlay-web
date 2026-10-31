export type PersonalHarnessAuthentication =
  | { type: 'session' | 'access-token' }
  | { type: 'api-key'; apiKeyId: string }
  | { type: 'automation'; automationId: string; automationRunId?: string; originWorkflowRunId: string }

export function serializePersonalHarnessAuthentication(
  authentication: PersonalHarnessAuthentication,
): PersonalHarnessAuthentication {
  switch (authentication.type) {
    case 'api-key':
      return { type: 'api-key', apiKeyId: authentication.apiKeyId }
    case 'automation':
      return {
        type: 'automation',
        automationId: authentication.automationId,
        ...(authentication.automationRunId ? { automationRunId: authentication.automationRunId } : {}),
        originWorkflowRunId: authentication.originWorkflowRunId,
      }
    default:
      return { type: authentication.type }
  }
}

export function hasSamePersonalHarnessAuthentication(
  expected: PersonalHarnessAuthentication,
  actual: PersonalHarnessAuthentication,
): boolean {
  if (expected.type !== actual.type) return false
  switch (expected.type) {
    case 'api-key':
      return actual.type === 'api-key' && expected.apiKeyId === actual.apiKeyId
    case 'automation':
      return actual.type === 'automation'
        && expected.automationId === actual.automationId
        && expected.automationRunId === actual.automationRunId
        && expected.originWorkflowRunId === actual.originWorkflowRunId
    default:
      return expected.type === actual.type
  }
}
