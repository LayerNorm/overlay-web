export const NATIVE_AGENT_INPUT_PART = 'data-native-agent-input'

export type NativeAgentInput = {
  runId: string
  conversationId: string
  userId: string
  token: string
  requestedAt: number
  question: string
}

export function readNativeAgentInput(value: unknown): NativeAgentInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const { runId, conversationId, userId, token, requestedAt, question } = value as Record<string, unknown>
  if (typeof runId !== 'string' || !runId || typeof conversationId !== 'string' || !conversationId
    || typeof userId !== 'string' || !userId || typeof token !== 'string' || !token
    || typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)
    || typeof question !== 'string' || !question.trim()) return undefined
  return { runId, conversationId, userId, token, requestedAt, question }
}
