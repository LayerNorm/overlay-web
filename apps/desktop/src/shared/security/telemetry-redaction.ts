const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|passwd|api[_-]?key|session|credential|private[_-]?key|refresh|access[_-]?token|email|user[_-]?id|first[_-]?name|last[_-]?name)/i
const ABSOLUTE_MAC_PATH = /\/Users\/[^/\s]+\/[^\s"'<>]*/g
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi
const SECRET_ASSIGNMENT =
  /\b(?:sk|pk|api|token|secret|password|session|key)[_-]?[A-Za-z0-9]*\s*[=:]\s*[A-Za-z0-9._~+/-]{8,}/gi
const URL_QUERY = /([?&])([^#\s]+)/g

const MAX_DEPTH = 6
const MAX_STRING_LENGTH = 2_000
const MAX_ARRAY_LENGTH = 50
const REDACTED = '[Redacted]'

function redactString(value: string): string {
  return value
    .slice(0, MAX_STRING_LENGTH)
    .replace(BEARER, REDACTED)
    .replace(SECRET_ASSIGNMENT, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(ABSOLUTE_MAC_PATH, '/Users/[Redacted]')
    .replace(URL_QUERY, '$1[Redacted]')
}

export function redactTelemetryValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED
  if (depth >= MAX_DEPTH) return '[Truncated]'
  if (typeof value === 'string') return redactString(value)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactTelemetryValue(item, '', depth + 1))
  }
  if (typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitized[entryKey] = redactTelemetryValue(entryValue, entryKey, depth + 1)
    }
    return sanitized
  }
  return String(value)
}

export function redactSentryEvent<T>(event: T): T {
  const sanitized = redactTelemetryValue(event) as T
  if (sanitized && typeof sanitized === 'object') {
    const record = sanitized as Record<string, unknown>
    delete record.user
    if (record.request && typeof record.request === 'object') {
      const request = record.request as Record<string, unknown>
      delete request.cookies
      delete request.data
      delete request.headers
      delete request.query_string
    }
  }
  return sanitized
}
