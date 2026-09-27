import {
  DEFAULT_AUTH_REDIRECT,
  DESKTOP_AUTH_REDIRECT_URI,
  SESSION_TRANSFER_DEEP_LINK_PREFIX,
} from '@/shared/auth/auth-constants'
import { publicEnv } from '@/shared/env/public-env'

function isAllowedOverlayRedirect(value: string): boolean {
  return (
    value === DESKTOP_AUTH_REDIRECT_URI ||
    value.startsWith(`${SESSION_TRANSFER_DEEP_LINK_PREFIX}?`)
  )
}

export function sanitizeClientAuthRedirect(value?: string | null): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_AUTH_REDIRECT

  if (isAllowedOverlayRedirect(trimmed)) {
    return trimmed
  }

  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? DEFAULT_AUTH_REDIRECT : trimmed
  }

  // Resolve against the configured app origin (inlined at build time) so the
  // result is identical on the server and during hydration.
  let appOrigin: string
  try {
    appOrigin = new URL(publicEnv.appUrl).origin
  } catch {
    return DEFAULT_AUTH_REDIRECT
  }

  try {
    const candidate = new URL(trimmed, appOrigin)
    if (candidate.origin !== appOrigin) {
      return DEFAULT_AUTH_REDIRECT
    }
    return `${candidate.pathname}${candidate.search}${candidate.hash}` || DEFAULT_AUTH_REDIRECT
  } catch {
    return DEFAULT_AUTH_REDIRECT
  }
}
