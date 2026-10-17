import 'server-only'

/**
 * A log-safe description of a failure. The logger deliberately drops error messages (they can carry user data or
 * secrets), which left production 500s on agent routes logged as a bare, redacted error. This keeps what an
 * operator needs to name the cause without the raw message: the error's type, a coarse class, the SCREAMING_SNAKE
 * codes our own code throws (`AGENT_REMOTE_SESSION_NOT_FOUND`), and for Convex calls the function path and Convex
 * request id. Field names avoid the logger's redacted key fragments (`error`, `name`, `reason`, ...).
 */
export type FailureDescription = {
  failureType: string
  failureClass: FailureClass
  failureCodes?: string[]
  convexPath?: string
  convexCallType?: string
  convexRequestId?: string
  httpStatus?: number
}

export type FailureClass =
  | 'control_plane'
  | 'validation'
  | 'convex_occ'
  | 'convex_limit'
  | 'convex_timeout'
  | 'convex_function'
  | 'convex_unavailable'
  | 'timeout'
  | 'network'
  | 'unknown'

type ConvexCallContext = { path: string; type: string; httpStatus?: number }

// Keyed by the thrown object so callers keep their error types and messages unchanged.
const convexCalls = new WeakMap<object, ConvexCallContext>()

/** Remembers which Convex function a thrown error came from. */
export function recordConvexCallFailure<T>(failure: T, context: ConvexCallContext): T {
  if (typeof failure === 'object' && failure !== null) convexCalls.set(failure, context)
  return failure
}

const CODE_PATTERN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
const IGNORED_CODES = new Set(['HTTP_ERROR', 'UTF_8'])
const CONVEX_REQUEST_ID_PATTERN = /\[Request ID: ([A-Za-z0-9]{6,64})\]/

function messageOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  return ''
}

function typeOf(value: unknown): string {
  if (value instanceof Error) {
    const ctor = value.constructor?.name
    return (ctor && ctor !== 'Object' ? ctor : value.name || 'Error').slice(0, 64)
  }
  if (typeof value === 'string') return 'Message'
  return typeof value
}

function codesFrom(value: unknown, message: string): string[] {
  const codes = new Set<string>()
  const own = (value as { code?: unknown } | null)?.code
  if (typeof own === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(own)) codes.add(own)
  const data = (value as { data?: unknown } | null)?.data
  const dataCode = (data as { code?: unknown } | null)?.code
  if (typeof dataCode === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(dataCode)) codes.add(dataCode)
  if (typeof data === 'string' && /^[A-Z][A-Z0-9_]{3,63}$/.test(data)) codes.add(data)
  for (const match of message.matchAll(CODE_PATTERN)) {
    if (!IGNORED_CODES.has(match[0])) codes.add(match[0])
    if (codes.size >= 5) break
  }
  return [...codes].slice(0, 5)
}

function classify(value: unknown, message: string, convex: ConvexCallContext | undefined): FailureClass {
  const type = typeOf(value)
  if (type === 'ConnectedAgentControlPlaneError') return 'control_plane'
  if (type === 'ZodError') return 'validation'
  const text = message.toLowerCase()
  if (/changed while this (mutation|transaction) was being run|optimisticconcurrency|write conflict/.test(text)) return 'convex_occ'
  if (/too many (reads|writes|documents|bytes|function calls)|exceeded|is too large|limit/.test(text) && convex) return 'convex_limit'
  if (/timed out|timeout|aborted/.test(text)) return convex ? 'convex_timeout' : 'timeout'
  if (/fetch failed|econnreset|econnrefused|enotfound|socket hang up|network/.test(text)) return convex ? 'convex_unavailable' : 'network'
  if (convex && convex.httpStatus !== undefined && convex.httpStatus >= 500) return 'convex_unavailable'
  if (convex) return 'convex_function'
  return 'unknown'
}

export function describeFailure(value: unknown, context: Partial<ConvexCallContext> = {}): FailureDescription {
  const message = messageOf(value)
  const recorded = typeof value === 'object' && value !== null ? convexCalls.get(value) : undefined
  const convex = recorded ?? (context.path ? { path: context.path, type: context.type ?? 'unknown', httpStatus: context.httpStatus } : undefined)
  const codes = codesFrom(value, message)
  const requestId = CONVEX_REQUEST_ID_PATTERN.exec(message)?.[1]
  const status = (value as { statusCode?: unknown } | null)?.statusCode
  return {
    failureType: typeOf(value),
    failureClass: classify(value, message, convex),
    ...(codes.length ? { failureCodes: codes } : {}),
    ...(convex ? { convexPath: convex.path.slice(0, 200), convexCallType: convex.type } : {}),
    ...(requestId ? { convexRequestId: requestId } : {}),
    ...(typeof status === 'number' ? { httpStatus: status } : convex?.httpStatus ? { httpStatus: convex.httpStatus } : {}),
  }
}
