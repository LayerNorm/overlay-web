import { redactSecrets } from '../../shared/security/sentry-sanitize'
import { describeAISDKFailure, PROVIDER_CONTENT_FILTER_REASON, readErrorField as field } from './ai-sdk-failure'

function safeText(value: string): string {
  return redactSecrets(value
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[REDACTED URL]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|authorization|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]'))
    .replace(/[\r\n\t]+/g, ' ').trim()
}

// Workflow and provider failures can cross realms or arrive as serialized values.
// Never serialize the entire object: request bodies and headers can carry secrets.
function failureDescription(error: unknown): { reason: string; sdk: boolean } {
  const seen = new Set<object>()
  const reasons: string[] = []
  const sdkReasons: string[] = []
  let current = error
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (typeof current === 'string') {
      const message = safeText(current)
      if (message) reasons.push(message)
      break
    }
    if (typeof current !== 'object' || seen.has(current)) break
    seen.add(current)
    const name = field(current, 'name')
    if (name === 'HarnessModelFailure') {
      const message = field(current, 'message')
      return { reason: typeof message === 'string' && message.trim()
        ? safeText(message).slice(0, 2_000) : 'The model request failed without error details.', sdk: true }
    }
    const sdkReason = describeAISDKFailure(current)
    if (sdkReason === PROVIDER_CONTENT_FILTER_REASON) return { reason: sdkReason, sdk: true }
    if (sdkReason) {
      if (!sdkReasons.includes(sdkReason)) sdkReasons.push(sdkReason)
    } else {
      const message = field(current, 'message')
      const code = field(current, 'code')
      const label = [name, code]
        .filter((value): value is string => typeof value === 'string'
          && value !== 'Error' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value))
        .map(safeText).join(' / ')
      const detail = typeof message === 'string' ? safeText(message) : ''
      const reason = [label, detail].filter(Boolean).join(': ')
      if (reason && !reasons.includes(reason)) reasons.push(reason)
    }
    current = name === 'AI_RetryError' ? field(current, 'lastError') ?? field(current, 'cause')
      : field(current, 'cause') ?? (name === 'AI_ToolCallRepairError' ? field(current, 'originalError') : undefined)
  }
  // A wrapper's message or a validation cause may repeat the SDK's private payload.
  return { reason: ((sdkReasons.length ? sdkReasons : reasons).join(' Caused by: ')
    || 'Harness execution failed without error details.').slice(0, 2_000), sdk: sdkReasons.length > 0 }
}

export function harnessExecutionFailureReason(error: unknown): string {
  return failureDescription(error).reason
}

// Step-error serialization retains name/message but drops SDK-specific metadata.
// Call only after provider rejection accounting, in the no-retry model boundary.
export function preserveHarnessSDKFailure(error: unknown): unknown {
  const failure = failureDescription(error)
  if (!failure.sdk) return error
  const preserved = new Error(failure.reason)
  preserved.name = 'HarnessModelFailure'
  return preserved
}
