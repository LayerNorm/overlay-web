import type { SurfaceHarnessAuthentication } from './surface-authority'

export type PersonalHarnessAuthentication =
  | { type: 'session' | 'access-token' }
  | { type: 'api-key'; apiKeyId: string }
  | { type: 'automation'; automationId: string; automationRunId?: string; originWorkflowRunId: string }
  | SurfaceHarnessAuthentication

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
    case 'surface':
      return {
        type: 'surface',
        platform: 'slack',
        bindingId: authentication.bindingId,
        connectionId: authentication.connectionId,
        teamId: authentication.teamId,
        channelId: authentication.channelId,
        threadId: authentication.threadId,
        messageId: authentication.messageId,
        agentId: authentication.agentId,
        agentPrincipalId: authentication.agentPrincipalId,
        creatorPrincipalId: authentication.creatorPrincipalId,
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
    case 'surface':
      return actual.type === 'surface'
        && expected.platform === actual.platform
        && expected.bindingId === actual.bindingId
        && expected.connectionId === actual.connectionId
        && expected.teamId === actual.teamId
        && expected.channelId === actual.channelId
        && expected.threadId === actual.threadId
        && expected.messageId === actual.messageId
        && expected.agentId === actual.agentId
        && expected.agentPrincipalId === actual.agentPrincipalId
        && expected.creatorPrincipalId === actual.creatorPrincipalId
        && expected.originWorkflowRunId === actual.originWorkflowRunId
    default:
      return expected.type === actual.type
  }
}
