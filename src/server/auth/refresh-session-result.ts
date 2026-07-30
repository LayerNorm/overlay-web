import type { AuthSession } from '@/shared/auth/session-types'

export type RefreshSessionResult =
  | { status: 'success'; session: AuthSession }
  | { status: 'invalid' }
  | { status: 'unavailable' }
  | { status: 'unsupported' }

export function isTerminalRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    error?: unknown
    code?: unknown
    response?: {
      data?: {
        error?: unknown
        code?: unknown
      }
    }
  }
  const providerCode =
    stringValue(candidate.error) ??
    stringValue(candidate.code) ??
    stringValue(candidate.response?.data?.error) ??
    stringValue(candidate.response?.data?.code)

  // WorkOS uses OAuth's invalid_grant when the one-time refresh token is
  // expired, revoked, or already consumed outside its retry grace window.
  // Configuration, transport, rate-limit, and 5xx failures are not terminal.
  return providerCode === 'invalid_grant'
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}
