import { redactSecrets } from '../security/sentry-sanitize'

export const NATIVE_AGENT_ERROR_PART = 'data-native-agent-error'

export type NativeAgentError = {
  runId: string
  code: string
  message: string
  retryable: boolean
  failedAt: number
}

export function nativeAgentErrorMessage(message: string): string {
  return redactSecrets(message
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'))
    .trim().slice(0, 2_000) || 'The task failed without a recorded explanation.'
}

export function readNativeAgentError(parts: unknown): NativeAgentError | undefined {
  if (!Array.isArray(parts)) return undefined
  const part = parts.find(value => value?.type === NATIVE_AGENT_ERROR_PART)
  const data: unknown = part?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const { runId, code, message, retryable, failedAt } = data as Record<string, unknown>
  if (typeof runId !== 'string' || !runId || typeof code !== 'string' || !code
    || typeof message !== 'string' || !message.trim() || message.length > 2_000
    || typeof retryable !== 'boolean' || typeof failedAt !== 'number' || !Number.isFinite(failedAt)) return undefined
  return { runId, code, message, retryable, failedAt }
}
