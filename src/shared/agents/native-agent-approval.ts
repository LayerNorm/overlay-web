import type { AgentRunApprovalRequest } from './agent-run'

export const NATIVE_AGENT_APPROVAL_PART = 'data-native-agent-approval'

export type NativeAgentApproval = {
  runId: string
  conversationId: string
  userId: string
  token: string
  requestedAt: number
  requests: AgentRunApprovalRequest[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isApprovalRequest(value: unknown): value is AgentRunApprovalRequest {
  return isRecord(value)
    && typeof value.approvalId === 'string' && value.approvalId.length > 0
    && typeof value.toolCallId === 'string' && value.toolCallId.length > 0
    && typeof value.toolName === 'string' && value.toolName.length > 0
    && Object.hasOwn(value, 'input')
}

export function readNativeAgentApproval(value: unknown): NativeAgentApproval | undefined {
  if (!isRecord(value)) return undefined
  const { runId, conversationId, userId, token, requestedAt, requests } = value
  if (typeof runId !== 'string' || !runId
    || typeof conversationId !== 'string' || !conversationId
    || typeof userId !== 'string' || !userId
    || typeof token !== 'string' || !token
    || typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)
    || !Array.isArray(requests) || requests.length === 0
    || !requests.every(isApprovalRequest)) return undefined
  return { runId, conversationId, userId, token, requestedAt, requests }
}
