import { overlayDesktopAppClient } from './app-api-client'

const IS_DEV = import.meta.env.IS_DEV === 'true'
const APP_SERVER_URL = (import.meta.env.APP_SERVER_URL || '').trim().replace(/\/$/, '')

export const CUSTOM_AUTH_BASE_URL =
  APP_SERVER_URL || (IS_DEV ? 'http://localhost:3000' : 'https://www.getoverlay.io')

export interface AuthSession {
  authenticated: true
  expiresAt?: number
  user: {
    id: string
    email: string
    firstName?: string
    lastName?: string
    profilePictureUrl?: string
  }
}

let latestAuthReadyState: boolean | null = null
let latestAuthFailureReason: 'session_expired' | 'server_unavailable' | null = null

function isAuthState(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<AuthSession>
  return (
    state.authenticated === true &&
    typeof state.user?.id === 'string' &&
    state.user.id.length >= 5 &&
    typeof state.user.email === 'string'
  )
}

export async function loadAuthSessionSecure(): Promise<AuthSession | null> {
  try {
    const result = await window.bridge?.security?.getAuthState?.()
    return isAuthState(result?.session) ? result.session : null
  } catch (error) {
    console.error('[Auth] Failed to load main-process auth state:', error)
    return null
  }
}

export async function loadVerifiedAuthSession(): Promise<AuthSession | null> {
  const session = await loadAuthSessionSecure()
  if (!session) return null

  try {
    const response = await overlayDesktopAppClient.bootstrap.getResponse({
      cache: 'no-store'
    })
    if (!response.ok) {
      console.warn(`[Auth] Server bootstrap rejected the stored session (${response.status})`)
      // The bootstrap request may have attempted an access-token refresh in
      // the main process. Re-read its OS-protected state: only the main process
      // can classify a terminal refresh-token rejection and clear the session.
      const retainedSession = await loadAuthSessionSecure()
      if (!retainedSession) {
        latestAuthFailureReason = 'session_expired'
        return null
      }

      // Preserve the authenticated desktop shell while the server is
      // temporarily unavailable. Cloud APIs still enforce the access token;
      // this only avoids turning an outage into destructive local logout.
      latestAuthFailureReason = 'server_unavailable'
      return retainedSession
    }
    latestAuthFailureReason = null
    return session
  } catch (error) {
    console.error('[Auth] Failed to verify the stored session with Overlay Server:', error)
    latestAuthFailureReason = 'server_unavailable'
    return null
  }
}

export function setAuthFailureReason(
  reason: 'session_expired' | 'server_unavailable' | null
): void {
  latestAuthFailureReason = reason
}

export function getAuthFailureMessage(): string | null {
  if (latestAuthFailureReason === 'session_expired') {
    return 'Your session expired. Sign in again to reconnect your cloud data.'
  }
  if (latestAuthFailureReason === 'server_unavailable') {
    return 'Overlay Server could not be reached. Check your connection and try again.'
  }
  return null
}

export async function clearAuthSession(): Promise<void> {
  await window.bridge?.signOut?.()
}

export async function startNativeSignIn(forceSignIn = false): Promise<void> {
  latestAuthFailureReason = null
  const result = await window.bridge?.startNativeSignIn?.(forceSignIn)
  if (!result?.success) throw new Error(result?.error || 'Could not start sign in')
}

export function dispatchAuthReady(authed: boolean): void {
  latestAuthReadyState = authed
  window.dispatchEvent(new CustomEvent('overlay:auth-ready', { detail: { authed } }))
}

export function getAuthReadyState(): boolean | null {
  return latestAuthReadyState
}
