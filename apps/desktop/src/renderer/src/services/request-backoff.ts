/**
 * Server-respecting retry delays.
 *
 * The API answers 429s with `{ error: 'Too many requests', retryAfterSeconds }`
 * (or the vendored client's friendly "Try again in …" text). Fixed short
 * retries against that turn one throttled burst into a sustained storm, so
 * every context-level retry goes through {@link retryAfterMsFromError}.
 */

const MAX_RETRY_AFTER_MS = 120_000

function secondsFromFriendlyText(message: string): number | null {
  const match = /Try again in (?:(\d+) minutes?(?: (\d+) seconds?)?|(\d+) seconds?)\./.exec(message)
  if (!match) return null
  if (match[3] !== undefined) return Number(match[3])
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)
}

function secondsFromJsonText(message: string): number | null {
  const trimmed = message.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>
    return typeof value.retryAfterSeconds === 'number' && value.retryAfterSeconds >= 0
      ? Math.ceil(value.retryAfterSeconds)
      : null
  } catch {
    return null
  }
}

export function retryAfterSecondsFromError(error: unknown): number | null {
  const direct = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds
  if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) {
    return Math.ceil(direct)
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  return secondsFromJsonText(message) ?? secondsFromFriendlyText(message)
}

/** Delay before retrying, honoring the server's hint and capped at 2 minutes. */
export function retryAfterMsFromError(error: unknown, fallbackMs: number): number {
  const seconds = retryAfterSecondsFromError(error)
  if (seconds === null) return fallbackMs
  return Math.min(Math.max(0, seconds) * 1000, MAX_RETRY_AFTER_MS)
}

const TRANSIENT_MESSAGE_PATTERN =
  /too many requests|try again in|rate.?limit|network|fetch|offline|timeout|timed out|temporar|transient|overloaded|ipc_concurrency_limit|concurrency|econn|socket hang up|\b(429|500|502|503|504)\b/i
const PERMANENT_MESSAGE_PATTERN =
  /\b(400|401|403|404)\b|not found|forbidden|unauthori[sz]ed|bad request|validation|invalid|feature_disabled|not supported|unsupported/i

/**
 * Whether an automatic retry could ever succeed. 4xx (except 429) answers —
 * unknown routes, gated features, revoked access — are persistent: retrying
 * them on a timer self-DDoSes the shared rate-limit bucket. Callers still
 * surface the error with a manual Retry button.
 */
export function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') {
    return status === 0 || status === 429 || status >= 500
  }
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (PERMANENT_MESSAGE_PATTERN.test(message) && !TRANSIENT_MESSAGE_PATTERN.test(message)) {
    return false
  }
  return true
}

function formatRetryDelay(totalSeconds: number): string {
  if (totalSeconds < 60) {
    const seconds = Math.max(1, totalSeconds)
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const minuteLabel = `${minutes} minute${minutes === 1 ? '' : 's'}`
  if (seconds === 0) return minuteLabel
  return `${minuteLabel} ${seconds} second${seconds === 1 ? '' : 's'}`
}

/**
 * Human-readable error text. Raw JSON bodies (`{"error":"…"}`) are unwrapped,
 * and 429s gain a "try again in …" suffix from the server's hint.
 */
export function friendlyErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>
      const detail =
        typeof value.error === 'string' && value.error.trim()
          ? value.error.trim()
          : typeof value.message === 'string' && value.message.trim()
            ? value.message.trim()
            : null
      if (detail) {
        const seconds =
          typeof value.retryAfterSeconds === 'number' && value.retryAfterSeconds >= 0
            ? Math.ceil(value.retryAfterSeconds)
            : null
        return seconds === null
          ? detail
          : `${detail}. Try again in ${formatRetryDelay(seconds)}.`
      }
    } catch {
      // Fall through to the raw message.
    }
  }
  return raw || 'Something went wrong.'
}
