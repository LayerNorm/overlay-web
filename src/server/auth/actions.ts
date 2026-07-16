import 'server-only'

import {
  consumeAuthorizationState,
  getBaseUrl,
  getWebAuthFlowProvider,
  MOBILE_AUTH_REDIRECT_PATH,
  normalizeAuthRedirect,
  normalizeCodeChallenge,
  type AuthUiOptions,
  type NativeAuthProvider,
  type PublicSsoProvider,
} from '@/server/auth/web-auth-flow'
import type { AuthSession, AuthUser } from '@/shared/auth/session-types'

export {
  consumeAuthorizationState,
  getBaseUrl,
  MOBILE_AUTH_REDIRECT_PATH,
  normalizeAuthRedirect,
  normalizeCodeChallenge,
}
export type { AuthUiOptions, PublicSsoProvider }

export function getAuthUiOptions(): AuthUiOptions {
  return getWebAuthFlowProvider().getOptions()
}

export async function getAuthorizationRedirectResponse(
  request: Request,
  provider: PublicSsoProvider,
  options: {
    redirectUri?: string
    forceSignIn?: boolean
    codeChallenge?: string | null
  } = {},
): Promise<Response> {
  return getWebAuthFlowProvider().startSso(request, { provider, ...options })
}

export async function getNativeAuthorizationUrl(
  provider: NativeAuthProvider,
  options: {
    redirectUri: string
    codeChallenge: string
    state: string
    forceSignIn?: boolean
  },
): Promise<string> {
  return getWebAuthFlowProvider().getNativeAuthorizationUrl(provider, options)
}

export async function authenticateNativeWithCode(
  code: string,
  codeVerifier: string,
): Promise<AuthSession> {
  return getWebAuthFlowProvider().authenticateNativeWithCode(code, codeVerifier)
}

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean }> {
  return getWebAuthFlowProvider().signInWithPassword(email, password)
}

export async function createUser(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean; verificationTicket?: string }> {
  return getWebAuthFlowProvider().signUpWithPassword(email, password, firstName, lastName)
}

export async function handleCallback(
  code: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  return getWebAuthFlowProvider().handleCallback(code)
}

export async function sendPasswordResetEmail(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  return getWebAuthFlowProvider().sendPasswordResetEmail(email)
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  return getWebAuthFlowProvider().resetPassword(token, newPassword)
}

export function readEmailVerificationTicket(value: string) {
  return getWebAuthFlowProvider().readEmailVerificationTicket(value)
}

export async function verifyEmail(
  userId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  return getWebAuthFlowProvider().verifyEmail(userId, code)
}

export async function resendVerificationEmail(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  return getWebAuthFlowProvider().resendVerificationEmail(userId)
}

export async function refreshSessionFromRefreshToken(
  refreshToken: string,
  expectedUserId?: string,
): Promise<AuthSession | null> {
  return getWebAuthFlowProvider().refreshSessionFromRefreshToken(refreshToken, expectedUserId)
}
