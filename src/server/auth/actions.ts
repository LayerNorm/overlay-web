import 'server-only'

import { NextResponse } from 'next/server'
import { getBetterAuth, resolveBetterAuthRuntimeConfig } from '@/server/auth/better-auth'
import * as workosAuth from '@/server/auth/workos-auth'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type { AuthSession, AuthUser } from '@/shared/auth/session-types'

type WorkOsSsoProvider = 'GoogleOAuth' | 'AppleOAuth' | 'MicrosoftOAuth'
type NativeAuthProvider = WorkOsSsoProvider | 'authkit'

export const MOBILE_AUTH_REDIRECT_PATH = workosAuth.MOBILE_AUTH_REDIRECT_PATH
export const getBaseUrl = workosAuth.getBaseUrl
export const consumeAuthorizationState = workosAuth.consumeAuthorizationState
export const normalizeAuthRedirect = workosAuth.normalizeAuthRedirect
export const normalizeCodeChallenge = workosAuth.normalizeCodeChallenge
export const readEmailVerificationTicket = workosAuth.readEmailVerificationTicket

export async function getAuthorizationUrl(
  provider: WorkOsSsoProvider,
  options: {
    redirectUri?: string
    forceSignIn?: boolean
    codeChallenge?: string | null
  } = {},
): Promise<string> {
  if (selectedAuthProvider() === 'better-auth') {
    throw new Error('Better Auth SSO must be initiated through getAuthorizationRedirectResponse.')
  }
  return workosAuth.getAuthorizationUrl(provider, options)
}

export async function getAuthorizationRedirectResponse(
  request: Request,
  provider: WorkOsSsoProvider,
  options: {
    redirectUri?: string
    forceSignIn?: boolean
    codeChallenge?: string | null
  } = {},
): Promise<Response> {
  if (selectedAuthProvider() !== 'better-auth') {
    return NextResponse.redirect(await workosAuth.getAuthorizationUrl(provider, options))
  }

  return createBetterAuthSsoRedirectResponse(request, options)
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
  if (selectedAuthProvider() === 'better-auth') {
    throw new Error('Native Better Auth code exchange is not supported in this auth provider version.')
  }
  return workosAuth.getNativeAuthorizationUrl(provider, options)
}

export async function authenticateNativeWithCode(
  code: string,
  codeVerifier: string,
): Promise<AuthSession> {
  if (selectedAuthProvider() === 'better-auth') {
    throw new Error('Native Better Auth code exchange is not supported in this auth provider version.')
  }
  return workosAuth.authenticateNativeWithCode(code, codeVerifier)
}

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean }> {
  if (selectedAuthProvider() === 'better-auth') {
    void email
    void password
    return betterAuthPasswordDisabled()
  }
  return workosAuth.authenticateWithPassword(email, password)
}

export async function createUser(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string; pendingEmailVerification?: boolean; verificationTicket?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void email
    void password
    void firstName
    void lastName
    return {
      success: false,
      error: 'Email/password sign-up is disabled when AUTH_PROVIDER=better-auth. Use SSO.',
    }
  }
  return workosAuth.createUser(email, password, firstName, lastName)
}

export async function handleCallback(
  code: string,
): Promise<{ success: boolean; user?: AuthUser; error?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void code
    return {
      success: false,
      error: 'WorkOS callback route is disabled when AUTH_PROVIDER=better-auth.',
    }
  }
  return workosAuth.handleCallback(code)
}

export async function sendPasswordResetEmail(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void email
    return { success: true }
  }
  return workosAuth.sendPasswordResetEmail(email)
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void token
    void newPassword
    return {
      success: false,
      error: 'Password reset is disabled when AUTH_PROVIDER=better-auth. Use your SSO identity provider.',
    }
  }
  return workosAuth.resetPassword(token, newPassword)
}

export async function verifyEmail(
  userId: string,
  code: string,
): Promise<{ success: boolean; error?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void userId
    void code
    return {
      success: false,
      error: 'Email verification is disabled when AUTH_PROVIDER=better-auth.',
    }
  }
  return workosAuth.verifyEmail(userId, code)
}

export async function resendVerificationEmail(
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  if (selectedAuthProvider() === 'better-auth') {
    void userId
    return {
      success: false,
      error: 'Email verification is disabled when AUTH_PROVIDER=better-auth.',
    }
  }
  return workosAuth.resendVerificationEmail(userId)
}

export async function refreshSessionFromRefreshToken(
  refreshToken: string,
  expectedUserId?: string,
): Promise<AuthSession | null> {
  if (selectedAuthProvider() === 'better-auth') {
    void refreshToken
    void expectedUserId
    return null
  }
  return workosAuth.refreshSessionFromRefreshToken(refreshToken, expectedUserId)
}

function selectedAuthProvider(): string {
  const config = getOverlayRuntimeConfigSync()
  return config.providers.auth?.provider ?? config.auth.provider
}

async function createBetterAuthSsoRedirectResponse(
  request: Request,
  options: {
    redirectUri?: string
    forceSignIn?: boolean
    codeChallenge?: string | null
  },
): Promise<Response> {
  void options.forceSignIn
  const config = getOverlayRuntimeConfigSync()
  const betterAuthConfig = resolveBetterAuthRuntimeConfig(config)
  const normalizedRedirectUri = workosAuth.normalizeAuthRedirect(options.redirectUri)
  if (options.redirectUri && normalizedRedirectUri === null) {
    throw new Error('Invalid redirect URI')
  }
  if (options.codeChallenge) {
    throw new Error('Native Better Auth session transfer is not supported in this auth provider version.')
  }

  const callbackURL = new URL(normalizedRedirectUri ?? '/', workosAuth.getBaseUrl()).toString()
  const errorCallbackURL = new URL('/auth/sign-in?error=Authentication%20failed', workosAuth.getBaseUrl()).toString()
  const body: Record<string, unknown> = {
    callbackURL,
    errorCallbackURL,
  }
  if (betterAuthConfig.defaultSsoProviderId) {
    body.providerId = betterAuthConfig.defaultSsoProviderId
  }
  if (betterAuthConfig.defaultSsoDomain) {
    body.domain = betterAuthConfig.defaultSsoDomain
  }

  const headers = new Headers()
  headers.set('content-type', 'application/json')
  const cookie = request.headers.get('cookie')
  if (cookie) headers.set('cookie', cookie)

  const response = await getBetterAuth(config).handler(new Request(
    `${betterAuthConfig.baseUrl}${betterAuthConfig.basePath}/sign-in/sso`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  ))

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Better Auth SSO initiation failed with HTTP ${response.status}`)
  }

  const payload = await response.json() as { url?: unknown }
  if (typeof payload.url !== 'string' || !payload.url) {
    throw new Error('Better Auth did not return an authorization URL.')
  }

  const redirect = NextResponse.redirect(payload.url)
  forwardSetCookieHeaders(response, redirect)
  return redirect
}

function forwardSetCookieHeaders(source: Response, target: NextResponse): void {
  const getSetCookie = (source.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookieHeaders = typeof getSetCookie === 'function'
    ? getSetCookie.call(source.headers)
    : source.headers.get('set-cookie')
      ? [source.headers.get('set-cookie') as string]
      : []
  for (const cookie of cookieHeaders) {
    target.headers.append('set-cookie', cookie)
  }
}

function betterAuthPasswordDisabled(): { success: boolean; error: string } {
  return {
    success: false,
    error: 'Email/password sign-in is disabled when AUTH_PROVIDER=better-auth. Use SSO.',
  }
}
